export const SESSION_CHECKPOINT_SCHEMA_VERSION = '2026-03-25';

export const SESSION_CHECKPOINT_STAGES = Object.freeze([
  'run_turn',
  'queued_followup',
  'workflow_auto_absorb',
  'workflow_final_closeout',
]);

export const SESSION_CHECKPOINT_STATUSES = Object.freeze([
  'active',
  'resumable',
  'awaiting_confirmation',
]);

export const SESSION_CHECKPOINT_RESUME_STRATEGIES = Object.freeze([
  'resume',
  'confirm',
  'restart',
]);

export const SESSION_CHECKPOINT_REPLAY_POLICIES = Object.freeze([
  'safe_replay',
  'checkpoint_only',
  'forbidden',
]);

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIsoTimestamp(value) {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export function normalizeCheckpointStage(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_CHECKPOINT_STAGES.includes(normalized)) {
    return normalized;
  }
  return '';
}

export function normalizeCheckpointStatus(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_CHECKPOINT_STATUSES.includes(normalized)) {
    return normalized;
  }
  return '';
}

export function normalizeCheckpointResumeStrategy(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_CHECKPOINT_RESUME_STRATEGIES.includes(normalized)) {
    return normalized;
  }
  return '';
}

export function normalizeCheckpointReplayPolicy(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_CHECKPOINT_REPLAY_POLICIES.includes(normalized)) {
    return normalized;
  }
  return '';
}

export function createSessionCheckpoint(input = {}) {
  const sessionId = trimString(input?.sessionId);
  const stage = normalizeCheckpointStage(input?.stage);
  if (!sessionId || !stage) return null;
  const runId = trimString(input?.runId);
  const status = normalizeCheckpointStatus(input?.status) || 'resumable';
  const resumeStrategy = normalizeCheckpointResumeStrategy(input?.resumeStrategy)
    || (status === 'awaiting_confirmation' ? 'confirm' : 'resume');
  const replayPolicy = normalizeCheckpointReplayPolicy(input?.replayPolicy)
    || (stage === 'queued_followup' ? 'safe_replay' : 'checkpoint_only');
  const updatedAt = normalizeIsoTimestamp(input?.updatedAt || input?.observedAt || '');
  const source = input?.source && typeof input.source === 'object' && !Array.isArray(input.source)
    ? {
      sourceSessionId: trimString(input.source.sourceSessionId),
      conclusionId: trimString(input.source.conclusionId),
      handoffType: trimString(input.source.handoffType),
    }
    : {
      sourceSessionId: '',
      conclusionId: '',
      handoffType: '',
    };
  return {
    schemaVersion: SESSION_CHECKPOINT_SCHEMA_VERSION,
    checkpointId: trimString(input?.checkpointId)
      || [
        'ckpt',
        sessionId,
        stage,
        runId || 'session',
      ].join(':'),
    sessionId,
    runId,
    stage,
    status,
    resumeStrategy,
    replayPolicy,
    requiresConfirmation: input?.requiresConfirmation === true || status === 'awaiting_confirmation',
    summary: trimString(input?.summary),
    updatedAt,
    source,
  };
}

function resolveCheckpointStageFromSession(session = {}) {
  const pendingAutoAbsorb = session?.pendingWorkflowAutoAbsorb && typeof session.pendingWorkflowAutoAbsorb === 'object'
    ? session.pendingWorkflowAutoAbsorb
    : null;
  if (pendingAutoAbsorb?.runId) {
    return {
      stage: 'workflow_auto_absorb',
      runId: trimString(pendingAutoAbsorb.runId),
      summary: trimString(pendingAutoAbsorb.summary) || 'Workflow auto-absorb can continue from checkpoint.',
      source: {
        sourceSessionId: trimString(pendingAutoAbsorb.sourceSessionId),
        conclusionId: trimString(pendingAutoAbsorb.conclusionId),
        handoffType: trimString(pendingAutoAbsorb.handoffType),
      },
      replayPolicy: 'forbidden',
    };
  }

  const pendingFinalCloseout = session?.pendingWorkflowFinalCloseout && typeof session.pendingWorkflowFinalCloseout === 'object'
    ? session.pendingWorkflowFinalCloseout
    : null;
  if (pendingFinalCloseout?.runId) {
    return {
      stage: 'workflow_final_closeout',
      runId: trimString(pendingFinalCloseout.runId),
      summary: trimString(pendingFinalCloseout.summary) || 'Final closeout can continue from checkpoint.',
      source: {
        sourceSessionId: trimString(pendingFinalCloseout.sourceSessionId),
        conclusionId: '',
        handoffType: '',
      },
      replayPolicy: 'forbidden',
    };
  }

  const queueCount = Number.isInteger(session?.activity?.queue?.count) ? session.activity.queue.count : 0;
  if (queueCount > 0) {
    return {
      stage: 'queued_followup',
      runId: '',
      summary: `${queueCount} queued follow-up${queueCount === 1 ? '' : 's'} can resume without replaying prior side effects.`,
      source: {
        sourceSessionId: '',
        conclusionId: '',
        handoffType: '',
      },
      replayPolicy: 'safe_replay',
    };
  }

  const runState = trimString(session?.activity?.run?.state).toLowerCase();
  if (runState === 'running') {
    return {
      stage: 'run_turn',
      runId: trimString(session?.activity?.run?.runId),
      summary: 'The current run is active and should resume from its latest checkpoint.',
      source: {
        sourceSessionId: '',
        conclusionId: '',
        handoffType: '',
      },
      replayPolicy: 'checkpoint_only',
    };
  }

  return null;
}

export function deriveSessionCheckpoint(session = {}) {
  const sessionId = trimString(session?.id);
  if (!sessionId) return null;
  const stageInfo = resolveCheckpointStageFromSession(session);
  if (!stageInfo) return null;
  const activeRunId = trimString(session?.activity?.run?.runId);
  const status = activeRunId && stageInfo.runId && activeRunId === stageInfo.runId
    ? 'active'
    : 'resumable';
  return createSessionCheckpoint({
    sessionId,
    runId: stageInfo.runId,
    stage: stageInfo.stage,
    status,
    resumeStrategy: 'resume',
    replayPolicy: stageInfo.replayPolicy,
    summary: stageInfo.summary,
    updatedAt: session?.updatedAt || session?.lastEventAt || '',
    source: stageInfo.source,
  });
}
