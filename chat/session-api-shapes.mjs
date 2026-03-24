function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function stripSessionShape(session, {
  includeQueuedMessages = false,
} = {}) {
  if (!session || typeof session !== 'object') return null;
  const cloned = cloneJson(session);
  delete cloned.board;
  delete cloned.task;
  if (!includeQueuedMessages) {
    delete cloned.queuedMessages;
  }
  return cloned;
}

export function createSessionListItem(session) {
  const item = stripSessionShape(session, { includeQueuedMessages: false });
  if (!item) return null;
  item.workflowAutoTriggerDisabled = item.workflowAutoTriggerDisabled === true;
  return item;
}

export function createSessionDetail(session) {
  const detail = stripSessionShape(session, { includeQueuedMessages: true });
  if (!detail) return null;
  detail.workflowDefinition = detail.workflowDefinition || null;
  detail.workflowTaskContract = detail.workflowTaskContract || null;
  detail.workflowAutoRoute = detail.workflowAutoRoute || null;
  detail.workflowTaskTrace = detail.workflowTaskTrace || null;
  detail.workflowTraceBridge = detail.workflowTraceBridge || null;
  detail.workflowAutoTriggerDisabled = detail.workflowAutoTriggerDisabled === true;
  return detail;
}
