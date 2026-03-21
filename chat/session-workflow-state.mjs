export const SESSION_WORKFLOW_STATE_PARKED = 'parked';
export const SESSION_WORKFLOW_STATE_WAITING_USER = 'waiting_user';
export const SESSION_WORKFLOW_STATE_DONE = 'done';

export const SESSION_WORKFLOW_PRIORITY_HIGH = 'high';
export const SESSION_WORKFLOW_PRIORITY_MEDIUM = 'medium';
export const SESSION_WORKFLOW_PRIORITY_LOW = 'low';

export const SESSION_WORKFLOW_STATES = Object.freeze([
  SESSION_WORKFLOW_STATE_PARKED,
  SESSION_WORKFLOW_STATE_WAITING_USER,
  SESSION_WORKFLOW_STATE_DONE,
]);

export const SESSION_WORKFLOW_PRIORITIES = Object.freeze([
  SESSION_WORKFLOW_PRIORITY_HIGH,
  SESSION_WORKFLOW_PRIORITY_MEDIUM,
  SESSION_WORKFLOW_PRIORITY_LOW,
]);

export function normalizeSessionWorkflowState(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (!normalized) return '';

  switch (normalized) {
    case 'parked':
    case 'paused':
    case 'pause':
    case 'backlog':
    case 'todo':
      return SESSION_WORKFLOW_STATE_PARKED;

    case 'waiting':
    case 'waiting_user':
    case 'waiting_for_user':
    case 'waiting_on_user':
    case 'needs_user':
    case 'needs_input':
      return SESSION_WORKFLOW_STATE_WAITING_USER;

    case 'done':
    case 'complete':
    case 'completed':
    case 'finished':
      return SESSION_WORKFLOW_STATE_DONE;

    default:
      return '';
  }
}

export function normalizeSessionWorkflowPriority(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (!normalized) return '';

  switch (normalized) {
    case 'high':
    case 'urgent':
    case 'asap':
    case 'important':
    case 'critical':
    case 'top':
    case 'top_priority':
    case 'p1':
      return SESSION_WORKFLOW_PRIORITY_HIGH;

    case 'medium':
    case 'normal':
    case 'default':
    case 'standard':
    case 'soon':
    case 'next':
    case 'p2':
      return SESSION_WORKFLOW_PRIORITY_MEDIUM;

    case 'low':
    case 'later':
    case 'backlog':
    case 'deferred':
    case 'eventually':
    case 'p3':
      return SESSION_WORKFLOW_PRIORITY_LOW;

    default:
      return '';
  }
}

export function inferSessionWorkflowStateFromText(value) {
  const normalized = normalizeSessionWorkflowState(value);
  if (normalized) return normalized;

  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return '';

  if (/(waiting|need(?:s)? (?:the )?user|need(?:s)? input|need(?:s)? approval|need(?:s)? confirmation|please provide|please upload|please answer|manual validation|user action)/.test(text)) {
    return SESSION_WORKFLOW_STATE_WAITING_USER;
  }

  if (/(done|complete(?:d)?|finish(?:ed)?|resolved|closed|successfully completed)/.test(text)) {
    return SESSION_WORKFLOW_STATE_DONE;
  }

  if (/(parked|paused|backlog|deferred|resume later|pick up later)/.test(text)) {
    return SESSION_WORKFLOW_STATE_PARKED;
  }

  return '';
}

export function inferSessionWorkflowPriorityFromText(value, workflowState = '') {
  const normalized = normalizeSessionWorkflowPriority(value);
  if (normalized) return normalized;

  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text) {
    if (/(high|urgent|asap|important|critical|top priority|need(?:s)? attention now|look here first|user should act soon)/.test(text)) {
      return SESSION_WORKFLOW_PRIORITY_HIGH;
    }

    if (/(medium|normal|standard|soon|next up|moderate)/.test(text)) {
      return SESSION_WORKFLOW_PRIORITY_MEDIUM;
    }

    if (/(low|later|defer(?:red)?|backlog|eventually|not urgent)/.test(text)) {
      return SESSION_WORKFLOW_PRIORITY_LOW;
    }
  }

  switch (normalizeSessionWorkflowState(workflowState)) {
    case SESSION_WORKFLOW_STATE_WAITING_USER:
      return SESSION_WORKFLOW_PRIORITY_HIGH;
    case SESSION_WORKFLOW_STATE_DONE:
      return SESSION_WORKFLOW_PRIORITY_LOW;
    case SESSION_WORKFLOW_STATE_PARKED:
      return SESSION_WORKFLOW_PRIORITY_MEDIUM;
    default:
      return '';
  }
}
