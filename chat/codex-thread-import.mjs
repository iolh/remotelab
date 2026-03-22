import { readFile } from 'fs/promises';
import { basename } from 'path';
import { findCodexSessionLog } from './codex-session-metrics.mjs';

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function extractMessageText(content = []) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }
  return parts.join('\n\n').trim();
}

function maybePushMessage(messages, nextMessage) {
  if (!nextMessage?.content) return;
  const previous = messages[messages.length - 1];
  if (
    previous
    && previous.role === nextMessage.role
    && previous.content === nextMessage.content
  ) {
    return;
  }
  messages.push(nextMessage);
}

function cleanImportedNameCandidate(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let text = value;
  text = text.replace(/<private>[\s\S]*?<\/private>/gi, ' ');
  text = text.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, ' ');
  const markerIndex = text.lastIndexOf('Current user message:');
  if (markerIndex !== -1) {
    text = text.slice(markerIndex + 'Current user message:'.length);
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || text.startsWith('<')) return '';
  return text.slice(0, 80);
}

function buildImportedSessionName(threadId, messages = []) {
  for (const message of messages) {
    if (message?.role !== 'user') continue;
    const candidate = cleanImportedNameCandidate(message.content);
    if (candidate) return candidate;
  }
  return `Imported Codex ${threadId.slice(0, 8)}`;
}

export async function readCodexThreadImport(threadId) {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId) {
    throw new Error('Codex thread id is required');
  }

  const sessionLogPath = await findCodexSessionLog(normalizedThreadId);
  if (!sessionLogPath) {
    throw new Error(`Codex thread not found: ${normalizedThreadId}`);
  }

  const raw = await readFile(sessionLogPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const messages = [];
  let cwd = '';
  let createdAt = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (parsed?.type === 'session_meta') {
      cwd = typeof parsed.payload?.cwd === 'string' ? parsed.payload.cwd.trim() : cwd;
      createdAt = typeof parsed.payload?.timestamp === 'string' ? parsed.payload.timestamp : createdAt;
      continue;
    }

    if (parsed?.type !== 'response_item') continue;
    if (parsed.payload?.type !== 'message') continue;

    const role = parsed.payload?.role === 'user' || parsed.payload?.role === 'assistant'
      ? parsed.payload.role
      : '';
    if (!role) continue;

    const content = extractMessageText(parsed.payload?.content);
    if (!content) continue;

    maybePushMessage(messages, {
      role,
      content,
      timestamp: parseTimestamp(parsed.timestamp),
    });
  }

  return {
    threadId: normalizedThreadId,
    sessionLogPath,
    sessionLogFilename: basename(sessionLogPath),
    cwd,
    createdAt,
    messages,
    suggestedName: buildImportedSessionName(normalizedThreadId, messages),
  };
}
