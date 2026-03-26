#!/usr/bin/env node
import assert from 'assert/strict';
import {
  deriveSessionAttention,
  getAttentionReasonLabel,
} from '../chat/session-attention-contract.mjs';

function makeSession(overrides = {}) {
  return {
    id: 'session-test',
    name: '测试会话',
    description: '收口当前任务',
    updatedAt: '2026-03-25T10:00:00.000Z',
    lastEventAt: '2026-03-25T10:00:00.000Z',
    activity: {
      run: {
        state: 'idle',
        runId: null,
        startedAt: null,
      },
      queue: {
        count: 0,
      },
    },
    workflowPendingConclusions: [],
    ...overrides,
  };
}

const needsDecision = deriveSessionAttention(makeSession({
  workflowPendingConclusions: [{
    id: 'conclusion-1',
    status: 'needs_decision',
    label: '验收结果',
    summary: '需要确认是否继续发布。',
    sourceSessionId: 'source-1',
    sourceSessionName: '验收 · 发布',
    handoffType: 'verification_result',
    createdAt: '2026-03-25T09:58:00.000Z',
  }],
}));
assert.equal(needsDecision.state, 'needs_you_now');
assert.equal(needsDecision.type, 'needs_decision');
assert.equal(needsDecision.reason, 'workflow_conclusion_requires_decision');
assert.equal(needsDecision.source.conclusionId, 'conclusion-1');

const needsApproval = deriveSessionAttention(makeSession({
  workflowPendingConclusions: [{
    id: 'conclusion-2',
    status: 'pending',
    label: '再议结论',
    summary: '建议沿用当前方案。',
    sourceSessionId: 'source-2',
    handoffType: 'decision_result',
  }],
}));
assert.equal(needsApproval.type, 'needs_approval');
assert.equal(needsApproval.actionKind, 'approve_handoff');

const stillRunning = deriveSessionAttention(makeSession({
  activity: {
    run: {
      state: 'running',
      runId: 'run-1',
      startedAt: '2026-03-25T09:00:00.000Z',
    },
    queue: {
      count: 0,
    },
  },
}));
assert.equal(stillRunning.state, 'still_running');
assert.equal(stillRunning.type, 'fyi');
assert.equal(stillRunning.reason, 'run_in_progress');

const completed = deriveSessionAttention(makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-25T10:10:00.000Z',
  lastReviewedAt: '2026-03-25T10:00:00.000Z',
  conclusions: [{
    id: 'conclusion-finished',
    status: 'accepted',
    summary: '已形成结论',
  }],
}));
assert.equal(completed.state, 'done');
assert.equal(completed.type, 'completed');
assert.equal(completed.reason, 'completion_with_conclusion');

const toolOnlyCompleted = deriveSessionAttention(makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-25T10:20:00.000Z',
  lastReviewedAt: '2026-03-25T10:00:00.000Z',
  lastRunHasVisibleOutput: false,
}));
assert.equal(toolOnlyCompleted.reason, 'completion_tool_only');

const conservativeCompleted = deriveSessionAttention(makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-25T10:30:00.000Z',
  lastReviewedAt: '2026-03-25T10:00:00.000Z',
}));
assert.equal(conservativeCompleted.reason, 'completion_with_conclusion');

const credentialFailure = deriveSessionAttention(makeSession({
  failureReason: 'Unauthorized: missing API token',
}));
assert.equal(credentialFailure.state, 'blocked');
assert.equal(credentialFailure.type, 'needs_credentials');

assert.equal(getAttentionReasonLabel('final_closeout_failed'), '收口自动执行失败，请确认');

console.log('test-session-attention-contract: ok');
