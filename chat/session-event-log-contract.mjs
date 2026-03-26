export const SESSION_EVENT_LOG_SCHEMA_VERSION = '2026-03-25';

export const SESSION_EVENT_LOG_KINDS = Object.freeze([
  'session_raw_event_log',
]);

export const SESSION_EVENT_LOG_CATEGORIES = Object.freeze([
  'message',
  'tool',
  'lifecycle',
  'context',
  'artifact',
  'metrics',
  'reasoning',
  'unknown',
]);

const KNOWN_EVENT_TYPES = new Set([
  'message',
  'tool_use',
  'tool_result',
  'file_change',
  'reasoning',
  'manager_context',
  'status',
  'usage',
  'template_context',
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

function normalizeEventTimestamp(value) {
  if (Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  const iso = normalizeIsoTimestamp(value);
  return iso ? Date.parse(iso) : 0;
}

function normalizeEventType(value) {
  const normalized = trimString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'unknown';
  if (KNOWN_EVENT_TYPES.has(normalized)) return normalized;
  if (normalized.startsWith('workflow_')) return normalized;
  return normalized;
}

function normalizeEventRole(value) {
  const normalized = trimString(value).toLowerCase();
  if (['user', 'assistant', 'system', 'tool'].includes(normalized)) {
    return normalized;
  }
  return normalized || 'unknown';
}

function classifyEventCategory(eventType) {
  switch (eventType) {
    case 'message':
      return 'message';
    case 'tool_use':
    case 'tool_result':
      return 'tool';
    case 'status':
      return 'lifecycle';
    case 'template_context':
    case 'manager_context':
      return 'context';
    case 'file_change':
      return 'artifact';
    case 'usage':
      return 'metrics';
    case 'reasoning':
      return 'reasoning';
    default:
      return eventType.startsWith('workflow_') ? 'lifecycle' : 'unknown';
  }
}

function buildProjectionHints(eventType, event = {}, category = 'unknown') {
  const messageKind = trimString(event?.messageKind).toLowerCase();
  return {
    affectsAttention: (
      category === 'lifecycle'
      || messageKind === 'workflow_handoff'
      || eventType === 'message'
    ),
    affectsCheckpoint: (
      category === 'tool'
      || Boolean(trimString(event?.runId))
      || eventType.startsWith('workflow_')
    ),
    affectsLifecycle: (
      category === 'lifecycle'
      || category === 'message'
      || eventType === 'usage'
    ),
  };
}

function sanitizePayload(event = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(event || {})) {
    if ([
      'id',
      'seq',
      'timestamp',
      'type',
      'role',
    ].includes(key)) {
      continue;
    }
    payload[key] = value;
  }
  return payload;
}

export function createRawSessionEventLogEntry(sessionId, event = {}) {
  const normalizedSessionId = trimString(sessionId);
  const eventType = normalizeEventType(event?.type);
  const category = classifyEventCategory(eventType);
  const timestamp = normalizeEventTimestamp(event?.timestamp);
  return {
    schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
    kind: 'session_raw_event_log',
    appendOnly: true,
    sessionId: normalizedSessionId,
    seq: Number.isInteger(event?.seq) && event.seq > 0 ? event.seq : 0,
    eventId: trimString(event?.id),
    timestamp,
    isoTimestamp: timestamp > 0 ? new Date(timestamp).toISOString() : '',
    eventType,
    role: normalizeEventRole(event?.role),
    category,
    payload: sanitizePayload(event),
    projectionHints: buildProjectionHints(eventType, event, category),
  };
}

export function normalizeRawSessionEventLogEntry(value = {}) {
  if (!value || typeof value !== 'object') {
    return createRawSessionEventLogEntry('', {});
  }
  return createRawSessionEventLogEntry(value.sessionId || '', {
    id: value.eventId || value.id || '',
    seq: value.seq,
    timestamp: value.timestamp || value.isoTimestamp || '',
    type: value.eventType || value.type || '',
    role: value.role || '',
    ...(value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
      ? value.payload
      : {}),
  });
}

export function buildSessionRawEventLogContract(session = {}) {
  const sessionId = trimString(session?.id);
  if (!sessionId) return null;
  const latestSeq = Number.isInteger(session?.latestSeq) && session.latestSeq > 0
    ? session.latestSeq
    : 0;
  const lastEventAt = normalizeIsoTimestamp(session?.lastEventAt || session?.updatedAt || '');
  return {
    schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
    kind: 'session_raw_event_log',
    appendOnly: true,
    sessionId,
    fetchPath: `/api/sessions/${encodeURIComponent(sessionId)}/events?filter=all`,
    projectionPath: `/api/sessions/${encodeURIComponent(sessionId)}/events?filter=visible`,
    cursor: {
      latestSeq,
      lastEventAt,
    },
  };
}
