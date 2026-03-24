import { randomBytes } from 'crypto';
import {
  appendEvent,
  getContextHead,
  getHistorySnapshot,
  loadHistory,
  setContextHead,
} from './history.mjs';
import { messageEvent, statusEvent } from './normalizer.mjs';
import { buildTemplateFreshnessNotice } from './session-continuation.mjs';
import { getSessionQueueCount } from './session-activity.mjs';
import { loadSessionsMeta, mutateSessionMeta } from './session-meta-store.mjs';
import { scheduleQueuedFollowUpDispatch } from './follow-up-queue.mjs';
import { isWorkflowAuxiliaryMessage, isWorkflowStatusLikeEventType } from './workflow-engine.mjs';

let dependencies = null;

function requireDeps() {
  if (!dependencies) {
    throw new Error('context-compaction dependencies are not configured');
  }
  return dependencies;
}

export function configureContextCompaction(nextDependencies) {
  dependencies = nextDependencies;
}

function liveSessions() {
  return requireDeps().liveSessions;
}

function ensureLiveSession(sessionId) {
  return requireDeps().ensureLiveSession(sessionId);
}

function getSession(sessionId, options = {}) {
  return requireDeps().getSession(sessionId, options);
}

function createSession(folder, tool, name, extra = {}) {
  return requireDeps().createSession(folder, tool, name, extra);
}

function enrichSessionMeta(meta, options = {}) {
  return requireDeps().enrichSessionMeta(meta, options);
}

function isContextCompactorSession(meta) {
  return requireDeps().isContextCompactorSession(meta);
}

function nowIso() {
  return requireDeps().nowIso();
}

function sendMessage(sessionId, text, images, options = {}) {
  return requireDeps().sendMessage(sessionId, text, images, options);
}

function broadcastSessionInvalidation(sessionId) {
  return requireDeps().broadcastSessionInvalidation(sessionId);
}

function clearPersistedResumeIds(sessionId) {
  return requireDeps().clearPersistedResumeIds(sessionId);
}

function getAttachmentDisplayName(attachment) {
  return requireDeps().getAttachmentDisplayName(attachment);
}

export const INTERNAL_SESSION_ROLE_CONTEXT_COMPACTOR = 'context_compactor';
export const AUTO_COMPACT_MARKER_TEXT = 'Older messages above this marker are no longer in the model\'s live context. They remain visible in the transcript, but only the compressed handoff and newer messages below are loaded for continued work.';
export const CONTEXT_COMPACTOR_SYSTEM_PROMPT = [
  'You are RemoteLab\'s hidden context compactor for a user-facing session.',
  'Your job is to condense older session context into a compact continuation package.',
  'Preserve the task objective, accepted decisions, constraints, completed work, current state, open questions, and next steps.',
  'Do not include raw tool dumps unless a tiny excerpt is essential.',
  'Be explicit about what is no longer in live context and what the next worker should rely on.',
].join('\n');

export const DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_PERCENT = 100;

export function parsePositiveIntOrInfinity(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (/^(inf|infinity)$/i.test(trimmed)) return Number.POSITIVE_INFINITY;
  const parsed = parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getConfiguredAutoCompactContextTokens() {
  return parsePositiveIntOrInfinity(process.env.REMOTELAB_LIVE_CONTEXT_COMPACT_TOKENS);
}

export function getRunLiveContextTokens(run) {
  return Number.isInteger(run?.contextInputTokens) && run.contextInputTokens > 0
    ? run.contextInputTokens
    : null;
}

export function getRunContextWindowTokens(run) {
  return Number.isInteger(run?.contextWindowTokens) && run.contextWindowTokens > 0
    ? run.contextWindowTokens
    : null;
}

export function getAutoCompactContextTokens(run) {
  const configured = getConfiguredAutoCompactContextTokens();
  if (configured !== null) {
    return configured;
  }
  const contextWindowTokens = getRunContextWindowTokens(run);
  if (!Number.isInteger(contextWindowTokens)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(
    1,
    Math.floor((contextWindowTokens * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_PERCENT) / 100),
  );
}

export function getAutoCompactStatusText(run) {
  const configured = getConfiguredAutoCompactContextTokens();
  const contextTokens = getRunLiveContextTokens(run);
  const contextWindowTokens = getRunContextWindowTokens(run);
  if (configured === null && Number.isInteger(contextTokens) && Number.isInteger(contextWindowTokens)) {
    const percent = ((contextTokens / contextWindowTokens) * 100).toFixed(1);
    return `Live context exceeded the model window (${contextTokens.toLocaleString()} / ${contextWindowTokens.toLocaleString()}, ${percent}%) — compacting conversation…`;
  }
  const autoCompactTokens = getAutoCompactContextTokens(run);
  if (Number.isFinite(autoCompactTokens)) {
    return `Live context exceeded ${autoCompactTokens.toLocaleString()} tokens — compacting conversation…`;
  }
  return 'Live context overflowed — compacting conversation…';
}

function normalizeCompactionText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function clipCompactionSection(value, maxChars = 12000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return `${text.slice(0, headChars).trimEnd()}\n[... truncated by RemoteLab ...]\n${text.slice(-tailChars).trimStart()}`;
}

function clipCompactionEventText(value, maxChars = 4000) {
  const text = normalizeCompactionText(value);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return `${text.slice(0, headChars).trimEnd()}\n[... truncated by RemoteLab ...]\n${text.slice(-tailChars).trimStart()}`;
}

function formatCompactionAttachments(images) {
  const refs = (images || [])
    .map((img) => getAttachmentDisplayName(img))
    .filter(Boolean);
  if (refs.length === 0) return '';
  return `[Attached files: ${refs.join(', ')}]`;
}

function formatCompactionMessage(evt) {
  const label = evt.role === 'user' ? 'User' : 'Assistant';
  const parts = [];
  const imageLine = formatCompactionAttachments(evt.images);
  if (imageLine) parts.push(imageLine);
  const content = clipCompactionEventText(evt.content);
  if (content) parts.push(content);
  if (parts.length === 0) return '';
  return `[${label}]\n${parts.join('\n')}`;
}

function formatCompactionTemplateContext(evt) {
  const content = normalizeCompactionText(evt.content);
  if (!content) return '';
  const name = normalizeCompactionText(evt.templateName) || 'template';
  const freshnessNotice = buildTemplateFreshnessNotice(evt);
  return freshnessNotice
    ? `[Applied template context: ${name}]\n${freshnessNotice}\n\n${content}`
    : `[Applied template context: ${name}]\n${content}`;
}

function formatCompactionStatus(evt) {
  const content = clipCompactionEventText(evt.content, 1000);
  if (!content) return '';
  if (!/^error:/i.test(content) && !/interrupted/i.test(content)) return '';
  return `[System status]\n${content}`;
}

function prepareConversationOnlyContinuationBody(events) {
  const segments = (events || [])
    .map((evt) => {
      if (!evt || !evt.type) return '';
      if (evt.type === 'message' && isWorkflowAuxiliaryMessage(evt)) return '';
      if (evt.type === 'message') return formatCompactionMessage(evt);
      if (evt.type === 'template_context') return formatCompactionTemplateContext(evt);
      if (isWorkflowStatusLikeEventType(evt.type)) return formatCompactionStatus(evt);
      return '';
    })
    .filter(Boolean);

  if (segments.length === 0) return '';
  return clipCompactionSection(segments.join('\n\n'), 24000);
}

function buildToolActivityIndex(events) {
  const toolCounts = new Map();
  const recentCommands = [];
  const touchedFiles = [];
  const notableFailures = [];

  const pushRecentUnique = (entries, key, value, maxEntries) => {
    if (!key || !value) return;
    const existingIndex = entries.findIndex((entry) => entry.key === key);
    if (existingIndex !== -1) {
      entries.splice(existingIndex, 1);
    }
    entries.push({ key, value });
    if (entries.length > maxEntries) {
      entries.shift();
    }
  };

  for (const evt of events || []) {
    if (!evt || !evt.type) continue;
    if (evt.type === 'tool_use') {
      const toolName = normalizeCompactionText(evt.toolName) || 'tool';
      toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1);
      const toolInput = clipCompactionEventText(evt.toolInput, 240);
      if (toolInput) {
        pushRecentUnique(recentCommands, `${toolName}:${toolInput}`, `- ${toolName}: ${toolInput.replace(/\n/g, ' ↵ ')}`, 8);
      }
      continue;
    }
    if (evt.type === 'file_change') {
      const filePath = normalizeCompactionText(evt.filePath);
      if (!filePath) continue;
      const changeType = normalizeCompactionText(evt.changeType) || 'updated';
      pushRecentUnique(touchedFiles, `${changeType}:${filePath}`, `- ${filePath} (${changeType})`, 12);
      continue;
    }
    if (evt.type === 'tool_result') {
      const exitCode = evt.exitCode;
      if (exitCode === undefined || exitCode === 0) continue;
      const toolName = normalizeCompactionText(evt.toolName) || 'tool';
      const output = clipCompactionEventText(evt.output, 320);
      pushRecentUnique(notableFailures, `${toolName}:${exitCode}:${output}`, `- ${toolName} exit ${exitCode}: ${output.replace(/\n/g, ' ↵ ')}`, 6);
    }
  }

  const toolSummary = [...toolCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([toolName, count]) => `${toolName} ×${count}`)
    .join(', ');

  const lines = [];
  if (toolSummary) lines.push(`Tools used: ${toolSummary}`);
  if (recentCommands.length > 0) {
    lines.push('Recent tool calls:');
    lines.push(...recentCommands.map((entry) => entry.value));
  }
  if (touchedFiles.length > 0) {
    lines.push('Touched files:');
    lines.push(...touchedFiles.map((entry) => entry.value));
  }
  if (notableFailures.length > 0) {
    lines.push('Notable tool failures:');
    lines.push(...notableFailures.map((entry) => entry.value));
  }

  if (lines.length === 0) return '';
  return clipCompactionSection(lines.join('\n'), 12000);
}

export function createContextBarrierEvent(content, extra = {}) {
  return {
    type: 'context_barrier',
    role: 'system',
    id: `evt_${randomBytes(8).toString('hex')}`,
    timestamp: Date.now(),
    content,
    ...extra,
  };
}

export async function buildCompactionSourcePayload(sessionId, session, { uptoSeq = 0 } = {}) {
  const [contextHead, history] = await Promise.all([
    getContextHead(sessionId),
    loadHistory(sessionId, { includeBodies: true }),
  ]);
  const targetSeq = uptoSeq > 0 ? uptoSeq : (history.at(-1)?.seq || 0);
  const boundedHistory = history.filter((event) => (event?.seq || 0) <= targetSeq);
  const activeFromSeq = Number.isInteger(contextHead?.activeFromSeq) ? contextHead.activeFromSeq : 0;
  const sliceEvents = boundedHistory.filter((event) => (event?.seq || 0) > activeFromSeq);
  const existingSummary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const conversationBody = prepareConversationOnlyContinuationBody(sliceEvents);
  const toolIndex = buildToolActivityIndex(boundedHistory);

  if (!existingSummary && !conversationBody && !toolIndex) {
    return null;
  }

  return {
    targetSeq,
    existingSummary,
    conversationBody,
    toolIndex,
  };
}

export async function ensureContextCompactorSession(sourceSessionId, session, run) {
  const existingId = typeof session?.compactionSessionId === 'string' ? session.compactionSessionId.trim() : '';
  if (existingId) {
    const existing = await getSession(existingId);
    if (existing) {
      if ((run?.tool || session.tool) && existing.tool !== (run?.tool || session.tool)) {
        await mutateSessionMeta(existing.id, (draft) => {
          draft.tool = run?.tool || session.tool;
          draft.updatedAt = nowIso();
          return true;
        });
      }
      return existing;
    }
  }

  const metas = await loadSessionsMeta();
  const linked = metas.find((meta) => meta.compactsSessionId === sourceSessionId && isContextCompactorSession(meta));
  if (linked) {
    await mutateSessionMeta(sourceSessionId, (draft) => {
      if (draft.compactionSessionId === linked.id) return false;
      draft.compactionSessionId = linked.id;
      draft.updatedAt = nowIso();
      return true;
    });
    return enrichSessionMeta(linked);
  }

  const created = await createSession(session.folder, run?.tool || session.tool, `auto-compress - ${session.name || 'session'}`, {
    appId: session.appId || '',
    appName: session.appName || '',
    systemPrompt: CONTEXT_COMPACTOR_SYSTEM_PROMPT,
    internalRole: INTERNAL_SESSION_ROLE_CONTEXT_COMPACTOR,
    compactsSessionId: sourceSessionId,
    rootSessionId: session.rootSessionId || session.id,
  });
  if (!created) return null;

  await mutateSessionMeta(sourceSessionId, (draft) => {
    if (draft.compactionSessionId === created.id) return false;
    draft.compactionSessionId = created.id;
    draft.updatedAt = nowIso();
    return true;
  });

  return created;
}

function extractTaggedBlock(content, tagName) {
  const text = typeof content === 'string' ? content : '';
  if (!text || !tagName) return '';
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
  return (match ? match[1] : '').trim();
}

function parseCompactionWorkerOutput(content) {
  return {
    summary: extractTaggedBlock(content, 'summary'),
    handoff: extractTaggedBlock(content, 'handoff'),
  };
}

function buildFallbackCompactionHandoff(summary, toolIndex) {
  const parts = [
    '# Auto Compress',
    '',
    '## Kept in live context',
    '- RemoteLab carried forward a compressed continuation summary for the task.',
  ];

  const trimmedSummary = clipCompactionSection(summary, 3000);
  if (trimmedSummary) {
    parts.push('', trimmedSummary);
  }

  parts.push('', '## Left out of live context', '- Older messages above the marker are no longer loaded into the model\'s live context.');
  if (toolIndex) {
    parts.push('- Earlier tool activity remains in session history and is summarized as compact retrieval hints.');
  }
  parts.push('', '## Continue from here', '- Use the carried-forward summary plus the new messages below this marker.');
  return parts.join('\n');
}

export function buildContextCompactionPrompt({ session, existingSummary, conversationBody, toolIndex, automatic = false }) {
  const appInstructions = clipCompactionSection(session?.systemPrompt || '', 6000);
  const priorSummary = clipCompactionSection(existingSummary || '', 12000);
  const conversationSlice = clipCompactionSection(conversationBody || '', 18000);
  const toolActivity = clipCompactionSection(toolIndex || '', 10000);

  return [
    'Please compress this entire session into a continuation summary for the same AI worker.',
    '',
    'You are operating inside RemoteLab\'s hidden compaction worker for a parent session.',
    `Compaction trigger: ${automatic ? 'automatic auto-compress' : 'manual compact request'}`,
    '',
    'Goal:',
    '- Replace older live context with a fresh continuation package.',
    '- Preserve only what the next worker turn truly needs.',
    '- Treat older tool activity as retrievable hints, not as live prompt material.',
    '',
    'Rules:',
    '- Use only the supplied session material; do not rely on prior thread state.',
    '- Do not call tools unless absolutely necessary.',
    '- Do not include full raw tool output.',
    '- Mark uncertainty clearly.',
    '- The user-visible handoff must explicitly say that older messages above the marker are no longer in live context.',
    '',
    'Return exactly two tagged blocks:',
    '<summary>',
    'Dense operational continuation state for the next worker turn.',
    'Include the main objective, confirmed constraints, completed work, current code/system state, open questions, next steps, and critical references.',
    '</summary>',
    '',
    '<handoff>',
    '# Auto Compress',
    '## Kept in live context',
    '- ...',
    '## Left out of live context',
    '- ...',
    '## Continue from here',
    '- ...',
    '</handoff>',
    '',
    'Parent session app instructions:',
    appInstructions || '[none]',
    '',
    'Previously carried summary:',
    priorSummary || '[none]',
    '',
    'New conversation slice since the last compaction:',
    conversationSlice || '[no new conversation messages]',
    '',
    'Earlier tool activity index:',
    toolActivity || '[no earlier tool activity recorded]',
  ].join('\n');
}

async function findLatestAssistantMessageForRun(sessionId, runId) {
  const events = await loadHistory(sessionId, { includeBodies: true });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'assistant') continue;
    if (runId && event.runId !== runId) continue;
    return event;
  }
  return null;
}

export async function queueContextCompaction(sessionId, session, run, { automatic = false } = {}) {
  const live = ensureLiveSession(sessionId);
  if (live.pendingCompact) return false;

  const snapshot = await getHistorySnapshot(sessionId);
  const compactionSource = await buildCompactionSourcePayload(sessionId, session, {
    uptoSeq: snapshot.latestSeq,
  });
  if (!compactionSource) return false;

  const compactorSession = await ensureContextCompactorSession(sessionId, session, run);
  if (!compactorSession) return false;

  live.pendingCompact = true;

  const statusText = automatic
    ? getAutoCompactStatusText(run)
    : 'Auto Compress is condensing older context…';
  const compactQueuedEvent = statusEvent(statusText);
  await appendEvent(sessionId, compactQueuedEvent);
  broadcastSessionInvalidation(sessionId);

  try {
    await sendMessage(compactorSession.id, buildContextCompactionPrompt({
      session,
      existingSummary: compactionSource.existingSummary,
      conversationBody: compactionSource.conversationBody,
      toolIndex: compactionSource.toolIndex,
      automatic,
    }), [], {
      tool: run?.tool || session.tool,
      model: run?.model || undefined,
      effort: run?.effort || undefined,
      thinking: false,
      recordUserMessage: false,
      queueIfBusy: false,
      freshThread: true,
      skipSessionContinuation: true,
      internalOperation: 'context_compaction_worker',
      compactionTargetSessionId: sessionId,
      compactionSourceSeq: compactionSource.targetSeq,
      compactionToolIndex: compactionSource.toolIndex,
      compactionReason: automatic ? 'automatic' : 'manual',
    });
    return true;
  } catch (error) {
    live.pendingCompact = false;
    const failure = statusEvent(`error: failed to compact context: ${error.message}`);
    await appendEvent(sessionId, failure);
    broadcastSessionInvalidation(sessionId);
    return false;
  }
}

export async function maybeAutoCompact(sessionId, session, run, manifest) {
  if (!session || !run || manifest?.internalOperation) return false;
  if (getSessionQueueCount(session) > 0) return false;
  const contextTokens = getRunLiveContextTokens(run);
  const autoCompactTokens = getAutoCompactContextTokens(run);
  if (!Number.isInteger(contextTokens) || !Number.isFinite(autoCompactTokens)) return false;
  if (contextTokens <= autoCompactTokens) return false;
  return queueContextCompaction(sessionId, session, run, { automatic: true });
}

export async function applyCompactionWorkerResult(targetSessionId, run, manifest) {
  const workerEvent = await findLatestAssistantMessageForRun(run.sessionId, run.id);
  const parsed = parseCompactionWorkerOutput(workerEvent?.content || '');
  const summary = parsed.summary;
  if (!summary) {
    await appendEvent(targetSessionId, statusEvent('error: failed to apply auto compress: compaction worker returned no <summary> block'));
    return false;
  }

  const barrierEvent = await appendEvent(targetSessionId, createContextBarrierEvent(AUTO_COMPACT_MARKER_TEXT, {
    automatic: manifest?.compactionReason === 'automatic',
    compactionSessionId: run.sessionId,
  }));
  const handoffContent = parsed.handoff || buildFallbackCompactionHandoff(summary, manifest?.compactionToolIndex || '');
  const handoffEvent = await appendEvent(targetSessionId, messageEvent('assistant', handoffContent, undefined, {
    source: 'context_compaction_handoff',
    compactionRunId: run.id,
  }));
  const compactEvent = await appendEvent(targetSessionId, statusEvent('Auto Compress finished — continue from the handoff below'));

  await setContextHead(targetSessionId, {
    mode: 'summary',
    summary,
    toolIndex: manifest?.compactionToolIndex || '',
    activeFromSeq: compactEvent.seq,
    compactedThroughSeq: Number.isInteger(manifest?.compactionSourceSeq) ? manifest.compactionSourceSeq : compactEvent.seq,
    inputTokens: run.contextInputTokens || null,
    updatedAt: nowIso(),
    source: 'context_compaction',
    barrierSeq: barrierEvent.seq,
    handoffSeq: handoffEvent.seq,
    compactionSessionId: run.sessionId,
  });

  await clearPersistedResumeIds(targetSessionId);
  return true;
}

export function clearPendingCompact(sessionId) {
  const live = liveSessions().get(sessionId);
  if (live) {
    live.pendingCompact = false;
  }
}

export function clearTargetPendingCompact(sessionId) {
  const live = liveSessions().get(sessionId);
  if (live) {
    live.pendingCompact = false;
  }
}

export function flushFollowUpsAfterCompaction(sessionId, session) {
  if (getSessionQueueCount(session) > 0) {
    scheduleQueuedFollowUpDispatch(sessionId);
  }
}
