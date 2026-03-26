export const SESSION_ATTENTION_SCHEMA_VERSION = '2026-03-25';

export const SESSION_ATTENTION_STATES = Object.freeze([
  'needs_you_now',
  'still_running',
  'blocked',
  'done',
  'idle',
]);

export const SESSION_ATTENTION_TYPES = Object.freeze([
  'needs_approval',
  'needs_decision',
  'blocked_by_env',
  'needs_credentials',
  'needs_input',
  'fyi',
  'completed',
  'failed_needs_review',
]);

export const SESSION_ATTENTION_PRIORITIES = Object.freeze([
  'high',
  'medium',
  'low',
]);

const ATTENTION_REASON_LABELS = Object.freeze({
  workflow_conclusion_requires_decision: '辅助结论需要你决策',
  workflow_conclusion_pending_approval: '辅助结论等待你批准',
  handoff_requires_decision: '辅助结论需要你确认',
  handoff_missing_structured_result: '辅助结论缺少结构化结果，请手动检查',
  handoff_invalid_structured_payload: '辅助结论数据不完整，已转人工确认',
  auto_absorb_failed: '自动吸收失败，需要你确认',
  final_confirmation_required: '工作流即将完成，请确认最终结论',
  final_closeout_missing_summary: '收口未产出摘要，请手动确认',
  final_closeout_failed: '收口自动执行失败，请确认',
  waiting_for_input: '当前任务需要你的输入',
  run_in_progress: '任务仍在运行',
  queued_followups: '后续任务仍在排队',
  completion_with_conclusion: '任务已完成并有未查看更新',
  completion_tool_only: '任务已完成，无需主动提醒',
  unread_completion: '任务已完成并有未查看更新',
  run_failed_missing_credentials: '缺少凭证，无法继续',
  run_failed_blocked_by_env: '环境阻塞，无法继续',
  run_failed_needs_review: '执行失败，需要你复核',
});

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIsoTimestamp(value) {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeWorkflowState(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['parked', 'waiting_user', 'done'].includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeAttentionState(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_ATTENTION_STATES.includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeAttentionType(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_ATTENTION_TYPES.includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeAttentionPriority(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SESSION_ATTENTION_PRIORITIES.includes(normalized)) {
    return normalized;
  }
  return '';
}

function getQueueCount(session = {}) {
  return Number.isInteger(session?.activity?.queue?.count) ? session.activity.queue.count : 0;
}

function getRunState(session = {}) {
  return trimString(session?.activity?.run?.state).toLowerCase();
}

function findOpenConclusion(session = {}, statuses = []) {
  const wanted = new Set((Array.isArray(statuses) ? statuses : [])
    .map((value) => trimString(value).toLowerCase())
    .filter(Boolean));
  const entries = Array.isArray(session?.workflowPendingConclusions)
    ? session.workflowPendingConclusions
    : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const status = trimString(entry?.status).toLowerCase();
    if (!wanted.has(status)) continue;
    return entry;
  }
  return null;
}

function hasUnreadCompletion(session = {}) {
  if (normalizeWorkflowState(session?.workflowState) !== 'done') {
    return false;
  }
  if (getRunState(session) === 'running') {
    return false;
  }
  const lastEventAt = normalizeIsoTimestamp(session?.lastEventAt || '');
  if (!lastEventAt) return false;
  const lastReviewedAt = normalizeIsoTimestamp(session?.lastReviewedAt || '');
  if (!lastReviewedAt) return true;
  return Date.parse(lastEventAt) > Date.parse(lastReviewedAt);
}

function hasStructuredConclusion(session = {}) {
  return (
    (Array.isArray(session?.conclusions) && session.conclusions.length > 0)
    || !!trimString(session?.deliverySummary)
    || (
      session?.workflowSuggestion
      && typeof session.workflowSuggestion === 'object'
      && trimString(session.workflowSuggestion.type)
    )
  );
}

function buildAttentionSource(session = {}, extra = {}) {
  return {
    sessionId: trimString(session?.id),
    runId: trimString(extra?.runId || session?.activity?.run?.runId),
    sourceSessionId: trimString(extra?.sourceSessionId),
    sourceSessionName: trimString(extra?.sourceSessionName),
    conclusionId: trimString(extra?.conclusionId),
    handoffType: trimString(extra?.handoffType),
  };
}

function createAttention(input = {}) {
  const state = normalizeAttentionState(input?.state);
  const type = normalizeAttentionType(input?.type);
  if (!state || !type) return null;
  return {
    schemaVersion: SESSION_ATTENTION_SCHEMA_VERSION,
    state,
    type,
    priority: normalizeAttentionPriority(input?.priority) || 'medium',
    reason: trimString(input?.reason),
    reasonLabel: getAttentionReasonLabel(input?.reason),
    title: trimString(input?.title),
    summary: trimString(input?.summary),
    actionKind: trimString(input?.actionKind),
    actionLabel: trimString(input?.actionLabel),
    observedAt: normalizeIsoTimestamp(input?.observedAt || input?.updatedAt || ''),
    source: buildAttentionSource(input?.session, input?.source),
  };
}

function classifyFailureAttention(session = {}, failureReason = '') {
  const normalized = trimString(failureReason).toLowerCase();
  if (!normalized) return null;
  if (/(credential|token|apikey|api key|auth|unauthori[sz]ed|forbidden|401|403|login)/.test(normalized)) {
    return createAttention({
      session,
      state: 'blocked',
      type: 'needs_credentials',
      priority: 'high',
      reason: 'run_failed_missing_credentials',
      title: 'Needs credentials',
      summary: failureReason,
      actionKind: 'provide_credentials',
      actionLabel: 'Provide credentials',
      observedAt: session?.updatedAt || session?.lastEventAt || '',
    });
  }
  if (/(network|timeout|timed out|econn|dns|enoent|not found|missing|unavailable|rate limit|environment|permission denied|eacces)/.test(normalized)) {
    return createAttention({
      session,
      state: 'blocked',
      type: 'blocked_by_env',
      priority: 'high',
      reason: 'run_failed_blocked_by_env',
      title: 'Blocked by environment',
      summary: failureReason,
      actionKind: 'fix_environment',
      actionLabel: 'Fix environment',
      observedAt: session?.updatedAt || session?.lastEventAt || '',
    });
  }
  return createAttention({
    session,
    state: 'blocked',
    type: 'failed_needs_review',
    priority: 'high',
    reason: 'run_failed_needs_review',
    title: 'Execution failed',
    summary: failureReason,
    actionKind: 'review_failure',
    actionLabel: 'Review failure',
    observedAt: session?.updatedAt || session?.lastEventAt || '',
  });
}

export function getAttentionReasonLabel(reason, fallback = '') {
  const normalized = trimString(reason);
  if (!normalized) return fallback;
  return ATTENTION_REASON_LABELS[normalized] || fallback;
}

export function deriveSessionAttention(session = {}) {
  const reviewConclusion = findOpenConclusion(session, ['needs_decision']);
  if (reviewConclusion) {
    return createAttention({
      session,
      state: 'needs_you_now',
      type: 'needs_decision',
      priority: 'high',
      reason: 'workflow_conclusion_requires_decision',
      title: reviewConclusion.label || 'Needs decision',
      summary: reviewConclusion.summary || '',
      actionKind: 'review_conclusion',
      actionLabel: 'Review and decide',
      observedAt: reviewConclusion.createdAt || session?.updatedAt || session?.lastEventAt || '',
      source: {
        sourceSessionId: reviewConclusion.sourceSessionId,
        sourceSessionName: reviewConclusion.sourceSessionName,
        conclusionId: reviewConclusion.id,
        handoffType: reviewConclusion.handoffType,
      },
    });
  }

  const pendingApproval = findOpenConclusion(session, ['pending']);
  if (pendingApproval) {
    return createAttention({
      session,
      state: 'needs_you_now',
      type: 'needs_approval',
      priority: 'high',
      reason: 'workflow_conclusion_pending_approval',
      title: pendingApproval.label || 'Needs approval',
      summary: pendingApproval.summary || '',
      actionKind: 'approve_handoff',
      actionLabel: 'Approve',
      observedAt: pendingApproval.createdAt || session?.updatedAt || session?.lastEventAt || '',
      source: {
        sourceSessionId: pendingApproval.sourceSessionId,
        sourceSessionName: pendingApproval.sourceSessionName,
        conclusionId: pendingApproval.id,
        handoffType: pendingApproval.handoffType,
      },
    });
  }

  if (normalizeWorkflowState(session?.workflowState) === 'waiting_user') {
    return createAttention({
      session,
      state: 'needs_you_now',
      type: 'needs_input',
      priority: 'high',
      reason: 'waiting_for_input',
      title: 'Needs input',
      summary: trimString(session?.currentTask || session?.description || session?.name),
      actionKind: 'provide_input',
      actionLabel: 'Respond',
      observedAt: session?.updatedAt || session?.lastEventAt || '',
    });
  }

  const failureReason = trimString(session?.failureReason || session?.lastFailureReason || session?.activity?.run?.failureReason);
  const failureAttention = classifyFailureAttention(session, failureReason);
  if (failureAttention) return failureAttention;

  if (getRunState(session) === 'running') {
    return createAttention({
      session,
      state: 'still_running',
      type: 'fyi',
      priority: 'medium',
      reason: 'run_in_progress',
      title: 'Still running',
      summary: trimString(session?.currentTask || session?.description || session?.name),
      actionKind: 'monitor',
      actionLabel: 'View progress',
      observedAt: session?.activity?.run?.startedAt || session?.updatedAt || '',
    });
  }

  if (getQueueCount(session) > 0) {
    const count = getQueueCount(session);
    return createAttention({
      session,
      state: 'still_running',
      type: 'fyi',
      priority: 'medium',
      reason: 'queued_followups',
      title: `${count} follow-up${count === 1 ? '' : 's'} queued`,
      summary: 'The session is parked safely and will continue from queued follow-ups.',
      actionKind: 'monitor',
      actionLabel: 'View queue',
      observedAt: session?.updatedAt || session?.lastEventAt || '',
    });
  }

  if (hasUnreadCompletion(session)) {
    const reason = (hasStructuredConclusion(session) || session?.lastRunHasVisibleOutput !== false)
      ? 'completion_with_conclusion'
      : 'completion_tool_only';
    return createAttention({
      session,
      state: 'done',
      type: 'completed',
      priority: 'medium',
      reason,
      title: 'Completed',
      summary: trimString(session?.currentTask || session?.description || session?.name),
      actionKind: 'review_result',
      actionLabel: 'Review result',
      observedAt: session?.lastEventAt || session?.updatedAt || '',
    });
  }

  return null;
}
