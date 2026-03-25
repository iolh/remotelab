#!/usr/bin/env node
import assert from 'assert/strict';
import { suggestNextStep } from '../chat/run-completion-suggestions.mjs';

assert.deepEqual(
  suggestNextStep({
    session: { id: 'session-mainline' },
    run: { id: 'run-1', state: 'running' },
    isMainlineSession: true,
  }),
  { action: 'none' },
  'non-terminal runs should not emit follow-up suggestions',
);

assert.deepEqual(
  suggestNextStep({
    session: { id: 'session-aux', handoffTargetSessionId: 'session-mainline' },
    run: { id: 'run-2', state: 'completed' },
    isMainlineSession: false,
  }),
  { action: 'auto_handoff' },
  'auxiliary sessions should auto-handoff after a completed run',
);

assert.deepEqual(
  suggestNextStep({
    session: { id: 'session-sidecar' },
    run: { id: 'run-3', state: 'completed' },
    isMainlineSession: false,
  }),
  { action: 'none' },
  'non-mainline sessions without a handoff target should not emit suggestions',
);

assert.deepEqual(
  suggestNextStep({
    session: {
      id: 'session-mainline',
      workflowPendingConclusions: [
        { id: 'c-1', status: 'pending', handoffType: 'verification_result' },
      ],
    },
    run: { id: 'run-4', state: 'completed' },
    isMainlineSession: true,
  }),
  { action: 'none' },
  'mainline sessions with open conclusions should not emit another suggestion',
);

assert.deepEqual(
  suggestNextStep({
    session: { id: 'session-mainline' },
    run: { id: 'run-5', state: 'completed' },
    isMainlineSession: true,
  }),
  { action: 'suggest_verification' },
  'completed mainline runs should suggest verification by default',
);

assert.deepEqual(
  suggestNextStep({
    session: { id: 'session-mainline' },
    run: { id: 'run-6', state: 'completed' },
    isMainlineSession: true,
    hasRiskSignals: true,
    riskSummary: '需要确认、未验证',
  }),
  {
    action: 'suggest_verification',
    reason: '需要确认、未验证',
  },
  'risk-bearing completions should preserve the risk summary in the suggestion payload',
);

console.log('test-run-completion-suggestion: ok');
