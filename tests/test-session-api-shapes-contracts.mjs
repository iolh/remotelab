#!/usr/bin/env node
import assert from 'assert/strict';
import { createSessionDetail, createSessionListItem } from '../chat/session-api-shapes.mjs';

const session = {
  id: 'session-shape',
  name: '执行 · 搜索页改造',
  description: '吸收验收结论并完成收口',
  currentTask: '处理辅助结论',
  latestSeq: 21,
  updatedAt: '2026-03-25T10:00:00.000Z',
  lastEventAt: '2026-03-25T10:02:00.000Z',
  activity: {
    run: {
      state: 'idle',
      runId: null,
      startedAt: null,
    },
    queue: {
      count: 0,
    },
    rename: {
      state: 'idle',
      error: null,
    },
    compact: {
      state: 'idle',
    },
  },
  workflowPendingConclusions: [{
    id: 'conclusion-shape',
    status: 'needs_decision',
    label: '验收结果',
    summary: '主路径通过，但边界仍需确认。',
    sourceSessionId: 'source-shape',
    sourceSessionName: '验收 · 搜索页改造',
    handoffType: 'verification_result',
  }],
  pendingWorkflowAutoAbsorb: {
    runId: 'run-auto-shape',
    sourceSessionId: 'source-shape',
    conclusionId: 'conclusion-shape',
    handoffType: 'verification_result',
    summary: '等待继续自动吸收。',
  },
  queuedMessages: [{ text: 'queued follow-up' }],
  workflowTaskContract: { internal: true },
  pendingIntake: true,
};

const item = createSessionListItem(session);
assert.equal(item.attention?.type, 'needs_decision');
assert.equal(item.workflowTaskContract, undefined);
assert.equal(item.pendingIntake, undefined);
assert.equal(item.rawEventLog, undefined);

const detail = createSessionDetail(session);
assert.equal(detail.attention?.type, 'needs_decision');
assert.equal(detail.checkpoint?.stage, 'workflow_auto_absorb');
assert.equal(detail.rawEventLog?.fetchPath, '/api/sessions/session-shape/events?filter=all');
assert.equal(detail.rawEventLog?.cursor?.latestSeq, 21);
assert.deepEqual(detail.queuedMessages, [{ text: 'queued follow-up' }]);
assert.equal(detail.workflowTaskContract, undefined);
assert.equal(detail.pendingIntake, undefined);

console.log('test-session-api-shapes-contracts: ok');
