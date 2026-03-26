#!/usr/bin/env node
import assert from 'assert/strict';
import { messageEvent, statusEvent, toolUseEvent } from '../chat/normalizer.mjs';
import {
  buildSessionRawEventLogContract,
  createRawSessionEventLogEntry,
} from '../chat/session-event-log-contract.mjs';

const handoffMessage = messageEvent('assistant', '辅助结果已生成。', undefined, {
  messageKind: 'workflow_handoff',
});
handoffMessage.seq = 12;

const messageEntry = createRawSessionEventLogEntry('session-1', handoffMessage);
assert.equal(messageEntry.schemaVersion, '2026-03-25');
assert.equal(messageEntry.kind, 'session_raw_event_log');
assert.equal(messageEntry.appendOnly, true);
assert.equal(messageEntry.sessionId, 'session-1');
assert.equal(messageEntry.seq, 12);
assert.equal(messageEntry.eventType, 'message');
assert.equal(messageEntry.category, 'message');
assert.equal(messageEntry.role, 'assistant');
assert.equal(messageEntry.payload.content, '辅助结果已生成。');
assert.equal(messageEntry.payload.messageKind, 'workflow_handoff');
assert.equal(messageEntry.projectionHints.affectsAttention, true);

const status = statusEvent('completed');
status.seq = 13;
const statusEntry = createRawSessionEventLogEntry('session-1', status);
assert.equal(statusEntry.category, 'lifecycle');
assert.equal(statusEntry.projectionHints.affectsLifecycle, true);

const toolUse = toolUseEvent('bash', 'npm test');
toolUse.seq = 14;
const toolEntry = createRawSessionEventLogEntry('session-1', toolUse);
assert.equal(toolEntry.category, 'tool');
assert.equal(toolEntry.projectionHints.affectsCheckpoint, true);

const contract = buildSessionRawEventLogContract({
  id: 'session-1',
  latestSeq: 14,
  lastEventAt: '2026-03-25T10:00:00.000Z',
});
assert.deepEqual(contract, {
  schemaVersion: '2026-03-25',
  kind: 'session_raw_event_log',
  appendOnly: true,
  sessionId: 'session-1',
  fetchPath: '/api/sessions/session-1/events?filter=all',
  projectionPath: '/api/sessions/session-1/events?filter=visible',
  cursor: {
    latestSeq: 14,
    lastEventAt: '2026-03-25T10:00:00.000Z',
  },
});

console.log('test-session-event-log-contract: ok');
