#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'chat', 'session-state-model.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, {
  filename: 'session-state-model.js',
});

const model = context.RemoteLabSessionStateModel;

assert.ok(model, 'session state model should attach to the global scope');

function makeActivity(overrides = {}) {
  return {
    run: {
      state: 'idle',
      phase: null,
      startedAt: null,
      runId: null,
      cancelRequested: false,
      ...overrides.run,
    },
    queue: {
      state: 'idle',
      count: 0,
      ...overrides.queue,
    },
    rename: {
      state: 'idle',
      error: null,
      ...overrides.rename,
    },
    compact: {
      state: 'idle',
      ...overrides.compact,
    },
  };
}

function makeSession(overrides = {}) {
  return {
    id: 'session-test',
    activity: makeActivity(),
    ...overrides,
  };
}

const runningSession = makeSession({
  activity: makeActivity({
    run: { state: 'running', phase: 'accepted', runId: 'run-1' },
  }),
});
const runningStatus = model.getSessionStatusSummary(runningSession);
assert.equal(runningStatus.primary.key, 'running');
assert.equal(model.isSessionBusy(runningSession), true);

const queuedSession = makeSession({
  activity: makeActivity({
    queue: { state: 'queued', count: 2 },
  }),
});
const queuedStatus = model.getSessionStatusSummary(queuedSession);
assert.equal(queuedStatus.primary.key, 'queued');
assert.equal(queuedStatus.primary.title, '2 follow-ups queued');
assert.equal(model.isSessionBusy(queuedSession), true);

const compactingSession = makeSession({
  activity: makeActivity({
    compact: { state: 'pending' },
  }),
});
assert.equal(model.getSessionStatusSummary(compactingSession).primary.key, 'compacting');
assert.equal(model.isSessionBusy(compactingSession), true);

const renamingSession = makeSession({
  activity: makeActivity({
    rename: { state: 'pending', error: null },
  }),
});
assert.equal(model.getSessionStatusSummary(renamingSession).primary.key, 'renaming');
assert.equal(model.isSessionBusy(renamingSession), false);

const renameFailedSession = makeSession({
  activity: makeActivity({
    rename: { state: 'failed', error: 'rename crashed' },
  }),
});
const renameFailedStatus = model.getSessionStatusSummary(renameFailedSession);
assert.equal(renameFailedStatus.primary.key, 'rename-failed');
assert.equal(renameFailedStatus.primary.title, 'rename crashed');

const legacyPendingIntakeSession = makeSession({
  pendingIntake: true,
});
assert.equal(
  model.getSessionWorkflowPriority(legacyPendingIntakeSession)?.key,
  'medium',
  'legacy pendingIntake metadata should no longer elevate session priority',
);
assert.equal(
  model.getSessionStatusSummary(legacyPendingIntakeSession).primary.key,
  'idle',
  'legacy pendingIntake metadata should no longer synthesize a waiting badge',
);

assert.equal(model.normalizeSessionWorkflowPriority('P1'), 'high');
assert.equal(model.normalizeSessionWorkflowPriority('normal'), 'medium');
assert.equal(model.normalizeSessionWorkflowPriority('later'), 'low');

assert.equal(
  JSON.stringify(model.getWorkflowStatusInfo('waiting-user')),
  JSON.stringify({
    key: 'waiting_user',
    label: 'waiting',
    className: 'status-waiting-user',
    dotClass: '',
    itemClass: '',
    title: 'Waiting on user input',
  }),
  'workflow status info should be normalized from the canonical workflow-state model',
);
assert.equal(
  model.getWorkflowStatusInfo('actively running'),
  null,
  'unknown workflow states should not synthesize fake status badges',
);

const explicitAttention = model.getSessionAttention(makeSession({
  attention: {
    state: 'needs_you_now',
    type: 'needs_decision',
    priority: 'high',
    reasonLabel: '辅助结论需要你决策',
    title: '验收结果',
  },
}));
assert.equal(explicitAttention.state, 'needs_you_now');
assert.equal(explicitAttention.type, 'needs_decision');
assert.equal(explicitAttention.typeLabel, '需要决策');
assert.equal(explicitAttention.fallback, false);

const fallbackAttention = model.getSessionAttention(makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
}));
assert.equal(fallbackAttention.state, 'done');
assert.equal(fallbackAttention.type, 'completed');
assert.equal(fallbackAttention.fallback, true);

const explicitHighPriority = model.getSessionWorkflowPriority(makeSession({ workflowPriority: 'urgent' }));
assert.equal(explicitHighPriority.key, 'high');
assert.equal(explicitHighPriority.rank, 3);

const workflowPriorityFallback = model.getSessionWorkflowPriority(
  makeSession({ workflowPriority: 'done-later' }),
);
assert.equal(workflowPriorityFallback.key, 'medium', 'unknown priority strings should fall back to medium attention');

const unreadDoneSession = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
});
assert.equal(model.hasSessionUnreadUpdate(unreadDoneSession), true, 'idle sessions updated after review should be marked unread');
assert.equal(model.hasSessionUnreadCompletion(unreadDoneSession), true, 'completed unread sessions should be surfaced through a dedicated completion predicate');
assert.equal(model.getSessionReviewStatusInfo(unreadDoneSession)?.key, 'unread', 'unread sessions should expose a dedicated review badge');

const completeAndReviewed = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T13:00:00.000Z',
});
assert.equal(model.isSessionCompleteAndReviewed(completeAndReviewed), true, 'completed sessions with no unseen updates should be de-emphasized');
assert.equal(model.isSessionCompletedAndReviewed(completeAndReviewed), true, 'completed_read should be exposed as a first-class semantic');
assert.equal(model.shouldSurfaceCompletedAttention(completeAndReviewed), false, 'completed_read sessions should leave the attention surface');

const toolOnlyAttentionSession = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
  attention: {
    state: 'done',
    type: 'completed',
    priority: 'medium',
    reason: 'completion_tool_only',
    title: 'Completed',
  },
});
assert.equal(model.shouldSurfaceCompletedAttention(toolOnlyAttentionSession), false, 'tool-only completions should stay passive when the backend marks them explicitly');
assert.equal(model.getSessionReviewStatusInfo(toolOnlyAttentionSession), null, 'tool-only completions should not show the new review badge');

const surfacedCompletionSession = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
  attention: {
    state: 'done',
    type: 'completed',
    priority: 'medium',
    reason: 'completion_with_conclusion',
    title: 'Completed',
  },
});
assert.equal(model.shouldSurfaceCompletedAttention(surfacedCompletionSession), true, 'completed runs with a visible conclusion should still surface once');
assert.equal(model.getSessionReviewStatusInfo(surfacedCompletionSession)?.key, 'unread', 'visible completions should keep the review badge');

const legacyFallbackCompletionSession = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
});
assert.equal(model.shouldSurfaceCompletedAttention(legacyFallbackCompletionSession), true, 'missing backend attention should stay conservative and surface the completion');

const completedReadAttention = model.getSessionAttention(makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T13:00:00.000Z',
  attention: {
    state: 'done',
    type: 'completed',
    priority: 'medium',
    reason: 'unread_completion',
    title: 'Completed',
  },
}));
assert.equal(completedReadAttention.state, 'idle', 'completed_read sessions should fall back to passive attention');
assert.equal(completedReadAttention.type, 'completed');
assert.equal(completedReadAttention.fallback, true);

const runningUnreadCandidate = makeSession({
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
  activity: makeActivity({
    run: {
      state: 'running',
      phase: 'running',
      startedAt: '2026-03-14T11:30:00.000Z',
      runId: 'run-review-1',
    },
  }),
});
assert.equal(model.hasSessionUnreadUpdate(runningUnreadCandidate), false, 'running sessions should not constantly become unread while streaming');

const nonCompletedUnreadSession = makeSession({
  workflowState: 'parked',
  lastEventAt: '2026-03-14T13:00:00.000Z',
  lastReviewedAt: '2026-03-14T12:00:00.000Z',
});
assert.equal(
  model.getSessionReviewStatusInfo(nonCompletedUnreadSession),
  null,
  'non-completed unread sessions should not consume the dedicated completion review badge',
);

const completedWhileOpen = makeSession({
  workflowState: 'done',
  lastEventAt: '2026-03-14T13:04:00.000Z',
  localReviewedAt: '2026-03-14T13:05:00.000Z',
  attention: {
    state: 'done',
    type: 'completed',
    priority: 'medium',
    reason: 'unread_completion',
    title: 'Completed',
  },
});
assert.equal(
  model.getSessionAttention(completedWhileOpen).state,
  'idle',
  'sessions that complete while already being viewed should land directly in completed_read',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({
      workflowState: 'done',
      lastEventAt: '2026-03-14T13:00:00.000Z',
      lastReviewedAt: '2026-03-14T12:00:00.000Z',
    }),
    makeSession({
      lastEventAt: '2026-03-14T13:30:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T11:00:00.000Z',
          runId: 'run-2',
        },
      }),
    }),
  ) < 0,
  'unread completed work should sort ahead of currently running sessions',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({
      workflowState: 'done',
      lastEventAt: '2026-03-14T13:00:00.000Z',
      lastReviewedAt: '2026-03-14T12:00:00.000Z',
      attention: {
        state: 'done',
        type: 'completed',
        priority: 'medium',
        reason: 'unread_completion',
      },
    }),
    makeSession({
      attention: {
        state: 'still_running',
        type: 'fyi',
        priority: 'medium',
      },
      lastEventAt: '2026-03-14T13:30:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T11:00:00.000Z',
          runId: 'run-explicit-comparison',
        },
      }),
    }),
  ) < 0,
  'backend completed attention should also sort ahead of still-running sessions',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({
      lastEventAt: '2026-03-14T13:30:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T09:00:00.000Z',
          runId: 'run-older',
        },
      }),
    }),
    makeSession({
      lastEventAt: '2026-03-14T11:15:00.000Z',
      activity: makeActivity({
        run: {
          state: 'running',
          phase: 'running',
          startedAt: '2026-03-14T10:00:00.000Z',
          runId: 'run-newer',
        },
      }),
    }),
  ) > 0,
  'running-session ordering should stay anchored to run start time instead of the latest streamed token time',
);

assert.ok(
  model.compareSessionListSessions(
    makeSession({
      attention: {
        state: 'needs_you_now',
        type: 'needs_decision',
        priority: 'high',
      },
      updatedAt: '2026-03-14T12:00:00.000Z',
    }),
    makeSession({
      attention: {
        state: 'still_running',
        type: 'fyi',
        priority: 'medium',
      },
      updatedAt: '2026-03-14T13:00:00.000Z',
    }),
  ) < 0,
  'typed attention should sort sessions by backend-derived state before recency',
);

const toolFallbackStatus = model.getSessionStatusSummary(
  makeSession({ tool: 'codex' }),
  { includeToolFallback: true },
);
assert.equal(toolFallbackStatus.primary.key, 'tool');
assert.equal(toolFallbackStatus.primary.label, 'codex');

const idleStatus = model.getSessionStatusSummary(makeSession());
assert.equal(idleStatus.primary.key, 'idle');
assert.equal(idleStatus.primary.label, '空闲');

console.log('test-chat-session-state-model: ok');
