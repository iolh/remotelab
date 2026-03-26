import { deriveSessionAttention } from './session-attention-contract.mjs';
import { deriveSessionCheckpoint } from './session-checkpoint-contract.mjs';
import { buildSessionRawEventLogContract } from './session-event-log-contract.mjs';

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
  item.currentTask = typeof item.currentTask === 'string'
    ? item.currentTask
    : (typeof item.workflowCurrentTask === 'string' ? item.workflowCurrentTask : '');
  delete item.workflowCurrentTask;
  delete item.workflowDefinition;
  delete item.workflowTaskContract;
  delete item.workflowAutoRoute;
  delete item.workflowTaskTrace;
  delete item.workflowTraceBridge;
  delete item.workflowMode;
  delete item.workflowAutoTriggerDisabled;
  delete item.pendingIntake;
  item.attention = deriveSessionAttention(item);
  return item;
}

export function createSessionDetail(session) {
  const detail = stripSessionShape(session, { includeQueuedMessages: true });
  if (!detail) return null;
  detail.currentTask = typeof detail.currentTask === 'string'
    ? detail.currentTask
    : (typeof detail.workflowCurrentTask === 'string' ? detail.workflowCurrentTask : '');
  delete detail.workflowCurrentTask;
  delete detail.workflowDefinition;
  delete detail.workflowTaskContract;
  delete detail.workflowAutoRoute;
  delete detail.workflowTaskTrace;
  delete detail.workflowTraceBridge;
  delete detail.workflowMode;
  delete detail.workflowAutoTriggerDisabled;
  delete detail.pendingIntake;
  detail.attention = deriveSessionAttention(detail);
  detail.checkpoint = deriveSessionCheckpoint(detail);
  detail.rawEventLog = buildSessionRawEventLogContract(detail);
  return detail;
}
