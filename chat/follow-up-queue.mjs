import { getRun, isTerminalRunState } from './runs.mjs';
import { findSessionMeta, mutateSessionMeta } from './session-meta-store.mjs';

let dependencies = null;

function requireDeps() {
  if (!dependencies) {
    throw new Error('follow-up-queue dependencies are not configured');
  }
  return dependencies;
}

export function configureFollowUpQueue(nextDependencies) {
  dependencies = nextDependencies;
}

function liveSessions() {
  return requireDeps().liveSessions;
}

function ensureLiveSession(sessionId) {
  return requireDeps().ensureLiveSession(sessionId);
}

function flushDetachedRunIfNeeded(sessionId, runId) {
  return requireDeps().flushDetachedRunIfNeeded(sessionId, runId);
}

function submitHttpMessage(sessionId, text, images, options = {}) {
  return requireDeps().submitHttpMessage(sessionId, text, images, options);
}

function broadcastSessionInvalidation(sessionId) {
  return requireDeps().broadcastSessionInvalidation(sessionId);
}

function nowIso() {
  return requireDeps().nowIso();
}

function createInternalRequestId(prefix = 'internal') {
  return requireDeps().createInternalRequestId(prefix);
}

function sanitizeOriginalAttachmentName(value) {
  return requireDeps().sanitizeOriginalAttachmentName(value);
}

function resolveAttachmentMimeType(mimeType, originalName = '') {
  return requireDeps().resolveAttachmentMimeType(mimeType, originalName);
}

function getAttachmentDisplayName(attachment) {
  return requireDeps().getAttachmentDisplayName(attachment);
}

export const FOLLOW_UP_FLUSH_DELAY_MS = 1500;
export const MAX_RECENT_FOLLOW_UP_REQUEST_IDS = 100;

export function getFollowUpQueue(meta) {
  return Array.isArray(meta?.followUpQueue) ? meta.followUpQueue : [];
}

export function getFollowUpQueueCount(meta) {
  return getFollowUpQueue(meta).length;
}

export function sanitizeQueuedFollowUpAttachments(images) {
  return (images || [])
    .map((image) => {
      const filename = typeof image?.filename === 'string' ? image.filename.trim() : '';
      const savedPath = typeof image?.savedPath === 'string' ? image.savedPath.trim() : '';
      const originalName = sanitizeOriginalAttachmentName(image?.originalName || '');
      const mimeType = resolveAttachmentMimeType(image?.mimeType, originalName || filename);
      if (!filename || !savedPath) return null;
      return {
        filename,
        savedPath,
        ...(originalName ? { originalName } : {}),
        mimeType,
      };
    })
    .filter(Boolean);
}

export function sanitizeQueuedFollowUpOptions(options = {}) {
  const next = {};
  if (typeof options.tool === 'string' && options.tool.trim()) next.tool = options.tool.trim();
  if (typeof options.model === 'string' && options.model.trim()) next.model = options.model.trim();
  if (typeof options.effort === 'string' && options.effort.trim()) next.effort = options.effort.trim();
  if (options.thinking === true) next.thinking = true;
  return next;
}

export function serializeQueuedFollowUp(entry) {
  return {
    requestId: typeof entry?.requestId === 'string' ? entry.requestId : '',
    text: typeof entry?.text === 'string' ? entry.text : '',
    queuedAt: typeof entry?.queuedAt === 'string' ? entry.queuedAt : '',
    images: (entry?.images || []).map((image) => ({
      filename: image.filename,
      originalName: image.originalName,
      mimeType: image.mimeType,
    })),
  };
}

export function trimRecentFollowUpRequestIds(ids) {
  if (!Array.isArray(ids)) return [];
  const unique = [];
  const seen = new Set();
  for (const value of ids) {
    const requestId = typeof value === 'string' ? value.trim() : '';
    if (!requestId || seen.has(requestId)) continue;
    seen.add(requestId);
    unique.push(requestId);
  }
  return unique.slice(-MAX_RECENT_FOLLOW_UP_REQUEST_IDS);
}

export function hasRecentFollowUpRequestId(meta, requestId) {
  const normalized = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalized) return false;
  return trimRecentFollowUpRequestIds(meta?.recentFollowUpRequestIds).includes(normalized);
}

export function findQueuedFollowUpByRequest(meta, requestId) {
  const normalized = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalized) return null;
  return getFollowUpQueue(meta).find((entry) => entry.requestId === normalized) || null;
}

export function formatQueuedFollowUpTextEntry(entry, index) {
  const lines = [];
  if (index !== null) {
    lines.push(`${index + 1}.`);
  }
  const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
  if (text) {
    if (index !== null) {
      lines[0] = `${lines[0]} ${text}`;
    } else {
      lines.push(text);
    }
  }
  const attachmentNames = (entry?.images || []).map((image) => getAttachmentDisplayName(image)).filter(Boolean);
  if (attachmentNames.length > 0) {
    lines.push(`[Attached files: ${attachmentNames.join(', ')}]`);
  }
  return lines.join('\n');
}

export function buildQueuedFollowUpTranscriptText(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return '';
  if (queue.length === 1) {
    return formatQueuedFollowUpTextEntry(queue[0], null);
  }
  return [
    'Queued follow-up messages sent while RemoteLab was busy:',
    '',
    ...queue.map((entry, index) => formatQueuedFollowUpTextEntry(entry, index)),
  ].join('\n\n');
}

export function buildQueuedFollowUpDispatchText(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return '';
  if (queue.length === 1) {
    return buildQueuedFollowUpTranscriptText(queue);
  }
  return [
    `The user sent ${queue.length} follow-up messages while you were busy.`,
    'Treat the ordered items below as the next user turn.',
    'If a later item corrects or overrides an earlier one, follow the latest correction.',
    '',
    ...queue.map((entry, index) => formatQueuedFollowUpTextEntry(entry, index)),
  ].join('\n\n');
}

export function resolveQueuedFollowUpDispatchOptions(queue, session) {
  const resolved = {
    tool: session?.tool || '',
    model: undefined,
    effort: undefined,
    thinking: false,
  };
  for (const entry of queue || []) {
    if (typeof entry?.tool === 'string' && entry.tool.trim()) {
      resolved.tool = entry.tool.trim();
    }
    if (typeof entry?.model === 'string' && entry.model.trim()) {
      resolved.model = entry.model.trim();
    }
    if (typeof entry?.effort === 'string' && entry.effort.trim()) {
      resolved.effort = entry.effort.trim();
    }
    if (entry?.thinking === true) {
      resolved.thinking = true;
    }
  }
  if (!resolved.tool) {
    resolved.tool = session?.tool || 'codex';
  }
  return resolved;
}

export function clearFollowUpFlushTimer(sessionId) {
  const live = liveSessions().get(sessionId);
  if (!live?.followUpFlushTimer) return false;
  clearTimeout(live.followUpFlushTimer);
  delete live.followUpFlushTimer;
  return true;
}

export async function flushQueuedFollowUps(sessionId) {
  const live = ensureLiveSession(sessionId);
  if (live.followUpFlushPromise) {
    return live.followUpFlushPromise;
  }

  const promise = (async () => {
    clearFollowUpFlushTimer(sessionId);

    const rawSession = await findSessionMeta(sessionId);
    if (!rawSession || rawSession.archived) return false;

    if (rawSession.activeRunId) {
      const activeRun = await flushDetachedRunIfNeeded(sessionId, rawSession.activeRunId) || await getRun(rawSession.activeRunId);
      if (activeRun && !isTerminalRunState(activeRun.state)) {
        return false;
      }
    }

    const queue = getFollowUpQueue(rawSession);
    if (queue.length === 0) return false;

    const requestIds = queue.map((entry) => entry.requestId).filter(Boolean);
    const dispatchText = buildQueuedFollowUpDispatchText(queue);
    const transcriptText = buildQueuedFollowUpTranscriptText(queue);
    const dispatchOptions = resolveQueuedFollowUpDispatchOptions(queue, rawSession);

    await submitHttpMessage(sessionId, dispatchText, [], {
      requestId: createInternalRequestId('queued_batch'),
      tool: dispatchOptions.tool,
      model: dispatchOptions.model,
      effort: dispatchOptions.effort,
      thinking: dispatchOptions.thinking,
      preSavedAttachments: queue.flatMap((entry) => sanitizeQueuedFollowUpAttachments(entry.images)),
      recordedUserText: transcriptText,
      queueIfBusy: false,
    });

    const cleared = await mutateSessionMeta(sessionId, (session) => {
      const currentQueue = getFollowUpQueue(session);
      if (currentQueue.length === 0) return false;
      const requestIdSet = new Set(requestIds);
      const nextQueue = currentQueue.filter((entry) => !requestIdSet.has(entry.requestId));
      if (nextQueue.length === currentQueue.length && requestIdSet.size > 0) {
        return false;
      }
      if (nextQueue.length > 0) {
        session.followUpQueue = nextQueue;
      } else {
        delete session.followUpQueue;
      }
      session.recentFollowUpRequestIds = trimRecentFollowUpRequestIds([
        ...(session.recentFollowUpRequestIds || []),
        ...requestIds,
      ]);
      session.updatedAt = nowIso();
      return true;
    });

    if (cleared.changed) {
      broadcastSessionInvalidation(sessionId);
    }
    return true;
  })().catch((error) => {
    console.error(`[follow-up-queue] failed to flush ${sessionId}: ${error.message}`);
    scheduleQueuedFollowUpDispatch(sessionId, FOLLOW_UP_FLUSH_DELAY_MS * 2);
    return false;
  }).finally(() => {
    const current = liveSessions().get(sessionId);
    if (current?.followUpFlushPromise === promise) {
      delete current.followUpFlushPromise;
    }
  });

  live.followUpFlushPromise = promise;
  return promise;
}

export function scheduleQueuedFollowUpDispatch(sessionId, delayMs = FOLLOW_UP_FLUSH_DELAY_MS) {
  const live = ensureLiveSession(sessionId);
  if (live.followUpFlushPromise) return true;
  clearFollowUpFlushTimer(sessionId);
  live.followUpFlushTimer = setTimeout(() => {
    const current = liveSessions().get(sessionId);
    if (current?.followUpFlushTimer) {
      delete current.followUpFlushTimer;
    }
    void flushQueuedFollowUps(sessionId);
  }, delayMs);
  if (typeof live.followUpFlushTimer.unref === 'function') {
    live.followUpFlushTimer.unref();
  }
  return true;
}
