#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionHttpSource = readFileSync(join(repoRoot, 'static', 'chat', 'session-http.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
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

const normalizeSessionReviewStampSource = extractFunctionSource(sessionHttpSource, 'normalizeSessionReviewStamp');
const getSessionReviewStampTimeSource = extractFunctionSource(sessionHttpSource, 'getSessionReviewStampTime');
const getSessionReviewStampSource = extractFunctionSource(sessionHttpSource, 'getSessionReviewStamp');
const getEffectiveSessionReviewedAtSource = extractFunctionSource(sessionHttpSource, 'getEffectiveSessionReviewedAt');
const rememberSessionReviewedLocallySource = extractFunctionSource(sessionHttpSource, 'rememberSessionReviewedLocally');

const fixedNow = '2026-03-14T13:05:00.000Z';
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    super(args.length === 0 ? fixedNow : args[0]);
  }

  static now() {
    return new RealDate(fixedNow).getTime();
  }

  static parse(value) {
    return RealDate.parse(value);
  }

  static UTC(...args) {
    return RealDate.UTC(...args);
  }
}

const storedReviewMarkers = new Map();
const context = {
  console,
  Date: FixedDate,
  setLocalSessionReviewedAt(sessionId, stamp) {
    storedReviewMarkers.set(sessionId, stamp);
    return stamp;
  },
  renderSessionList() {},
};
context.globalThis = context;

vm.runInNewContext(
  [
    normalizeSessionReviewStampSource,
    getSessionReviewStampTimeSource,
    getSessionReviewStampSource,
    getEffectiveSessionReviewedAtSource,
    rememberSessionReviewedLocallySource,
    'globalThis.rememberSessionReviewedLocally = rememberSessionReviewedLocally;',
  ].join('\n'),
  context,
  { filename: 'static/chat/session-http.js' },
);

const session = {
  id: 'session-running-completed',
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:04:00.000Z',
  localReviewedAt: '2026-03-14T12:59:00.000Z',
};

const reviewedAt = context.rememberSessionReviewedLocally(session, { render: false });

assert.equal(
  reviewedAt,
  fixedNow,
  'currently viewed sessions that complete should be marked reviewed at the local viewing time instead of the older sidebar event timestamp',
);
assert.equal(
  session.localReviewedAt,
  fixedNow,
  'the local review marker should be stored back onto the refreshed session object',
);
assert.equal(
  storedReviewMarkers.get('session-running-completed'),
  fixedNow,
  'the local review marker should also persist through the local review store',
);

console.log('test-session-http-completed-read-transition: ok');
