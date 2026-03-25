export function normalizeWorkflowSuggestionType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'suggest_verification') return normalized;
  if (normalized === 'suggest_decision') return normalized;
  return '';
}

export function normalizeWorkflowSuggestionStatus(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'pending') return normalized;
  return '';
}

export function normalizeWorkflowSuggestion(suggestion = {}, createdAtFallback = '') {
  if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) return null;
  const type = normalizeWorkflowSuggestionType(suggestion.type || '');
  if (!type) return null;
  const status = normalizeWorkflowSuggestionStatus(suggestion.status || '');
  if (!status) return null;
  const runId = typeof suggestion.runId === 'string' ? suggestion.runId.trim() : '';
  const reason = typeof suggestion.reason === 'string' ? suggestion.reason.trim() : '';
  const createdAt = typeof suggestion.createdAt === 'string' && suggestion.createdAt.trim()
    ? suggestion.createdAt.trim()
    : (typeof createdAtFallback === 'string' ? createdAtFallback.trim() : '');
  return {
    type,
    status,
    ...(runId ? { runId } : {}),
    ...(reason ? { reason } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function hasOpenWorkflowConclusions(session) {
  const entries = Array.isArray(session?.workflowPendingConclusions) ? session.workflowPendingConclusions : [];
  return entries.some((entry) => {
    const status = typeof entry?.status === 'string' ? entry.status.trim().toLowerCase() : '';
    return status === 'pending' || status === 'needs_decision';
  });
}

export function suggestNextStep({
  session = null,
  run = null,
  isMainlineSession = false,
  hasRiskSignals = false,
  riskSummary = '',
} = {}) {
  if (!run || run.state !== 'completed') {
    return { action: 'none' };
  }
  if (session?.handoffTargetSessionId) {
    return { action: 'auto_handoff' };
  }
  if (!isMainlineSession) {
    return { action: 'none' };
  }
  if (hasOpenWorkflowConclusions(session)) {
    return { action: 'none' };
  }
  return {
    action: 'suggest_verification',
    ...(hasRiskSignals && typeof riskSummary === 'string' && riskSummary.trim()
      ? { reason: riskSummary.trim() }
      : {}),
  };
}
