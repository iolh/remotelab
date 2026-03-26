#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const bootstrapSource = readFileSync(join(repoRoot, 'static', 'chat', 'bootstrap.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const markers = [`async function ${functionName}`, `function ${functionName}`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index !== -1);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `Missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start);
  assert.notEqual(end, -1, `Missing end token: ${endToken}`);
  return source.slice(start, end);
}

const openChromeStatusPanelSource = extractFunctionSource(bootstrapSource, 'openChromeStatusPanel');
const bridgeSource = sliceBetween(
  bootstrapSource,
  'window.remotelabChromeBridge = {',
  '\n\nfunction normalizeWorkflowTaskText',
);

const dispatchedEvents = [];
const context = {
  console,
  CHROME_STATUS_OPEN_EVENT: 'remotelab:chrome-status-open',
  buildChromeBridgeState() {
    return { summary: null };
  },
  lastChromeBridgeState: null,
  chromeBridgeListeners: new Set(),
  forkCurrentSession() {},
  shareCurrentSessionSnapshot() {},
  handoffCurrentSessionResult() {},
  runChromeWorkflowConclusionAction() {},
  runChromeWorkflowSuggestionAction() {},
  createParallelSessionsFromConclusion() {},
  window: {
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
      return true;
    },
    CustomEvent,
  },
  CustomEvent,
};
context.globalThis = context;

vm.runInNewContext(
  `${openChromeStatusPanelSource}\n${bridgeSource}`,
  context,
  { filename: 'static/chat/bootstrap.js' },
);

context.window.remotelabChromeBridge.actions.openStatusPanel();

assert.deepEqual(
  dispatchedEvents,
  ['remotelab:chrome-status-open'],
  'chrome bridge should expose a stable openStatusPanel action',
);

console.log('test-chat-chrome-status-bridge: ok');
