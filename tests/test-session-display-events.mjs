#!/usr/bin/env node
import assert from 'assert/strict';
import {
  buildEventBlockEvents,
  buildSessionDisplayEvents,
} from './chat/session-display-events.mjs';

const interleavedTurnHistory = [
  { seq: 1, type: 'message', role: 'user', content: 'Please summarize the work' },
  { seq: 2, type: 'status', role: 'system', content: 'thinking' },
  { seq: 3, type: 'reasoning', role: 'assistant', content: 'Inspecting repository state' },
  { seq: 4, type: 'status', role: 'system', content: 'Running tool A' },
  { seq: 5, type: 'tool_use', role: 'assistant', toolName: 'shell', toolInput: 'ls -la' },
  { seq: 6, type: 'tool_result', role: 'system', output: 'file list', exitCode: 0 },
  { seq: 7, type: 'message', role: 'assistant', content: 'Final summary' },
  { seq: 8, type: 'usage', role: 'system', contextTokens: 1200, outputTokens: 42 },
];

const interleavedDisplay = buildSessionDisplayEvents(interleavedTurnHistory, { sessionRunning: false });
assert.deepEqual(
  interleavedDisplay.map((event) => event.type),
  ['message', 'thinking_block', 'message', 'usage'],
  'turn display should collapse intermediate turn content and keep only the final assistant summary visible',
);
assert.equal(interleavedDisplay[1].blockStartSeq, 3, 'collapsed range should begin with the first intermediate event after the user message');
assert.equal(interleavedDisplay[1].blockEndSeq, 6, 'collapsed range should extend through the final hidden event before the summary');
assert.equal(interleavedDisplay[1].label, 'Thought · used shell', 'completed blocks should reuse the same thought label family as the running block');

const interleavedBlockEvents = buildEventBlockEvents(interleavedTurnHistory, 3, 6);
assert.deepEqual(
  interleavedBlockEvents.map((event) => event.type),
  ['reasoning', 'status', 'tool_use', 'tool_result'],
  'collapsed block payload should still expose the folded implementation events on demand',
);

const leadingVisibleStatusHistory = [
  { seq: 1, type: 'message', role: 'user', content: 'Do the thing' },
  { seq: 2, type: 'status', role: 'system', content: 'Preparing environment' },
  { seq: 3, type: 'reasoning', role: 'assistant', content: 'Checking dependencies' },
  { seq: 4, type: 'tool_use', role: 'assistant', toolName: 'shell', toolInput: 'npm test' },
  { seq: 5, type: 'message', role: 'assistant', content: 'Done summary' },
];

const leadingVisibleDisplay = buildSessionDisplayEvents(leadingVisibleStatusHistory, { sessionRunning: false });
assert.deepEqual(
  leadingVisibleDisplay.map((event) => event.type),
  ['message', 'thinking_block', 'message'],
  'leading visible status updates should also fold into the intermediate collapsed block when a final summary exists',
);
assert.equal(leadingVisibleDisplay[1].blockStartSeq, 2, 'collapsed range should include visible intermediate status events before hidden work');
assert.equal(leadingVisibleDisplay[1].blockEndSeq, 4, 'collapsed range should end at the last hidden implementation event before the summary');
assert.equal(leadingVisibleDisplay[1].label, 'Thought · used shell', 'completed folded blocks should keep the same thought header copy');

const leadingVisibleBlockEvents = buildEventBlockEvents(leadingVisibleStatusHistory, 2, 4);
assert.deepEqual(
  leadingVisibleBlockEvents.map((event) => event.type),
  ['status', 'reasoning', 'tool_use'],
  'folded blocks should preserve visible intermediate status text instead of only keeping hidden tool events',
);

const runningTurnHistory = [
  { seq: 1, type: 'message', role: 'user', content: 'Work on this task' },
  { seq: 2, type: 'status', role: 'system', content: 'Preparing environment' },
  { seq: 3, type: 'reasoning', role: 'assistant', content: 'Inspecting files' },
  { seq: 4, type: 'tool_use', role: 'assistant', toolName: 'bash', toolInput: 'rg TODO' },
  { seq: 5, type: 'tool_result', role: 'system', output: 'matches', exitCode: 0 },
  { seq: 6, type: 'message', role: 'assistant', content: 'partial draft that should stay hidden while running' },
];

const runningDisplay = buildSessionDisplayEvents(runningTurnHistory, { sessionRunning: true });
assert.deepEqual(
  runningDisplay.map((event) => event.type),
  ['message', 'thinking_block'],
  'running turns should collapse into a single thinking block instead of streaming multiple visible intermediate fragments',
);
assert.equal(runningDisplay[1].label, 'Thinking · using bash', 'running turns should use the same thought block label family as completed turns');
assert.equal(runningDisplay[1].blockStartSeq, 2, 'running collapsed block should start with the first non-user event in the turn');
assert.equal(runningDisplay[1].blockEndSeq, 6, 'running collapsed block should extend through the latest in-flight event');

const runningBlockEvents = buildEventBlockEvents(runningTurnHistory, 2, 6);
assert.deepEqual(
  runningBlockEvents.map((event) => event.type),
  ['status', 'reasoning', 'tool_use', 'tool_result', 'message'],
  'running folded blocks should preserve intermediate assistant text so the page can still reveal everything on demand',
);

const ignoredStatusBlockEvents = buildEventBlockEvents(interleavedTurnHistory, 2, 6);
assert.equal(
  ignoredStatusBlockEvents.some((event) => event.type === 'status' && event.content === 'thinking'),
  false,
  'transport-only thinking markers should stay omitted from the folded block payload',
);

const managerContextHistory = [
  { seq: 1, type: 'message', role: 'user', content: '继续这个讨论' },
  { seq: 2, type: 'manager_context', role: 'system', content: 'Manager note: keep replies in natural paragraphs.' },
  { seq: 3, type: 'reasoning', role: 'assistant', content: 'Refreshing working agreements' },
  { seq: 4, type: 'message', role: 'assistant', content: '好的，我们继续。' },
];

const managerContextDisplay = buildSessionDisplayEvents(managerContextHistory, { sessionRunning: false });
assert.deepEqual(
  managerContextDisplay.map((event) => event.type),
  ['message', 'thinking_block', 'message'],
  'manager context events should stay hidden inside the folded implementation block by default',
);

const managerContextBlockEvents = buildEventBlockEvents(managerContextHistory, 2, 3);
assert.deepEqual(
  managerContextBlockEvents.map((event) => event.type),
  ['manager_context', 'reasoning'],
  'expanded folded blocks should still expose manager context when explicitly opened',
);

// --- fileChanges & isTurnTerminal ---

const toolOnlyHistory = [
  { seq: 1, type: 'message', role: 'user', content: 'Fix the CSS bug' },
  { seq: 2, type: 'reasoning', role: 'assistant', content: 'Looking at styles' },
  { seq: 3, type: 'tool_use', role: 'assistant', toolName: 'read', toolInput: 'src/app.css' },
  { seq: 4, type: 'tool_result', role: 'system', output: 'body { color: red }', exitCode: 0 },
  { seq: 5, type: 'tool_use', role: 'assistant', toolName: 'edit', toolInput: 'src/app.css' },
  { seq: 6, type: 'file_change', role: 'system', filePath: 'src/app.css', changeType: 'modified' },
  { seq: 7, type: 'tool_result', role: 'system', output: 'ok', exitCode: 0 },
  { seq: 8, type: 'file_change', role: 'system', filePath: 'src/app.css', changeType: 'deleted' },
  { seq: 9, type: 'file_change', role: 'system', filePath: 'src/layout.css', changeType: 'modified' },
];

const toolOnlyDisplay = buildSessionDisplayEvents(toolOnlyHistory, { sessionRunning: false });
const terminalBlock = toolOnlyDisplay.find((e) => e.type === 'thinking_block');
assert.ok(terminalBlock, 'tool-only turn should produce a thinking block');
assert.ok(terminalBlock.isTurnTerminal, 'thinking block should be marked isTurnTerminal when no assistant text follows');
assert.ok(Array.isArray(terminalBlock.fileChanges), 'thinking block should carry fileChanges');
assert.equal(terminalBlock.fileChanges.length, 2, 'fileChanges should deduplicate by filePath');
assert.equal(terminalBlock.fileChanges[0].filePath, 'src/app.css');
assert.equal(terminalBlock.fileChanges[0].changeType, 'deleted', 'fileChanges should keep the last changeType for a repeated path');
assert.equal(terminalBlock.fileChanges[1].filePath, 'src/layout.css');

const withTextHistory = [
  { seq: 1, type: 'message', role: 'user', content: 'Fix the CSS bug' },
  { seq: 2, type: 'tool_use', role: 'assistant', toolName: 'edit', toolInput: 'src/app.css' },
  { seq: 3, type: 'file_change', role: 'system', filePath: 'src/app.css', changeType: 'modified' },
  { seq: 4, type: 'tool_result', role: 'system', output: 'ok', exitCode: 0 },
  { seq: 5, type: 'message', role: 'assistant', content: 'Fixed the color.' },
];

const withTextDisplay = buildSessionDisplayEvents(withTextHistory, { sessionRunning: false });
const normalBlock = withTextDisplay.find((e) => e.type === 'thinking_block');
assert.ok(normalBlock, 'turn with text should still have a thinking block');
assert.ok(!normalBlock.isTurnTerminal, 'thinking block should NOT be isTurnTerminal when assistant text follows');
assert.ok(Array.isArray(normalBlock.fileChanges), 'fileChanges should still be present even when not terminal');
assert.equal(normalBlock.fileChanges.length, 1);

const runningFileChangeHistory = [
  { seq: 1, type: 'message', role: 'user', content: 'Refactor layout' },
  { seq: 2, type: 'tool_use', role: 'assistant', toolName: 'edit', toolInput: 'src/layout.css' },
  { seq: 3, type: 'file_change', role: 'system', filePath: 'src/layout.css', changeType: 'modified' },
  { seq: 4, type: 'tool_result', role: 'system', output: 'ok', exitCode: 0 },
];

const runningFileChangeDisplay = buildSessionDisplayEvents(runningFileChangeHistory, { sessionRunning: true });
const runningTerminalCandidate = runningFileChangeDisplay.find((e) => e.type === 'thinking_block');
assert.ok(runningTerminalCandidate, 'running turn should still produce a thinking block');
assert.ok(!runningTerminalCandidate.isTurnTerminal, 'running turns should not be marked terminal even when fileChanges exist');
assert.equal(runningTerminalCandidate.state, 'running');

console.log('test-session-display-events: ok');
