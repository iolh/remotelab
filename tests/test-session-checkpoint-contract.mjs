#!/usr/bin/env node
import assert from 'assert/strict';
import {
  createSessionCheckpoint,
  deriveSessionCheckpoint,
} from '../chat/session-checkpoint-contract.mjs';

function makeSession(overrides = {}) {
  return {
    id: 'session-test',
    updatedAt: '2026-03-25T10:00:00.000Z',
    activity: {
      run: {
        state: 'idle',
        runId: null,
      },
      queue: {
        count: 0,
      },
    },
    ...overrides,
  };
}

const explicitCheckpoint = createSessionCheckpoint({
  sessionId: 'session-explicit',
  stage: 'workflow_auto_absorb',
  runId: 'run-explicit',
  replayPolicy: 'forbidden',
});
assert.equal(explicitCheckpoint.checkpointId, 'ckpt:session-explicit:workflow_auto_absorb:run-explicit');
assert.equal(explicitCheckpoint.resumeStrategy, 'resume');

const autoAbsorbCheckpoint = deriveSessionCheckpoint(makeSession({
  activity: {
    run: {
      state: 'running',
      runId: 'run-auto',
    },
    queue: {
      count: 0,
    },
  },
  pendingWorkflowAutoAbsorb: {
    runId: 'run-auto',
    sourceSessionId: 'source-1',
    conclusionId: 'conclusion-1',
    handoffType: 'verification_result',
    summary: '等待继续自动吸收。',
  },
}));
assert.equal(autoAbsorbCheckpoint.stage, 'workflow_auto_absorb');
assert.equal(autoAbsorbCheckpoint.status, 'active');
assert.equal(autoAbsorbCheckpoint.replayPolicy, 'forbidden');
assert.equal(autoAbsorbCheckpoint.source.conclusionId, 'conclusion-1');

const closeoutCheckpoint = deriveSessionCheckpoint(makeSession({
  pendingWorkflowFinalCloseout: {
    runId: 'run-closeout',
    sourceSessionId: 'source-2',
    summary: '等待继续最终收口。',
  },
}));
assert.equal(closeoutCheckpoint.stage, 'workflow_final_closeout');
assert.equal(closeoutCheckpoint.status, 'resumable');
assert.equal(closeoutCheckpoint.resumeStrategy, 'resume');

const queuedCheckpoint = deriveSessionCheckpoint(makeSession({
  activity: {
    run: {
      state: 'idle',
      runId: null,
    },
    queue: {
      count: 2,
    },
  },
}));
assert.equal(queuedCheckpoint.stage, 'queued_followup');
assert.equal(queuedCheckpoint.replayPolicy, 'safe_replay');

assert.equal(deriveSessionCheckpoint(makeSession()), null);

console.log('test-session-checkpoint-contract: ok');
