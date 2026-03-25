import { randomBytes } from 'crypto';
import { getToolDefinitionAsync } from '../lib/tools.mjs';
import {
  appendEvent,
  clearForkContext,
  loadHistory,
} from './history.mjs';
import { messageEvent, statusEvent, systemEvent } from './normalizer.mjs';
import { sendDecisionPush } from './push.mjs';
import {
  CODEX_VERIFICATION_READ_ONLY_DEVELOPER_INSTRUCTIONS,
  DEFAULT_CODEX_DEVELOPER_INSTRUCTIONS,
} from './runtime-policy.mjs';
import {
  normalizeSessionDescription,
  normalizeSessionGroup,
} from './session-naming.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from './session-workflow-state.mjs';
import { triggerSessionWorkflowStateSuggestion } from './summarizer.mjs';
import { getRun } from './runs.mjs';
import {
  getSessionQueueCount,
  isSessionRunning,
} from './session-activity.mjs';
import {
  findSessionMeta,
  loadSessionsMeta,
  mutateSessionMeta,
} from './session-meta-store.mjs';
import { getApp, listApps, normalizeAppId } from './apps.mjs';
import {
  normalizeWorkflowSuggestion,
  suggestNextStep,
} from './run-completion-suggestions.mjs';

let dependencies = null;

const WORKFLOW_MAINLINE_APP_NAMES = ['执行', '主交付', '功能交付'];
const WORKFLOW_VERIFICATION_APP_NAMES = ['验收', '执行验收', '风险复核'];
const WORKFLOW_DELIBERATION_APP_NAMES = ['再议', '深度裁决', 'PR把关', '合并', '发布把关', '推敲'];
const WORKFLOW_PENDING_LIMIT = 20;
const CODEX_DELIBERATION_ADVISORY_DEVELOPER_INSTRUCTIONS = [
  'Treat this session as an advisory deliberation lane.',
  'Inspect code and context as needed, but do not modify files and do not produce code changes.',
  'Return judgments, tradeoffs, risks, and recommended next steps only.',
].join(' ');
const WORKFLOW_RISK_SIGNAL_KEYWORDS = Object.freeze([
  '风险',
  '需要确认',
  'needs decision',
  'needs_fix',
  'needs_more_validation',
  '无法验证',
  '未验证',
  'blocked',
  'blocker',
  'todo',
  'rollback',
  '回退',
  'breaking',
  'incompatible',
  '兼容性',
  'uncertain',
  'unknown',
]);

function requireDeps() {
  if (!dependencies) {
    throw new Error('workflow-engine dependencies are not configured');
  }
  return dependencies;
}

export function configureWorkflowEngine(nextDependencies) {
  dependencies = nextDependencies;
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

function broadcastSessionInvalidation(sessionId) {
  return requireDeps().broadcastSessionInvalidation(sessionId);
}

function broadcastSessionsInvalidation() {
  return requireDeps().broadcastSessionsInvalidation();
}

function shouldExposeSession(session) {
  return requireDeps().shouldExposeSession(session);
}

function isInternalSession(session) {
  return requireDeps().isInternalSession(session);
}

function nowIso() {
  return requireDeps().nowIso();
}

function createInternalRequestId(prefix = 'internal') {
  return requireDeps().createInternalRequestId(prefix);
}

function updateSessionHandoffTarget(id, handoffTargetSessionId) {
  return requireDeps().updateSessionHandoffTarget(id, handoffTargetSessionId);
}

function submitHttpMessage(sessionId, text, images, options = {}) {
  return requireDeps().submitHttpMessage(sessionId, text, images, options);
}

function generateId() {
  return randomBytes(16).toString('hex');
}

function clipCompactionSection(value, maxChars = 12000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return `${text.slice(0, headChars).trimEnd()}\n[... truncated by RemoteLab ...]\n${text.slice(-tailChars).trimStart()}`;
}

function normalizeWorktreeCoordinationText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSessionAppName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeWorkflowCurrentTask(value) {
  return normalizeSessionDescription(value || '');
}

export function normalizeWorkflowLaunchMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['quick_execute', 'standard_delivery', 'careful_deliberation', 'parallel_split'].includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeWorkflowDecisionConfidence(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['high', 'medium', 'low'].includes(normalized)) return normalized;
  return '';
}

function normalizeWorkflowVerificationRecommendation(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['ok', 'needs_fix', 'needs_more_validation'].includes(normalized)) return normalized;
  return '';
}

function normalizeWorkflowConclusionStatus(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['pending', 'needs_decision', 'accepted', 'ignored', 'superseded'].includes(normalized)) {
    return normalized;
  }
  return 'pending';
}

function normalizeWorkflowHandoffKind(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['risk_review', 'pr_gate', 'workflow'].includes(normalized)) return normalized;
  return 'workflow';
}

export function normalizeWorkflowHandoffType(value, fallbackKind = '') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['verification_result', 'decision_result', 'workflow_result'].includes(normalized)) {
    return normalized;
  }
  const legacyKind = normalizeWorkflowHandoffKind(fallbackKind);
  if (legacyKind === 'risk_review') return 'verification_result';
  if (legacyKind === 'pr_gate') return 'decision_result';
  return 'workflow_result';
}

function getWorkflowHandoffTypeLabel(handoffType) {
  const normalized = normalizeWorkflowHandoffType(handoffType);
  if (normalized === 'verification_result') return '验收结果';
  if (normalized === 'decision_result') return '再议结论';
  return '结果转交';
}

function normalizeWorkflowConclusionSummary(value) {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  return clipCompactionSection(compact, 280);
}

function normalizeWorkflowConclusionList(values = [], maxItems = 12) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeWorkflowConclusionSummary(typeof value === 'string' ? value : ''))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeWorkflowParallelTaskText(value, maxChars = 600) {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact ? clipCompactionSection(compact, maxChars) : '';
}

function normalizeWorkflowParallelTask(task = {}, index = 0) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
  const title = normalizeWorkflowParallelTaskText(task.title || task.name || '', 120) || `并行子任务 ${index + 1}`;
  const taskText = normalizeWorkflowParallelTaskText(task.task || task.goal || task.summary || '', 600);
  const boundary = normalizeWorkflowParallelTaskText(task.boundary || task.constraints || '', 400);
  const repo = normalizeWorkflowParallelTaskText(task.repo || task.folder || task.project || '', 240);
  if (!(title || taskText || boundary || repo)) return null;
  return {
    title,
    ...(taskText ? { task: taskText } : {}),
    ...(boundary ? { boundary } : {}),
    ...(repo ? { repo } : {}),
  };
}

function normalizeWorkflowParallelTasks(values = [], maxItems = 8) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value, index) => normalizeWorkflowParallelTask(value, index))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeWorkflowConclusionPayload(payload = {}, handoffType = 'workflow_result') {
  const normalizedType = normalizeWorkflowHandoffType(handoffType);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  if (normalizedType === 'verification_result') {
    return {
      ...(normalizeWorkflowConclusionSummary(payload.summary || '') ? { summary: normalizeWorkflowConclusionSummary(payload.summary || '') } : {}),
      ...(normalizeWorkflowVerificationRecommendation(payload.recommendation || '') ? { recommendation: normalizeWorkflowVerificationRecommendation(payload.recommendation || '') } : {}),
      ...(normalizeWorkflowDecisionConfidence(payload.confidence || '') ? { confidence: normalizeWorkflowDecisionConfidence(payload.confidence || '') } : {}),
      ...(normalizeWorkflowConclusionList(payload.validated).length > 0 ? { validated: normalizeWorkflowConclusionList(payload.validated) } : {}),
      ...(normalizeWorkflowConclusionList(payload.unverified).length > 0 ? { unverified: normalizeWorkflowConclusionList(payload.unverified) } : {}),
      ...(normalizeWorkflowConclusionList(payload.findings).length > 0 ? { findings: normalizeWorkflowConclusionList(payload.findings) } : {}),
      ...(normalizeWorkflowConclusionList(payload.evidence).length > 0 ? { evidence: normalizeWorkflowConclusionList(payload.evidence) } : {}),
    };
  }
  if (normalizedType === 'decision_result') {
    return {
      ...(normalizeWorkflowConclusionSummary(payload.summary || '') ? { summary: normalizeWorkflowConclusionSummary(payload.summary || '') } : {}),
      ...(normalizeWorkflowConclusionSummary(payload.recommendation || '') ? { recommendation: normalizeWorkflowConclusionSummary(payload.recommendation || '') } : {}),
      ...(normalizeWorkflowDecisionConfidence(payload.confidence || '') ? { confidence: normalizeWorkflowDecisionConfidence(payload.confidence || '') } : {}),
      ...(normalizeWorkflowConclusionList(payload.rejectedOptions).length > 0 ? { rejectedOptions: normalizeWorkflowConclusionList(payload.rejectedOptions) } : {}),
      ...(normalizeWorkflowConclusionList(payload.tradeoffs).length > 0 ? { tradeoffs: normalizeWorkflowConclusionList(payload.tradeoffs) } : {}),
      ...(normalizeWorkflowConclusionList(payload.decisionNeeded).length > 0 ? { decisionNeeded: normalizeWorkflowConclusionList(payload.decisionNeeded) } : {}),
      ...(normalizeWorkflowParallelTasks(payload.parallelTasks).length > 0 ? { parallelTasks: normalizeWorkflowParallelTasks(payload.parallelTasks) } : {}),
    };
  }
  return {
    ...(normalizeWorkflowConclusionSummary(payload.summary || '') ? { summary: normalizeWorkflowConclusionSummary(payload.summary || '') } : {}),
  };
}

function normalizeWorkflowPendingConclusion(conclusion = {}) {
  const handoffKind = normalizeWorkflowHandoffKind(conclusion?.handoffKind || '');
  const handoffType = normalizeWorkflowHandoffType(conclusion?.handoffType || '', handoffKind);
  const status = normalizeWorkflowConclusionStatus(conclusion?.status || '');
  const summary = normalizeWorkflowConclusionSummary(conclusion?.summary || '');
  const payload = normalizeWorkflowConclusionPayload(conclusion?.payload || {}, handoffType);
  return {
    id: typeof conclusion?.id === 'string' && conclusion.id.trim() ? conclusion.id.trim() : generateId(),
    sourceSessionId: typeof conclusion?.sourceSessionId === 'string' ? conclusion.sourceSessionId.trim() : '',
    sourceSessionName: typeof conclusion?.sourceSessionName === 'string' ? conclusion.sourceSessionName.trim() : '',
    handoffKind,
    handoffType,
    label: typeof conclusion?.label === 'string' && conclusion.label.trim()
      ? conclusion.label.trim()
      : getWorkflowHandoffTypeLabel(handoffType),
    summary,
    status,
    round: Number.isInteger(conclusion?.round) && conclusion.round > 0 ? conclusion.round : 1,
    createdAt: typeof conclusion?.createdAt === 'string' && conclusion.createdAt.trim() ? conclusion.createdAt.trim() : nowIso(),
    ...(typeof conclusion?.handledAt === 'string' && conclusion.handledAt.trim() ? { handledAt: conclusion.handledAt.trim() } : {}),
    ...(typeof conclusion?.eventSeq === 'number' ? { eventSeq: conclusion.eventSeq } : {}),
    ...(typeof conclusion?.supersedesHandoffId === 'string' && conclusion.supersedesHandoffId.trim() ? { supersedesHandoffId: conclusion.supersedesHandoffId.trim() } : {}),
    ...(Object.keys(payload).length > 0 ? { payload } : {}),
  };
}

function normalizeWorkflowPendingConclusions(conclusions = []) {
  if (!Array.isArray(conclusions)) return [];
  return conclusions
    .map((item) => normalizeWorkflowPendingConclusion(item))
    .filter((item) => item.summary)
    .slice(-WORKFLOW_PENDING_LIMIT);
}

function findWorkflowPendingConclusion(session, predicate) {
  const entries = normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || []);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (predicate(entry)) return entry;
  }
  return null;
}

function hasOpenWorkflowConclusions(session) {
  return normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || []).some((entry) => (
    ['pending', 'needs_decision'].includes(normalizeWorkflowConclusionStatus(entry.status))
  ));
}

function hasPendingDecision(session) {
  return normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || []).some((entry) => (
    normalizeWorkflowConclusionStatus(entry.status) === 'needs_decision'
  ));
}

function extractTaggedBlock(content, tagName) {
  const text = typeof content === 'string' ? content : '';
  if (!text || !tagName) return '';
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
  return (match ? match[1] : '').trim();
}

function stripTaggedBlock(content, tagName) {
  const text = typeof content === 'string' ? content : '';
  if (!text || !tagName) return '';
  return text.replace(new RegExp(`<${tagName}>[\\s\\S]*?</${tagName}>`, 'ig'), '').trim();
}

function parseJsonObjectText(modelText) {
  const text = typeof modelText === 'string' ? modelText.trim() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
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

function findLatestAssistantConclusion(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event?.type !== 'message' || event?.role !== 'assistant') continue;
    if (isWorkflowAuxiliaryMessage(event)) continue;
    if (typeof event?.content === 'string' && event.content.trim()) {
      return event;
    }
  }
  return null;
}

export function isWorkflowAuxiliaryMessage(event) {
  return event?.type === 'message'
    && event?.role === 'assistant'
    && ['session_delegate_notice', 'workflow_handoff_notice', 'workflow_handoff'].includes(event?.messageKind || '');
}

export function isWorkflowStatusLikeEventType(type = '') {
  return ['status', 'workflow_auto_absorb', 'workflow_auto_advance'].includes(type);
}

export function isWorkflowMainlineAppName(appName) {
  return WORKFLOW_MAINLINE_APP_NAMES.includes(normalizeSessionAppName(appName || ''));
}

export function isWorkflowVerificationAppName(appName) {
  return WORKFLOW_VERIFICATION_APP_NAMES.includes(normalizeSessionAppName(appName || ''));
}

export function isWorkflowDeliberationAppName(appName) {
  return WORKFLOW_DELIBERATION_APP_NAMES.includes(normalizeSessionAppName(appName || ''));
}

export function getWorkflowSessionAppName(session) {
  return normalizeSessionAppName(
    session?.templateAppName
    || session?.appName
    || '',
  );
}

export function isWorkflowMainlineSession(session) {
  if (!session || normalizeWorktreeCoordinationText(session?.handoffTargetSessionId || '')) {
    return false;
  }
  return isWorkflowMainlineAppName(getWorkflowSessionAppName(session));
}

export function isWorkflowVerificationSession(session) {
  return isWorkflowVerificationAppName(getWorkflowSessionAppName(session));
}

export function isWorkflowDeliberationSession(session) {
  return isWorkflowDeliberationAppName(getWorkflowSessionAppName(session));
}

function getWorkflowHandoffKind(session) {
  const appName = getWorkflowSessionAppName(session);
  if (isWorkflowVerificationAppName(appName)) return 'risk_review';
  if (isWorkflowDeliberationAppName(appName)) return 'pr_gate';
  return 'workflow';
}

export function getWorkflowHandoffTypeForSession(session) {
  return normalizeWorkflowHandoffType('', getWorkflowHandoffKind(session));
}

function getWorkflowHandoffTypeIntro(handoffType) {
  const normalized = normalizeWorkflowHandoffType(handoffType);
  if (normalized === 'verification_result') return '以下是本轮验收的最新结果。';
  if (normalized === 'decision_result') return '以下是本轮再议的最新结论。';
  return '以下是本会话的最新结论。';
}

export function buildWorkflowCurrentTaskPromptBlock(session) {
  const currentTask = normalizeWorkflowCurrentTask(session?.currentTask || session?.workflowCurrentTask || '');
  if (!currentTask) return '';
  return `Current task: ${currentTask}`;
}

export function buildWorkflowStagePromptBlock() {
  return '';
}

export function buildWorkflowPendingConclusionsPromptBlock(session) {
  if (!isWorkflowMainlineSession(session)) {
    return '';
  }
  const entries = normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || [])
    .filter((entry) => ['pending', 'needs_decision'].includes(normalizeWorkflowConclusionStatus(entry.status)));
  if (entries.length === 0) return 'No open workflow handoffs.';
  const lines = entries.map((entry, index) => {
    const source = entry.sourceSessionName ? `来源：${entry.sourceSessionName}` : '来源：辅助会话';
    const status = normalizeWorkflowConclusionStatus(entry.status) === 'needs_decision' ? '状态：待用户决策' : '状态：待处理';
    const confidence = entry.handoffType === 'decision_result' && entry?.payload?.confidence
      ? `\n   - 置信度：${entry.payload.confidence}`
      : '';
    return `${index + 1}. ${entry.label || getWorkflowHandoffTypeLabel(entry.handoffType)}\n   - ${source}\n   - ${status}${confidence}\n   - 摘要：${entry.summary}`;
  });
  return [
    'Open workflow conclusions requiring attention:',
    ...lines,
    'When relevant, explicitly absorb, reject, or defer these conclusions instead of silently ignoring them.',
  ].join('\n');
}

export async function updateSessionWorkflowClassification(id, payload = {}) {
  const {
    workflowState,
    workflowPriority,
  } = payload;
  const nextWorkflowState = normalizeSessionWorkflowState(workflowState || '');
  const hasWorkflowState = Object.prototype.hasOwnProperty.call(payload, 'workflowState');
  const nextWorkflowPriority = normalizeSessionWorkflowPriority(workflowPriority || '');
  const hasWorkflowPriority = Object.prototype.hasOwnProperty.call(payload, 'workflowPriority');
  const shouldRefreshUpdatedAt = (hasWorkflowState && !!nextWorkflowState) || (hasWorkflowPriority && !!nextWorkflowPriority);
  const result = await mutateSessionMeta(id, (session) => {
    const currentWorkflowState = normalizeSessionWorkflowState(session.workflowState || '');
    const currentWorkflowPriority = normalizeSessionWorkflowPriority(session.workflowPriority || '');
    let changed = false;

    if (hasWorkflowState) {
      if (nextWorkflowState) {
        if (currentWorkflowState !== nextWorkflowState) {
          session.workflowState = nextWorkflowState;
          changed = true;
        }
      } else if (currentWorkflowState) {
        delete session.workflowState;
        changed = true;
      }
    }

    if (hasWorkflowPriority) {
      if (nextWorkflowPriority) {
        if (currentWorkflowPriority !== nextWorkflowPriority) {
          session.workflowPriority = nextWorkflowPriority;
          changed = true;
        }
      } else if (currentWorkflowPriority) {
        delete session.workflowPriority;
        changed = true;
      }
    }

    if (changed && shouldRefreshUpdatedAt) {
      session.updatedAt = nowIso();
    }
    return changed;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
  }
  return enrichSessionMeta(result.meta);
}

export async function updateSessionWorkflowState(id, workflowState) {
  return updateSessionWorkflowClassification(id, { workflowState });
}

export async function updateSessionWorkflowPriority(id, workflowPriority) {
  return updateSessionWorkflowClassification(id, { workflowPriority });
}

export async function updateSessionWorkflowCurrentTask(id, workflowCurrentTask) {
  const nextCurrentTask = normalizeWorkflowCurrentTask(workflowCurrentTask || '');
  const result = await mutateSessionMeta(id, (session) => {
    const currentCurrentTask = normalizeWorkflowCurrentTask(session.currentTask || session.workflowCurrentTask || '');
    if (nextCurrentTask) {
      if (currentCurrentTask === nextCurrentTask) return false;
      session.currentTask = nextCurrentTask;
      delete session.workflowCurrentTask;
    } else if (currentCurrentTask) {
      delete session.currentTask;
      delete session.workflowCurrentTask;
    } else {
      return false;
    }
    session.updatedAt = nowIso();
    return true;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
  }
  return enrichSessionMeta(result.meta);
}

async function updateSessionWorkflowSuggestion(id, suggestion) {
  const nextSuggestion = normalizeWorkflowSuggestion(suggestion || null, nowIso());
  const result = await mutateSessionMeta(id, (session) => {
    const currentSuggestion = normalizeWorkflowSuggestion(session.workflowSuggestion || null);
    if (!nextSuggestion) {
      if (!currentSuggestion) return false;
      delete session.workflowSuggestion;
      session.updatedAt = nowIso();
      return true;
    }
    if (JSON.stringify(currentSuggestion || null) === JSON.stringify(nextSuggestion)) {
      return false;
    }
    session.workflowSuggestion = nextSuggestion;
    session.updatedAt = nowIso();
    return true;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
  }
  return enrichSessionMeta(result.meta);
}

function getActiveWorkflowSuggestion(session) {
  const normalized = normalizeWorkflowSuggestion(session?.workflowSuggestion || null);
  if (!normalized || normalized.status !== 'pending') return null;
  return normalized;
}

async function appendWorkflowPendingConclusion(id, conclusion) {
  const baseConclusion = normalizeWorkflowPendingConclusion(conclusion);
  const result = await mutateSessionMeta(id, (session) => {
    const stamp = nowIso();
    const current = normalizeWorkflowPendingConclusions(session.workflowPendingConclusions || []);
    const sameSourceTypeEntries = current.filter((item) => (
      item.sourceSessionId
      && item.sourceSessionId === baseConclusion.sourceSessionId
      && normalizeWorkflowHandoffType(item.handoffType || '', item.handoffKind || '') === baseConclusion.handoffType
    ));

    let supersedesHandoffId = '';
    const updated = current.map((item) => {
      const sameSource = item.sourceSessionId && item.sourceSessionId === baseConclusion.sourceSessionId;
      const sameType = normalizeWorkflowHandoffType(item.handoffType || '', item.handoffKind || '') === baseConclusion.handoffType;
      const unresolved = ['pending', 'needs_decision'].includes(normalizeWorkflowConclusionStatus(item.status));
      if (!(sameSource && sameType && unresolved)) {
        return item;
      }
      supersedesHandoffId = item.id;
      return {
        ...item,
        status: 'superseded',
        handledAt: stamp,
      };
    });

    const nextRound = sameSourceTypeEntries.reduce((maxRound, item) => {
      const currentRound = Number.isInteger(item?.round) && item.round > 0 ? item.round : 1;
      return Math.max(maxRound, currentRound);
    }, 0) + 1;

    const nextConclusion = {
      ...baseConclusion,
      round: nextRound,
      createdAt: stamp,
      ...(supersedesHandoffId ? { supersedesHandoffId } : {}),
    };

    updated.push(nextConclusion);
    session.workflowPendingConclusions = updated.slice(-WORKFLOW_PENDING_LIMIT);
    session.updatedAt = stamp;
    return true;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
  }
  return enrichSessionMeta(result.meta);
}

function clearTaggedBlocks(content = '') {
  return String(content || '')
    .replace(/<verification_result>[\s\S]*?<\/verification_result>/giu, '')
    .replace(/<decision_result>[\s\S]*?<\/decision_result>/giu, '')
    .replace(/<delivery_summary>[\s\S]*?<\/delivery_summary>/giu, '')
    .trim();
}

function parseWorkflowVerificationResult(content) {
  const taggedPayloadText = extractTaggedBlock(content, 'verification_result');
  const parsedPayload = taggedPayloadText ? parseJsonObjectText(taggedPayloadText) : null;
  const payload = normalizeWorkflowConclusionPayload(parsedPayload || {}, 'verification_result');
  const summary = normalizeWorkflowConclusionSummary(
    (parsedPayload && typeof parsedPayload.summary === 'string' ? parsedPayload.summary : '')
    || clearTaggedBlocks(content),
  );
  return { summary, payload };
}

function parseWorkflowDecisionResult(content) {
  const taggedPayloadText = extractTaggedBlock(content, 'decision_result');
  const parsedPayload = taggedPayloadText ? parseJsonObjectText(taggedPayloadText) : null;
  const payload = normalizeWorkflowConclusionPayload(parsedPayload || {}, 'decision_result');
  const summary = normalizeWorkflowConclusionSummary(
    (parsedPayload && typeof parsedPayload.summary === 'string' ? parsedPayload.summary : '')
    || (parsedPayload && typeof parsedPayload.recommendation === 'string' ? parsedPayload.recommendation : '')
    || clearTaggedBlocks(content),
  );
  return { summary, payload };
}

function parseWorkflowDeliverySummary(content) {
  const taggedPayloadText = extractTaggedBlock(content, 'delivery_summary');
  const parsedPayload = taggedPayloadText ? parseJsonObjectText(taggedPayloadText) : null;
  const summary = normalizeWorkflowConclusionSummary(
    (parsedPayload && typeof parsedPayload.summary === 'string' ? parsedPayload.summary : '')
    || clearTaggedBlocks(content),
  );
  return {
    summary,
    payload: {
      ...(summary ? { summary } : {}),
      ...(normalizeWorkflowConclusionList(parsedPayload?.completed).length > 0 ? { completed: normalizeWorkflowConclusionList(parsedPayload?.completed) } : {}),
      ...(normalizeWorkflowConclusionList(parsedPayload?.remainingRisks || parsedPayload?.risks).length > 0 ? { remainingRisks: normalizeWorkflowConclusionList(parsedPayload?.remainingRisks || parsedPayload?.risks) } : {}),
    },
  };
}

function isValidVerificationResultPayload(payload = {}) {
  const normalized = normalizeWorkflowConclusionPayload(payload, 'verification_result');
  const recommendation = normalizeWorkflowVerificationRecommendation(normalized.recommendation || '');
  const confidence = normalizeWorkflowDecisionConfidence(normalized.confidence || '');
  return !!recommendation && !!confidence;
}

function isValidDecisionResultPayload(payload = {}) {
  const normalized = normalizeWorkflowConclusionPayload(payload, 'decision_result');
  const recommendation = normalizeWorkflowConclusionSummary(normalized.recommendation || '');
  const confidence = normalizeWorkflowDecisionConfidence(normalized.confidence || '');
  return !!recommendation && !!confidence;
}

function detectWorkflowRiskSignalMatches(content) {
  const haystack = typeof content === 'string' ? content.toLowerCase() : '';
  if (!haystack) return [];
  const matches = [];
  for (const keyword of WORKFLOW_RISK_SIGNAL_KEYWORDS) {
    const needle = keyword.toLowerCase();
    if (!needle || !haystack.includes(needle)) continue;
    matches.push(keyword);
  }
  return matches;
}

function summarizeWorkflowRiskSignals(matches = []) {
  const unique = [];
  const seen = new Set();
  for (const match of Array.isArray(matches) ? matches : []) {
    const normalized = typeof match === 'string' ? match.trim() : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique.join('、');
}

export async function detectRunRiskSignals(session, runId) {
  const sessionId = typeof session?.id === 'string' ? session.id.trim() : '';
  const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
  if (!sessionId || !normalizedRunId) {
    return { hasRiskSignals: false, matches: [], summary: '', content: '' };
  }
  const assistantMessage = await findLatestAssistantMessageForRun(sessionId, normalizedRunId);
  const content = typeof assistantMessage?.content === 'string' ? assistantMessage.content.trim() : '';
  const matches = detectWorkflowRiskSignalMatches(content);
  return {
    hasRiskSignals: matches.length > 0,
    matches,
    summary: summarizeWorkflowRiskSignals(matches),
    content,
  };
}

function shouldWorkflowVerificationRequireHumanReview(payload = {}) {
  const normalized = normalizeWorkflowConclusionPayload(payload, 'verification_result');
  return normalizeWorkflowVerificationRecommendation(normalized.recommendation) !== 'ok'
    || normalizeWorkflowDecisionConfidence(normalized.confidence) !== 'high';
}

function canWorkflowVerificationAutoAbsorb(payload = {}) {
  return !shouldWorkflowVerificationRequireHumanReview(payload);
}

function shouldWorkflowDecisionRequireHumanReview(payload = {}) {
  const normalized = normalizeWorkflowConclusionPayload(payload, 'decision_result');
  if (!normalizeWorkflowConclusionSummary(normalized.recommendation || '')) return true;
  if (normalizeWorkflowDecisionConfidence(normalized.confidence) !== 'high') return true;
  return normalizeWorkflowConclusionList(normalized.decisionNeeded).length > 0;
}

function canWorkflowDecisionAutoAbsorb(payload = {}) {
  return !shouldWorkflowDecisionRequireHumanReview(payload);
}

function shouldWorkflowConclusionAutoAccept(handoffType, handoffPayload = {}, options = {}) {
  if (normalizeWorkflowConclusionStatus(options.initialStatus || '') !== 'pending') return false;
  if (options?.hasRiskSignals === true) return false;
  const normalizedType = normalizeWorkflowHandoffType(handoffType || '');
  if (normalizedType === 'verification_result') {
    return canWorkflowVerificationAutoAbsorb(handoffPayload);
  }
  if (normalizedType === 'decision_result') {
    return canWorkflowDecisionAutoAbsorb(handoffPayload);
  }
  return false;
}

function buildSessionNavigationHref(sessionId) {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalized) return '/?tab=sessions';
  return `/?session=${encodeURIComponent(normalized)}&tab=sessions`;
}

function buildWorkflowHandoffMessage({ source, handoffKind, handoffType, conclusion }) {
  const sourceName = typeof source?.name === 'string' && source.name.trim()
    ? source.name.trim()
    : '辅助会话';
  const sourceLink = `[${sourceName}](${buildSessionNavigationHref(source?.id || '')})`;
  const resolvedType = normalizeWorkflowHandoffType(handoffType || '', handoffKind || '');
  return [
    `### ${getWorkflowHandoffTypeLabel(resolvedType)}`,
    `- 来源会话：${sourceLink}`,
    '',
    getWorkflowHandoffTypeIntro(resolvedType),
    '',
    conclusion,
  ].filter(Boolean).join('\n');
}

export function extractWorkflowCurrentTaskFromName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) return '';
  const stripped = normalized.replace(/^(?:执行|主交付|功能交付|验收|再议)\s*[-·•—:：]\s*/u, '').trim();
  if (!stripped || stripped === normalized) return '';
  return normalizeWorkflowCurrentTask(stripped);
}

export function extractWorkflowCurrentTaskFromText(text, currentTask = '') {
  const normalizedCurrentTask = normalizeWorkflowCurrentTask(currentTask);
  const lines = String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';

  const labeledPatterns = [
    /^(?:目标|任务目标|当前目标|需求|问题|Bug|BUG|Goal|Task)\s*[:：]\s*(.+)$/iu,
    /^(?:目标是|要做的是)\s*(.+)$/iu,
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of labeledPatterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const inlineValue = normalizeWorkflowCurrentTask(match[1] || '');
      if (inlineValue) return inlineValue;
      for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
        const candidate = normalizeWorkflowCurrentTask(lines[lookahead] || '');
        if (candidate) return candidate;
      }
    }
  }

  const ignoredLinePatterns = [
    /^(?:继续这个任务|请继续|继续推进实现|现在请你收口成最终交付结果)[。！!.]?$/u,
    /^(?:验收|再议|风险复核|PR把关)给了下面这些结论/u,
    /^(?:这是当前改动范围|这是当前 PR 评论|这是 PR 评论|这是关键 diff)/u,
  ];
  for (const line of lines) {
    if (ignoredLinePatterns.some((pattern) => pattern.test(line))) continue;
    const candidate = normalizeWorkflowCurrentTask(line);
    if (!candidate || candidate.length < 6) continue;
    if (normalizedCurrentTask && candidate === normalizedCurrentTask) return normalizedCurrentTask;
    return candidate;
  }

  return '';
}

function getWorkflowSummarySource(session) {
  return normalizeWorkflowCurrentTask(session?.currentTask || session?.workflowCurrentTask || '')
    || extractWorkflowCurrentTaskFromName(session?.name || '')
    || normalizeWorkflowCurrentTask(session?.description || '')
    || '当前任务';
}

function buildWorkflowVerificationSessionName(sourceSession) {
  return `验收 · ${clipCompactionSection(getWorkflowSummarySource(sourceSession), 40)}`;
}

function buildWorkflowDeliberationSessionName(sourceSession) {
  return `再议 · ${clipCompactionSection(getWorkflowSummarySource(sourceSession), 40)}`;
}

export function buildWorkflowDeliverySummaryInstruction() {
  return [
    '结尾请追加一个 <delivery_summary> JSON 块，格式如下：',
    '<delivery_summary>{"summary":"一句话最终交付摘要","completed":["已完成项"],"remainingRisks":["残余风险"]}</delivery_summary>',
  ].join('\n');
}

async function buildWorkflowVerificationTemplateContext(sourceSession, runId = '') {
  const assistantMessage = runId
    ? await findLatestAssistantMessageForRun(sourceSession.id, runId)
    : findLatestAssistantConclusion(await loadHistory(sourceSession.id, { includeBodies: true }));
  return [
    `主线任务：${getWorkflowSummarySource(sourceSession)}`,
    sourceSession?.name ? `主线会话：${sourceSession.name}` : '',
    sourceSession?.description ? `上下文摘要：${sourceSession.description}` : '',
    assistantMessage?.content ? `最近输出：\n${clipCompactionSection(clearTaggedBlocks(assistantMessage.content), 2000)}` : '',
    '请只做独立验收，不要修改代码。',
  ].filter(Boolean).join('\n\n');
}

async function buildWorkflowDeliberationTemplateContext(sourceSession, runId = '') {
  const assistantMessage = runId
    ? await findLatestAssistantMessageForRun(sourceSession.id, runId)
    : findLatestAssistantConclusion(await loadHistory(sourceSession.id, { includeBodies: true }));
  const openConclusions = normalizeWorkflowPendingConclusions(sourceSession?.workflowPendingConclusions || [])
    .filter((entry) => ['pending', 'needs_decision'].includes(normalizeWorkflowConclusionStatus(entry.status)))
    .map((entry) => `- ${entry.label}: ${entry.summary}`)
    .join('\n');
  return [
    `主线任务：${getWorkflowSummarySource(sourceSession)}`,
    sourceSession?.name ? `主线会话：${sourceSession.name}` : '',
    sourceSession?.description ? `上下文摘要：${sourceSession.description}` : '',
    assistantMessage?.content ? `最近输出：\n${clipCompactionSection(clearTaggedBlocks(assistantMessage.content), 2000)}` : '',
    openConclusions ? `待处理结论：\n${openConclusions}` : '',
    '请只做方案判断和 tradeoff 分析，不要修改代码。',
  ].filter(Boolean).join('\n\n');
}

function buildWorkflowVerificationAutoStartMessage(templateContext = '') {
  return [
    '请基于已附带的自动验收上下文，直接开始本轮独立验收。',
    templateContext ? `自动验收上下文：\n${templateContext}` : '',
    '先说明你会如何验证，再给出最终结论。',
    '如果缺乏验证条件，请明确列出未验证项，不要假设通过。',
    '结尾请追加一个 <verification_result> JSON 块，格式如下：',
    '<verification_result>{"summary":"一句话结论","recommendation":"ok|needs_fix|needs_more_validation","confidence":"high|medium|low","validated":["已验证项"],"unverified":["未验证项"],"findings":["发现的问题"],"evidence":["验证证据"]}</verification_result>',
  ].join('\n\n');
}

function buildWorkflowDecisionAutoStartMessage(templateContext = '') {
  return [
    '请基于已附带的自动再议上下文，直接开始本轮独立再议。',
    templateContext ? `自动再议上下文：\n${templateContext}` : '',
    '先给出你的判断框架，再输出最终裁决。',
    '不要修改代码；只产出判断、建议、tradeoff 和下一步执行方向。',
    '结尾请追加一个 <decision_result> JSON 块，格式如下：',
    '<decision_result>{"summary":"一句话裁决","recommendation":"建议采用的方向","confidence":"high|medium|low","rejectedOptions":["放弃的方案"],"tradeoffs":["关键取舍"],"decisionNeeded":["仍需用户确认的点"],"parallelTasks":[{"title":"并行子任务","task":"子任务描述","boundary":"边界","repo":"可选仓库"}]}</decision_result>',
  ].join('\n\n');
}

function buildWorkflowVerificationAutoAbsorbPrompt(handoff = {}, sourceSession = null) {
  const payload = handoff?.payload && typeof handoff.payload === 'object' ? handoff.payload : {};
  return [
    '验收结果已自动回灌，请在当前主线内吸收这条高置信度验收结论。',
    sourceSession?.name ? `来源会话：${sourceSession.name}` : '',
    handoff?.summary ? `验收结论摘要：${handoff.summary}` : '',
    Array.isArray(payload.validated) && payload.validated.length > 0
      ? `已验证项：\n${payload.validated.map((item) => `- ${item}`).join('\n')}`
      : '',
    Array.isArray(payload.evidence) && payload.evidence.length > 0
      ? `验证证据：\n${payload.evidence.map((item) => `- ${item}`).join('\n')}`
      : '',
    '请明确说明：1. 已吸收的验收结论；2. 是否还有残余风险；3. 如果任务已完成，请直接追加最终交付摘要。',
    buildWorkflowDeliverySummaryInstruction(),
  ].filter(Boolean).join('\n\n');
}

function buildWorkflowDecisionAutoAbsorbPrompt(handoff = {}, sourceSession = null) {
  const payload = handoff?.payload && typeof handoff.payload === 'object' ? handoff.payload : {};
  const parallelTasks = Array.isArray(payload.parallelTasks) ? payload.parallelTasks : [];
  return [
    '再议结论已自动回灌，请在当前主线内吸收这条裁决结论，更新你的执行计划，并按新方向继续推进。',
    sourceSession?.name ? `来源会话：${sourceSession.name}` : '',
    handoff?.summary ? `再议结论摘要：${handoff.summary}` : '',
    payload?.recommendation ? `建议方向：${payload.recommendation}` : '',
    Array.isArray(payload.tradeoffs) && payload.tradeoffs.length > 0
      ? `关键取舍：\n${payload.tradeoffs.map((item) => `- ${item}`).join('\n')}`
      : '',
    Array.isArray(payload.decisionNeeded) && payload.decisionNeeded.length > 0
      ? `仍需确认：\n${payload.decisionNeeded.map((item) => `- ${item}`).join('\n')}`
      : '',
    parallelTasks.length > 0
      ? `建议的并行子线：\n${parallelTasks.map((task, index) => `- ${task?.title || `并行子任务 ${index + 1}`}${task?.task ? `：${task.task}` : ''}`).join('\n')}`
      : '',
    '请明确说明：1. 采纳/拒绝了哪些裁决点；2. 更新后的执行计划；3. 如果任务已完成，请直接追加最终交付摘要。',
    buildWorkflowDeliverySummaryInstruction(),
  ].filter(Boolean).join('\n\n');
}

const WORKFLOW_SUBSTAGE_EXECUTORS = Object.freeze({
  verify: {
    role: 'verify',
    defaultAppName: '验收',
    defaultEffort: 'high',
    appNames: WORKFLOW_VERIFICATION_APP_NAMES,
    suggestionType: 'suggest_verification',
    handoffType: 'verification_result',
    templateContextName: '自动验收上下文',
    buildSessionName: buildWorkflowVerificationSessionName,
    buildTemplateContext: buildWorkflowVerificationTemplateContext,
    buildAutoStartMessage: buildWorkflowVerificationAutoStartMessage,
    parseResult: parseWorkflowVerificationResult,
    isValidPayload: isValidVerificationResultPayload,
    buildAutoAbsorbPrompt: buildWorkflowVerificationAutoAbsorbPrompt,
    matchesSession: isWorkflowVerificationSession,
    autoStartRequestIdPrefix: 'workflow-verify-auto',
  },
  deliberate: {
    role: 'deliberate',
    defaultAppName: '再议',
    defaultEffort: 'high',
    appNames: WORKFLOW_DELIBERATION_APP_NAMES,
    suggestionType: 'suggest_decision',
    handoffType: 'decision_result',
    templateContextName: '自动再议上下文',
    buildSessionName: buildWorkflowDeliberationSessionName,
    buildTemplateContext: buildWorkflowDeliberationTemplateContext,
    buildAutoStartMessage: buildWorkflowDecisionAutoStartMessage,
    parseResult: parseWorkflowDecisionResult,
    isValidPayload: isValidDecisionResultPayload,
    buildAutoAbsorbPrompt: buildWorkflowDecisionAutoAbsorbPrompt,
    matchesSession: isWorkflowDeliberationSession,
    autoStartRequestIdPrefix: 'workflow-deliberate-auto',
  },
});

export function getWorkflowSubstageExecutorByRole(role) {
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return WORKFLOW_SUBSTAGE_EXECUTORS[normalizedRole] || null;
}

export function getWorkflowSubstageExecutorBySuggestionType(type) {
  const normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : '';
  return Object.values(WORKFLOW_SUBSTAGE_EXECUTORS).find((executor) => executor.suggestionType === normalizedType) || null;
}

export function getWorkflowSubstageExecutorByHandoffType(handoffType) {
  const normalizedType = normalizeWorkflowHandoffType(handoffType || '');
  return Object.values(WORKFLOW_SUBSTAGE_EXECUTORS).find((executor) => executor.handoffType === normalizedType) || null;
}

export function getWorkflowSubstageExecutorForSession(session) {
  if (isWorkflowVerificationSession(session)) return WORKFLOW_SUBSTAGE_EXECUTORS.verify;
  if (isWorkflowDeliberationSession(session)) return WORKFLOW_SUBSTAGE_EXECUTORS.deliberate;
  return null;
}

async function findWorkflowAppByNames(names = []) {
  const normalizedNames = (Array.isArray(names) ? names : [])
    .map((name) => normalizeSessionAppName(name || ''))
    .filter(Boolean);
  if (normalizedNames.length === 0) return null;
  const apps = await listApps();
  return apps.find((app) => normalizedNames.includes(normalizeSessionAppName(app?.name || ''))) || null;
}

async function resolveWorkflowSubstageSessionDefaults(executor, sourceSession, run = null) {
  const app = await findWorkflowAppByNames(executor?.appNames || []);
  const currentTask = getWorkflowSummarySource(sourceSession);
  const effectiveTool = typeof run?.tool === 'string' && run.tool.trim()
    ? run.tool.trim()
    : (typeof sourceSession?.tool === 'string' ? sourceSession.tool.trim() : (app?.tool || 'codex'));
  const effectiveModel = typeof run?.model === 'string' && run.model.trim()
    ? run.model.trim()
    : (typeof sourceSession?.model === 'string' ? sourceSession.model.trim() : (typeof app?.model === 'string' ? app.model.trim() : ''));
  const effectiveEffort = typeof app?.effort === 'string' && app.effort.trim()
    ? app.effort.trim()
    : (typeof sourceSession?.effort === 'string' && sourceSession.effort.trim() ? sourceSession.effort.trim() : executor?.defaultEffort || 'high');
  const effectiveThinking = app?.thinking === true || sourceSession?.thinking === true;
  return {
    name: typeof executor?.buildSessionName === 'function' ? executor.buildSessionName(sourceSession) : `${executor?.defaultAppName || '辅助'} · ${clipCompactionSection(currentTask, 40)}`,
    appId: app?.id || '',
    appName: normalizeSessionAppName(app?.name || executor?.defaultAppName || ''),
    systemPrompt: typeof app?.systemPrompt === 'string' ? app.systemPrompt : '',
    tool: effectiveTool,
    model: effectiveModel,
    effort: effectiveEffort,
    thinking: effectiveThinking,
    group: normalizeSessionGroup(sourceSession?.group || ''),
    description: currentTask,
    sourceId: normalizeAppId(sourceSession?.sourceId || ''),
    sourceName: typeof sourceSession?.sourceName === 'string' ? sourceSession.sourceName.trim() : '',
    userId: typeof sourceSession?.userId === 'string' ? sourceSession.userId.trim() : '',
    userName: typeof sourceSession?.userName === 'string' ? sourceSession.userName.trim() : '',
    rootSessionId: sourceSession?.rootSessionId || sourceSession?.id || '',
  };
}

async function findReusableWorkflowSubstageSession(sourceSession, sessionDefaults, executor) {
  const rootSessionId = sourceSession?.rootSessionId || sourceSession?.id || '';
  const metas = await loadSessionsMeta();
  const candidates = metas
    .filter((meta) => (
      meta
      && !meta.archived
      && !meta.visitorId
      && !meta.activeRunId
      && meta.id !== sourceSession.id
      && normalizeWorktreeCoordinationText(meta.handoffTargetSessionId || '') === sourceSession.id
      && executor?.matchesSession?.(meta)
      && (!rootSessionId || (meta.rootSessionId || meta.id) === rootSessionId)
    ))
    .sort((left, right) => Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0));
  if (candidates.length === 0) return null;
  return getSession(candidates[0].id) || candidates[0];
}

async function prepareWorkflowSessionFreshThread(sessionId) {
  return (await mutateSessionMeta(sessionId, (session) => {
    let changed = false;
    if (session.codexResumeMode !== 'transcript_only') {
      session.codexResumeMode = 'transcript_only';
      changed = true;
    }
    if (session.providerResumeId) {
      delete session.providerResumeId;
      changed = true;
    }
    if (session.claudeSessionId) {
      delete session.claudeSessionId;
      changed = true;
    }
    if (session.codexThreadId) {
      delete session.codexThreadId;
      changed = true;
    }
    if (changed) {
      session.updatedAt = nowIso();
    }
    return changed;
  })).meta;
}

async function attachWorkflowSubstageTemplateContext(executor, sessionId, sourceSession, runId = '') {
  const templateContext = await executor.buildTemplateContext(sourceSession, runId);
  if (!templateContext) return '';
  await appendEvent(sessionId, {
    type: 'template_context',
    templateName: executor.templateContextName || '自动辅助上下文',
    content: templateContext,
    sourceSessionId: sourceSession.id,
    sourceSessionName: sourceSession.name || '',
    sourceSessionUpdatedAt: sourceSession.updatedAt || sourceSession.created || nowIso(),
    updatedAt: nowIso(),
    timestamp: Date.now(),
  });
  await clearForkContext(sessionId);
  return templateContext;
}

async function ensureWorkflowSubstageSession(sourceSession, sessionDefaults, executor) {
  const reusedSession = await findReusableWorkflowSubstageSession(sourceSession, sessionDefaults, executor);
  if (reusedSession) {
    await prepareWorkflowSessionFreshThread(reusedSession.id);
    const refreshed = await updateSessionHandoffTarget(reusedSession.id, sourceSession.id)
      || await getSession(reusedSession.id)
      || reusedSession;
    return { session: refreshed, reused: true };
  }

  const createdSession = await createSession(
    sourceSession.folder,
    sessionDefaults.tool,
    sessionDefaults.name,
    {
      appId: sessionDefaults.appId,
      appName: sessionDefaults.appName,
      systemPrompt: sessionDefaults.systemPrompt,
      model: sessionDefaults.model,
      effort: sessionDefaults.effort,
      thinking: sessionDefaults.thinking,
      group: sessionDefaults.group,
      description: sessionDefaults.description,
      sourceId: sessionDefaults.sourceId,
      sourceName: sessionDefaults.sourceName,
      userId: sessionDefaults.userId,
      userName: sessionDefaults.userName,
      rootSessionId: sessionDefaults.rootSessionId,
    },
  );
  if (!createdSession) {
    throw new Error('Unable to create workflow substage session');
  }
  const updated = await updateSessionHandoffTarget(createdSession.id, sourceSession.id)
    || await getSession(createdSession.id)
    || createdSession;
  return { session: updated, reused: false };
}

async function acceptWorkflowSuggestionInternal(sessionId, sourceSession, triggeringRun, suggestionOrType = null) {
  const run = triggeringRun || null;
  const executor = typeof suggestionOrType === 'string' && suggestionOrType
    ? (getWorkflowSubstageExecutorBySuggestionType(suggestionOrType) || getWorkflowSubstageExecutorByRole(suggestionOrType))
    : null;
  const resolvedExecutor = executor
    || getWorkflowSubstageExecutorBySuggestionType(sourceSession?.workflowSuggestion?.type || '')
    || null;
  if (!resolvedExecutor) {
    throw new Error('Unsupported workflow suggestion');
  }

  const sessionDefaults = await resolveWorkflowSubstageSessionDefaults(resolvedExecutor, sourceSession, run);
  const ensured = await ensureWorkflowSubstageSession(sourceSession, sessionDefaults, resolvedExecutor);
  const auxiliarySession = ensured?.session;
  if (!auxiliarySession) return null;
  let resolvedAuxiliarySession = auxiliarySession;
  let launchedRun = null;

  let templateContext = '';
  try {
    templateContext = await attachWorkflowSubstageTemplateContext(
      resolvedExecutor,
      auxiliarySession.id,
      sourceSession,
      run?.id || '',
    );
  } catch (error) {
    console.warn(`[workflow] Failed to attach ${resolvedExecutor.role} context: ${error?.message}`);
  }

  try {
    const started = await submitHttpMessage(auxiliarySession.id, resolvedExecutor.buildAutoStartMessage(templateContext), [], {
      requestId: createInternalRequestId(resolvedExecutor.autoStartRequestIdPrefix || 'workflow-substage-auto'),
      model: sessionDefaults.model || undefined,
      effort: sessionDefaults.effort || undefined,
      thinking: sessionDefaults.thinking === true,
      freshThread: true,
      skipSessionContinuation: true,
      recordUserMessage: false,
    });
    resolvedAuxiliarySession = started.session || await getSession(auxiliarySession.id) || resolvedAuxiliarySession;
    launchedRun = started.run || null;
  } catch (error) {
    console.warn(`[workflow] Failed to auto-start ${resolvedExecutor.role}: ${error?.message}`);
  }

  await updateSessionWorkflowSuggestion(sessionId, null);
  return {
    session: resolvedAuxiliarySession,
    run: launchedRun,
    executor: resolvedExecutor,
  };
}

export async function dismissWorkflowSuggestion(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  if (!getActiveWorkflowSuggestion(session)) {
    throw new Error('No active workflow suggestion');
  }
  return updateSessionWorkflowSuggestion(sessionId, null);
}

export async function acceptWorkflowSuggestion(sessionId) {
  const sourceSession = await getSession(sessionId);
  if (!sourceSession) return null;
  if (sourceSession.visitorId) return null;

  const suggestion = getActiveWorkflowSuggestion(sourceSession);
  if (!suggestion) {
    throw new Error('No active workflow suggestion');
  }

  const run = suggestion.runId ? await getRun(suggestion.runId) : null;
  const prepared = await acceptWorkflowSuggestionInternal(sessionId, sourceSession, run, suggestion.type);
  const auxiliarySession = prepared?.session || null;
  if (!auxiliarySession) {
    throw new Error('Unable to prepare workflow substage session');
  }
  const refreshedSource = await updateSessionWorkflowSuggestion(sourceSession.id, null)
    || await getSession(sourceSession.id)
    || sourceSession;
  const resolvedAuxiliarySession = await getSession(auxiliarySession.id) || auxiliarySession;
  return {
    session: resolvedAuxiliarySession,
    sourceSession: refreshedSource,
    suggestion,
    run: prepared?.run || null,
  };
}

export function shouldAutoAdvanceWorkflowStage() {
  return false;
}

export async function maybeEmitWorkflowSuggestion(sessionId, session, run) {
  if (!session?.id || !run?.id) return null;
  if (session.archived || isInternalSession(session)) return null;
  if (!isWorkflowMainlineSession(session)) return updateSessionWorkflowSuggestion(sessionId, null);
  if (run.state !== 'completed') return null;
  if (hasOpenWorkflowConclusions(session)) return updateSessionWorkflowSuggestion(sessionId, null);

  const riskSignals = await detectRunRiskSignals(session, run.id);
  const nextStep = suggestNextStep({
    session,
    run,
    isMainlineSession: true,
    hasRiskSignals: riskSignals.hasRiskSignals,
    riskSummary: riskSignals.summary,
  });
  if (nextStep.action !== 'suggest_verification' && nextStep.action !== 'suggest_decision') {
    return updateSessionWorkflowSuggestion(sessionId, null);
  }

  const currentSuggestion = getActiveWorkflowSuggestion(session);
  if (currentSuggestion?.type === nextStep.action && currentSuggestion.runId === run.id) {
    return session;
  }

  return updateSessionWorkflowSuggestion(sessionId, {
    type: nextStep.action,
    status: 'pending',
    runId: run.id,
    createdAt: nowIso(),
    reason: nextStep.reason || '',
  });
}

export async function startWorkflowOnSession(sessionId, options = {}) {
  const session = await getSession(sessionId);
  if (!session) return null;
  if (session.visitorId) return null;
  if (session.archived) {
    throw new Error('Archived sessions cannot start a workflow');
  }
  if (isSessionRunning(session)) {
    throw new Error('Session is running');
  }

  const requestedAppId = typeof options.appId === 'string' ? options.appId.trim() : '';
  const requestedAppNames = Array.isArray(options.appNames) && options.appNames.length > 0
    ? options.appNames
    : (isWorkflowDeliberationSession(session) ? WORKFLOW_DELIBERATION_APP_NAMES : WORKFLOW_MAINLINE_APP_NAMES);
  const app = requestedAppId
    ? await getApp(requestedAppId)
    : await findWorkflowAppByNames(requestedAppNames);
  const fallbackTemplateAppName = requestedAppNames
    .map((name) => normalizeSessionAppName(name || ''))
    .find(Boolean);
  const kickoffMessage = typeof options.kickoffMessage === 'string' ? options.kickoffMessage.trim() : '';
  const nextCurrentTask = normalizeWorkflowCurrentTask(
    options.currentTask
    || options.workflowCurrentTask
    || options?.input?.goal
    || session.currentTask
    || session.workflowCurrentTask
    || session.description
    || '',
  );
  const shouldAdoptTemplateRuntime = Number(session?.messageCount || 0) === 0;
  const stamp = nowIso();

  const result = await mutateSessionMeta(sessionId, (draft) => {
    let changed = false;
    if (nextCurrentTask) {
      const currentTask = normalizeWorkflowCurrentTask(draft.currentTask || draft.workflowCurrentTask || '');
      if (currentTask !== nextCurrentTask) {
        draft.currentTask = nextCurrentTask;
        delete draft.workflowCurrentTask;
        changed = true;
      }
      if (!normalizeSessionDescription(draft.description || '')) {
        draft.description = nextCurrentTask;
        changed = true;
      }
    }
    if (app?.id && draft.templateAppId !== app.id) {
      draft.templateAppId = app.id;
      changed = true;
    }
    const nextAppName = normalizeSessionAppName(app?.name || '') || fallbackTemplateAppName;
    if (nextAppName && draft.appName !== nextAppName) {
      draft.appName = nextAppName;
      changed = true;
    }
    if (shouldAdoptTemplateRuntime) {
      const nextTool = typeof app?.tool === 'string' ? app.tool.trim() : '';
      if (nextTool && draft.tool !== nextTool) {
        draft.tool = nextTool;
        changed = true;
      }
      const nextModel = typeof app?.model === 'string' ? app.model.trim() : '';
      if (nextModel && draft.model !== nextModel) {
        draft.model = nextModel;
        changed = true;
      }
      const nextEffort = typeof app?.effort === 'string' ? app.effort.trim() : '';
      if (nextEffort && draft.effort !== nextEffort) {
        draft.effort = nextEffort;
        changed = true;
      }
      if (typeof app?.systemPrompt === 'string' && app.systemPrompt && draft.systemPrompt !== app.systemPrompt) {
        draft.systemPrompt = app.systemPrompt;
        changed = true;
      }
      if (app?.thinking === true && draft.thinking !== true) {
        draft.thinking = true;
        changed = true;
      } else if (app?.thinking !== true && draft.thinking === true) {
        delete draft.thinking;
        changed = true;
      }
    }
    if (changed) {
      draft.updatedAt = stamp;
    }
    return changed;
  });

  if (result.changed) {
    broadcastSessionInvalidation(sessionId);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
  }

  if (app?.templateContext?.content) {
    await appendEvent(sessionId, {
      type: 'template_context',
      templateName: app.name || fallbackTemplateAppName || 'Workflow Template',
      appId: app.id,
      content: app.templateContext.content,
      updatedAt: nowIso(),
      timestamp: Date.now(),
    });
    await clearForkContext(sessionId);
  }

  let updatedSession = await getSession(sessionId) || session;
  let launchedRun = null;
  if (kickoffMessage) {
    const kickoffRequestId = typeof options.requestId === 'string' ? options.requestId.trim() : '';
    const started = await submitHttpMessage(sessionId, kickoffMessage, [], {
      requestId: kickoffRequestId || createInternalRequestId('workflow-start'),
      tool: typeof options.tool === 'string' && options.tool.trim()
        ? options.tool.trim()
        : undefined,
      model: typeof options.model === 'string' && options.model.trim()
        ? options.model.trim()
        : (typeof updatedSession?.model === 'string' && updatedSession.model.trim() ? updatedSession.model.trim() : undefined),
      effort: typeof options.effort === 'string' && options.effort.trim()
        ? options.effort.trim()
        : (typeof updatedSession?.effort === 'string' && updatedSession.effort.trim() ? updatedSession.effort.trim() : undefined),
      thinking: Object.prototype.hasOwnProperty.call(options, 'thinking')
        ? options.thinking === true
        : updatedSession?.thinking === true,
      recordedUserText: typeof options.recordedUserText === 'string' && options.recordedUserText.trim()
        ? options.recordedUserText.trim()
        : kickoffMessage,
      recordUserMessage: options.recordUserMessage !== false,
    });
    updatedSession = started.session || await getSession(sessionId) || updatedSession;
    launchedRun = started.run || null;
  }

  return {
    session: await getSession(sessionId) || updatedSession,
    run: launchedRun,
  };
}

function normalizeWorkflowTaskText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractParallelTasksFromConclusionText(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const match = /<parallel_tasks>([\s\S]*?)<\/parallel_tasks>/iu.exec(value);
  if (!match?.[1]) return [];
  let raw = match[1].trim();
  raw = raw.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.parallelTasks)
        ? parsed.parallelTasks
        : (Array.isArray(parsed?.tasks) ? parsed.tasks : []));
    return normalizeWorkflowParallelTasks(tasks);
  } catch {
    return [];
  }
}

function stripParallelTasksFromConclusionText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<parallel_tasks>[\s\S]*?<\/parallel_tasks>/giu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildParallelTasksConclusionSummary(tasks = []) {
  const normalized = normalizeWorkflowParallelTasks(tasks);
  if (normalized.length === 0) return '';
  const titles = normalized.map((task) => task.title).filter(Boolean).slice(0, 3);
  return `建议按 ${normalized.length} 条并行执行线推进${titles.length > 0 ? `：${titles.join('、')}` : ''}`;
}

function resolveWorkflowHandoffInitialStatus(handoffType, handoffPayload = {}) {
  const normalizedType = normalizeWorkflowHandoffType(handoffType || '');
  if (normalizedType === 'verification_result' && shouldWorkflowVerificationRequireHumanReview(handoffPayload)) {
    return 'needs_decision';
  }
  if (normalizedType === 'decision_result' && shouldWorkflowDecisionRequireHumanReview(handoffPayload)) {
    return 'needs_decision';
  }
  return 'pending';
}

async function persistLastWorkflowHandoffRunId(sessionId, runId = '') {
  const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
  if (!normalizedRunId) return null;
  return (await mutateSessionMeta(sessionId, (session) => {
    if (session.lastWorkflowHandoffRunId === normalizedRunId) return false;
    session.lastWorkflowHandoffRunId = normalizedRunId;
    session.updatedAt = nowIso();
    return true;
  })).meta;
}

async function setPendingWorkflowAutoAbsorb(sessionId, value = null) {
  return (await mutateSessionMeta(sessionId, (session) => {
    const nextValue = value && typeof value === 'object' ? {
      sourceSessionId: typeof value.sourceSessionId === 'string' ? value.sourceSessionId.trim() : '',
      conclusionId: typeof value.conclusionId === 'string' ? value.conclusionId.trim() : '',
      runId: typeof value.runId === 'string' ? value.runId.trim() : '',
      handoffType: normalizeWorkflowHandoffType(value.handoffType || ''),
      summary: normalizeWorkflowConclusionSummary(value.summary || ''),
    } : null;
    const currentValue = session.pendingWorkflowAutoAbsorb && typeof session.pendingWorkflowAutoAbsorb === 'object'
      ? session.pendingWorkflowAutoAbsorb
      : null;
    if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) return false;
    if (nextValue && nextValue.sourceSessionId && nextValue.conclusionId && nextValue.runId) {
      session.pendingWorkflowAutoAbsorb = nextValue;
    } else if (session.pendingWorkflowAutoAbsorb) {
      delete session.pendingWorkflowAutoAbsorb;
    } else {
      return false;
    }
    session.updatedAt = nowIso();
    return true;
  })).meta;
}

async function setPendingWorkflowFinalCloseout(sessionId, value = null) {
  return (await mutateSessionMeta(sessionId, (session) => {
    const nextValue = value && typeof value === 'object' ? {
      runId: typeof value.runId === 'string' ? value.runId.trim() : '',
      sourceSessionId: typeof value.sourceSessionId === 'string' ? value.sourceSessionId.trim() : '',
      summary: normalizeWorkflowConclusionSummary(value.summary || ''),
    } : null;
    const currentValue = session.pendingWorkflowFinalCloseout && typeof session.pendingWorkflowFinalCloseout === 'object'
      ? session.pendingWorkflowFinalCloseout
      : null;
    if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) return false;
    if (nextValue?.runId) {
      session.pendingWorkflowFinalCloseout = nextValue;
    } else if (session.pendingWorkflowFinalCloseout) {
      delete session.pendingWorkflowFinalCloseout;
    } else {
      return false;
    }
    session.updatedAt = nowIso();
    return true;
  })).meta;
}

async function markWorkflowWaitingUser(sessionId, reason = '', payload = {}) {
  const updated = await updateSessionWorkflowClassification(sessionId, { workflowState: 'waiting_user' })
    || await getSession(sessionId);
  if (updated) {
    sendDecisionPush({ ...updated, id: sessionId }, reason).catch(() => {});
  }
  return updated;
}

async function clearWorkflowWaitingUserIfUnblocked(sessionId, session = null) {
  const current = session || await getSession(sessionId);
  if (!current) return null;
  if (normalizeSessionWorkflowState(current?.workflowState || '') !== 'waiting_user') return current;
  if (hasPendingDecision(current)) return current;
  return updateSessionWorkflowClassification(sessionId, { workflowState: '' }) || current;
}

async function markWorkflowDone(sessionId, session = null, payload = {}) {
  const updated = await updateSessionWorkflowClassification(sessionId, { workflowState: 'done' })
    || await getSession(sessionId)
    || session;
  return updated;
}

function buildWorkflowFinalCloseoutPrompt(session, sourceSession = null, handoff = null) {
  return [
    '上一轮已经吸收了辅助结论，但尚未形成明确的最终交付摘要。',
    sourceSession?.name ? `来源会话：${sourceSession.name}` : '',
    handoff?.summary ? `最近吸收的结论：${handoff.summary}` : '',
    getWorkflowSummarySource(session) ? `当前任务：${getWorkflowSummarySource(session)}` : '',
    '请直接完成最终收口，明确已完成项、残余风险，以及是否还需要用户介入。',
    buildWorkflowDeliverySummaryInstruction(),
  ].filter(Boolean).join('\n\n');
}

function buildWorkflowAutoAbsorbPrompt(handoff = {}, sourceSession = null) {
  const handoffType = normalizeWorkflowHandoffType(handoff?.handoffType || handoff?.type || handoff?.kind || '');
  const executor = getWorkflowSubstageExecutorByHandoffType(handoffType);
  if (!executor?.buildAutoAbsorbPrompt) return '';
  return executor.buildAutoAbsorbPrompt(handoff, sourceSession);
}

async function queueWorkflowAutoAbsorb(targetSession, sourceSession, handoff) {
  if (!targetSession?.id || !sourceSession?.id || !handoff?.conclusionId) {
    return { started: false };
  }
  const latestTarget = await getSession(targetSession.id);
  if (!latestTarget || latestTarget.archived || latestTarget.visitorId) {
    return { started: false, reason: 'target-unavailable' };
  }
  if (isSessionRunning(latestTarget) || getSessionQueueCount(latestTarget) > 0) {
    return { started: false, reason: 'target-busy' };
  }

  const absorbPrompt = buildWorkflowAutoAbsorbPrompt(handoff, sourceSession);
  if (!absorbPrompt) {
    return { started: false, reason: 'unsupported-handoff' };
  }

  const started = await submitHttpMessage(targetSession.id, absorbPrompt, [], {
    requestId: createInternalRequestId('workflow-auto-absorb'),
    model: typeof latestTarget?.model === 'string' && latestTarget.model.trim() ? latestTarget.model.trim() : undefined,
    effort: typeof latestTarget?.effort === 'string' && latestTarget.effort.trim() ? latestTarget.effort.trim() : undefined,
    thinking: latestTarget?.thinking === true,
    recordUserMessage: false,
    queueIfBusy: false,
    internalOperation: 'workflow_auto_absorb_verification',
  });
  if (!started?.run?.id) {
    return { started: false, reason: 'start-failed' };
  }

  await setPendingWorkflowAutoAbsorb(targetSession.id, {
    sourceSessionId: sourceSession.id,
    conclusionId: handoff.conclusionId,
    runId: started.run.id,
    handoffType: normalizeWorkflowHandoffType(handoff?.handoffType || handoff?.type || ''),
    summary: handoff?.summary || '',
  });
  await appendEvent(targetSession.id, systemEvent('workflow_auto_absorb', `已自动吸收${getWorkflowHandoffTypeLabel(handoff.handoffType || handoff.type || '')}。`));
  broadcastSessionInvalidation(targetSession.id);
  return {
    started: true,
    run: started.run,
    session: started.session || await getSession(targetSession.id) || latestTarget,
  };
}

async function queueWorkflowFinalCloseout(session, sourceSession, handoff = null) {
  if (!session?.id) return { started: false };
  const latestSession = await getSession(session.id);
  if (!latestSession || latestSession.archived || latestSession.visitorId) {
    return { started: false, reason: 'target-unavailable' };
  }
  if (isSessionRunning(latestSession) || getSessionQueueCount(latestSession) > 0) {
    return { started: false, reason: 'target-busy' };
  }

  const started = await submitHttpMessage(latestSession.id, buildWorkflowFinalCloseoutPrompt(latestSession, sourceSession, handoff), [], {
    requestId: createInternalRequestId('workflow-final-closeout'),
    model: typeof latestSession?.model === 'string' && latestSession.model.trim() ? latestSession.model.trim() : undefined,
    effort: typeof latestSession?.effort === 'string' && latestSession.effort.trim() ? latestSession.effort.trim() : undefined,
    thinking: latestSession?.thinking === true,
    recordUserMessage: false,
    queueIfBusy: false,
    internalOperation: 'workflow_final_closeout',
  });
  if (!started?.run?.id) {
    return { started: false, reason: 'start-failed' };
  }

  await setPendingWorkflowFinalCloseout(latestSession.id, {
    runId: started.run.id,
    sourceSessionId: sourceSession?.id || '',
    summary: handoff?.summary || '',
  });
  broadcastSessionInvalidation(latestSession.id);
  return {
    started: true,
    run: started.run,
    session: started.session || await getSession(latestSession.id) || latestSession,
  };
}

export function isWorkflowConclusionTerminalStatus(status) {
  return ['accepted', 'ignored', 'superseded'].includes(normalizeWorkflowConclusionStatus(status || ''));
}

export async function handleWorkflowConclusionSettled(sessionId, session, conclusionId, nextStatus) {
  if (!session?.id || !isWorkflowConclusionTerminalStatus(nextStatus)) return session;
  const settledConclusion = findWorkflowPendingConclusion(session, (entry) => entry.id === conclusionId);
  if (!settledConclusion) return session;

  let current = await getSession(sessionId) || session;
  if (nextStatus === 'accepted') {
    const pendingAutoAbsorb = current?.pendingWorkflowAutoAbsorb && typeof current.pendingWorkflowAutoAbsorb === 'object'
      ? current.pendingWorkflowAutoAbsorb
      : null;
    if (pendingAutoAbsorb?.conclusionId !== conclusionId) {
      const sourceSession = settledConclusion.sourceSessionId
        ? await getSession(settledConclusion.sourceSessionId)
        : null;
      if (sourceSession) {
        const autoAbsorb = await queueWorkflowAutoAbsorb(current, sourceSession, {
          conclusionId,
          handoffType: settledConclusion.handoffType,
          summary: settledConclusion.summary,
          payload: settledConclusion.payload || {},
        });
        current = autoAbsorb?.session || await getSession(sessionId) || current;
      }
    }
  }

  return clearWorkflowWaitingUserIfUnblocked(sessionId, current) || current;
}

export async function updateWorkflowPendingConclusionStatus(id, conclusionId, status) {
  const nextConclusionId = typeof conclusionId === 'string' ? conclusionId.trim() : '';
  if (!nextConclusionId) {
    throw new Error('conclusionId is required');
  }
  const nextStatus = normalizeWorkflowConclusionStatus(status || '');
  let previousStatus = '';
  const result = await mutateSessionMeta(id, (session) => {
    const current = normalizeWorkflowPendingConclusions(session.workflowPendingConclusions || []);
    const index = current.findIndex((item) => item.id === nextConclusionId);
    if (index === -1) {
      throw new Error('Conclusion not found');
    }
    const existing = current[index];
    previousStatus = normalizeWorkflowConclusionStatus(existing.status);
    if (previousStatus === nextStatus) {
      return false;
    }
    const updated = {
      ...existing,
      status: nextStatus,
      ...(['accepted', 'ignored', 'superseded'].includes(nextStatus) ? { handledAt: nowIso() } : {}),
    };
    if (nextStatus === 'pending' || nextStatus === 'needs_decision') {
      delete updated.handledAt;
    }
    current[index] = updated;
    session.workflowPendingConclusions = current.slice(-WORKFLOW_PENDING_LIMIT);
    session.updatedAt = nowIso();
    return true;
  });

  if (!result.meta) return null;
  let enriched = await enrichSessionMeta(result.meta);
  if (result.changed) {
    broadcastSessionInvalidation(id);
    if (shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
    if (isWorkflowConclusionTerminalStatus(nextStatus) && previousStatus !== nextStatus) {
      enriched = await handleWorkflowConclusionSettled(id, enriched, nextConclusionId, nextStatus) || enriched;
    } else if (nextStatus === 'needs_decision') {
      enriched = await markWorkflowWaitingUser(id, 'handoff_requires_decision', {
        conclusionId: nextConclusionId,
      }) || enriched;
    } else if (nextStatus === 'pending') {
      enriched = await clearWorkflowWaitingUserIfUnblocked(id, enriched) || enriched;
    }
  }
  return enriched;
}

export async function maybeAutoHandoffWorkflowSubstageResult(sessionId, session, run) {
  if (!session?.id || !run?.id) return null;
  const executor = getWorkflowSubstageExecutorForSession(session);
  if (!executor) return null;
  if (run.state !== 'completed') return null;
  if (!normalizeWorktreeCoordinationText(session?.handoffTargetSessionId || '')) return null;
  if (normalizeWorktreeCoordinationText(session?.lastWorkflowHandoffRunId || '') === run.id) return null;

  const assistantMessage = await findLatestAssistantMessageForRun(sessionId, run.id);
  const parsed = executor.parseResult(assistantMessage?.content || '');
  const summary = parsed.summary || normalizeWorkflowConclusionSummary(clearTaggedBlocks(assistantMessage?.content || ''));
  if (!summary) return null;

  const outcome = await handoffSessionResult(sessionId, {
    targetSessionId: session.handoffTargetSessionId,
    handoffType: executor.handoffType,
    summary,
    payload: parsed.payload,
    sourceRunId: run.id,
  });
  if (!outcome?.handoff?.conclusionId) return outcome;

  if (!executor.isValidPayload(parsed.payload || {})) {
    const updatedTarget = await updateWorkflowPendingConclusionStatus(
      outcome.targetSession.id,
      outcome.handoff.conclusionId,
      'needs_decision',
    ) || outcome.targetSession;
    await appendEvent(updatedTarget.id, statusEvent('辅助结论已回灌，但缺少完整结构化数据，已转为人工确认。'));
    broadcastSessionInvalidation(updatedTarget.id);
    return {
      ...outcome,
      targetSession: updatedTarget,
      handoff: {
        ...outcome.handoff,
        status: 'needs_decision',
      },
    };
  }

  if (outcome.handoff.status === 'needs_decision') {
    await appendEvent(outcome.targetSession.id, statusEvent('辅助结论需要人工确认，主线已暂停自动推进。'));
    broadcastSessionInvalidation(outcome.targetSession.id);
  }
  return outcome;
}

export async function finalizeWorkflowAutoAbsorb(sessionId, session, run) {
  const pending = session?.pendingWorkflowAutoAbsorb && typeof session.pendingWorkflowAutoAbsorb === 'object'
    ? session.pendingWorkflowAutoAbsorb
    : null;
  if (!pending?.runId || pending.runId !== run.id || !pending.conclusionId) {
    return null;
  }

  let updatedSession = session;
  if (run.state === 'completed') {
    await appendEvent(sessionId, statusEvent('高置信度辅助结论已自动吸收。'));
    const assistantMessage = await findLatestAssistantMessageForRun(sessionId, run.id);
    const deliverySummary = parseWorkflowDeliverySummary(assistantMessage?.content || '');
    if (deliverySummary.summary) {
      updatedSession = await markWorkflowDone(sessionId, session, {
        reason: 'auto_absorb_complete',
        conclusionId: pending.conclusionId,
      }) || await getSession(sessionId) || session;
      await appendEvent(sessionId, statusEvent('工作流已收口完成。'));
    } else {
      const sourceSession = pending?.sourceSessionId ? await getSession(pending.sourceSessionId) : null;
      const closeout = await queueWorkflowFinalCloseout(updatedSession, sourceSession, {
        summary: pending?.summary || '',
      });
      if (!closeout?.started) {
        updatedSession = await markWorkflowWaitingUser(sessionId, 'final_closeout_missing_summary', {
          conclusionId: pending.conclusionId,
          sourceSessionId: pending?.sourceSessionId || '',
        }) || await getSession(sessionId) || updatedSession;
        await appendEvent(sessionId, statusEvent('自动吸收已完成，但最终收口未能自动启动，请手动确认。'));
      } else {
        updatedSession = closeout.session || updatedSession;
      }
    }
  } else {
    updatedSession = await updateWorkflowPendingConclusionStatus(sessionId, pending.conclusionId, 'needs_decision')
      || await getSession(sessionId)
      || session;
    updatedSession = await markWorkflowWaitingUser(sessionId, 'auto_absorb_failed', {
      conclusionId: pending.conclusionId,
      sourceSessionId: pending?.sourceSessionId || '',
    }) || updatedSession;
    await appendEvent(sessionId, statusEvent('自动吸收辅助结论失败，已回退到人工确认。'));
  }

  await setPendingWorkflowAutoAbsorb(sessionId, null);
  broadcastSessionInvalidation(sessionId);
  return updatedSession;
}

export async function finalizeWorkflowFinalCloseout(sessionId, session, run) {
  const pending = session?.pendingWorkflowFinalCloseout && typeof session.pendingWorkflowFinalCloseout === 'object'
    ? session.pendingWorkflowFinalCloseout
    : null;
  if (!pending?.runId || pending.runId !== run.id) {
    return null;
  }

  let updatedSession = session;
  if (run.state === 'completed') {
    const assistantMessage = await findLatestAssistantMessageForRun(sessionId, run.id);
    const deliverySummary = parseWorkflowDeliverySummary(assistantMessage?.content || '');
    if (deliverySummary.summary) {
      updatedSession = await markWorkflowDone(sessionId, session, {
        reason: 'final_closeout_completed',
        sourceSessionId: pending?.sourceSessionId || '',
      }) || await getSession(sessionId) || session;
      await appendEvent(sessionId, statusEvent('工作流已收口完成。'));
    } else {
      updatedSession = await markWorkflowWaitingUser(sessionId, 'final_closeout_missing_summary', {
        sourceSessionId: pending?.sourceSessionId || '',
      }) || await getSession(sessionId) || session;
      await appendEvent(sessionId, statusEvent('最终收口未产出 <delivery_summary>，已转为人工确认。'));
    }
  } else {
    updatedSession = await markWorkflowWaitingUser(sessionId, 'final_closeout_failed', {
      sourceSessionId: pending?.sourceSessionId || '',
    }) || await getSession(sessionId) || session;
    await appendEvent(sessionId, statusEvent('最终收口自动执行失败，已转为人工确认。'));
  }

  await setPendingWorkflowFinalCloseout(sessionId, null);
  broadcastSessionInvalidation(sessionId);
  return updatedSession;
}

export async function handoffSessionResult(sessionId, payload = {}) {
  const source = await getSession(sessionId);
  if (!source) return null;
  if (source.visitorId) return null;

  const targetSessionId = typeof payload?.targetSessionId === 'string'
    ? payload.targetSessionId.trim()
    : '';
  const resolvedTargetSessionId = targetSessionId || normalizeWorktreeCoordinationText(source?.handoffTargetSessionId || '');
  if (!resolvedTargetSessionId) {
    throw new Error('targetSessionId is required');
  }
  if (resolvedTargetSessionId === source.id) {
    throw new Error('targetSessionId must be different from the source session');
  }

  const target = await getSession(resolvedTargetSessionId);
  if (!target) {
    throw new Error('Target session not found');
  }
  if (target.visitorId) {
    throw new Error('Target session must be an owner session');
  }

  const history = await loadHistory(source.id, { includeBodies: true });
  const latestConclusion = findLatestAssistantConclusion(history);
  const latestConclusionText = typeof latestConclusion?.content === 'string'
    ? latestConclusion.content.trim()
    : '';
  const sourceRunId = typeof payload?.sourceRunId === 'string' && payload.sourceRunId.trim()
    ? payload.sourceRunId.trim()
    : (typeof latestConclusion?.runId === 'string' ? latestConclusion.runId.trim() : '');
  const requestedSummaryRaw = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
  const rawConclusionText = requestedSummaryRaw || latestConclusionText;
  if (!rawConclusionText) {
    throw new Error('No assistant conclusion available to hand off yet');
  }

  const handoffKind = getWorkflowHandoffKind(source);
  const handoffType = normalizeWorkflowHandoffType(payload?.handoffType || '', handoffKind);
  const extractedParallelTasks = handoffType === 'decision_result'
    ? extractParallelTasksFromConclusionText(rawConclusionText)
    : [];
  const strippedConclusionText = stripParallelTasksFromConclusionText(rawConclusionText);
  const conclusionText = strippedConclusionText
    || buildParallelTasksConclusionSummary(extractedParallelTasks)
    || rawConclusionText;
  const handoffPayload = normalizeWorkflowConclusionPayload({
    ...(payload?.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
      ? payload.payload
      : {}),
    ...(extractedParallelTasks.length > 0 ? { parallelTasks: extractedParallelTasks } : {}),
  }, handoffType);
  const initialStatus = resolveWorkflowHandoffInitialStatus(handoffType, handoffPayload);
  const content = buildWorkflowHandoffMessage({
    source,
    handoffKind,
    handoffType,
    conclusion: conclusionText,
  });
  const handoffEvent = await appendEvent(target.id, messageEvent('assistant', content, undefined, {
    messageKind: 'workflow_handoff',
    handoffKind,
    handoffType,
    handoffSourceSessionId: source.id,
    handoffSourceSessionName: typeof source?.name === 'string' ? source.name.trim() : '',
    handoffTargetSessionId: target.id,
  }));
  let updatedTarget = await appendWorkflowPendingConclusion(target.id, {
    sourceSessionId: source.id,
    sourceSessionName: typeof source?.name === 'string' ? source.name.trim() : '',
    handoffKind,
    handoffType,
    label: getWorkflowHandoffTypeLabel(handoffType),
    summary: conclusionText,
    status: initialStatus,
    createdAt: nowIso(),
    eventSeq: Number.isInteger(handoffEvent?.seq) ? handoffEvent.seq : undefined,
    ...(Object.keys(handoffPayload).length > 0 ? { payload: handoffPayload } : {}),
  }) || await getSession(target.id) || target;
  const storedConclusion = findWorkflowPendingConclusion(updatedTarget, (entry) => (
    entry.eventSeq === handoffEvent?.seq
    || (
      entry.sourceSessionId === source.id
      && normalizeWorkflowHandoffType(entry.handoffType || '', entry.handoffKind || '') === handoffType
    )
  ));
  let resolvedStatus = initialStatus;

  if (initialStatus === 'needs_decision' && storedConclusion?.id) {
    updatedTarget = await markWorkflowWaitingUser(target.id, 'handoff_requires_decision', {
      handoffType,
      sourceSessionId: source.id,
      conclusionId: storedConclusion.id,
    }) || updatedTarget;
  } else if (storedConclusion?.id) {
    const runRiskSignals = await detectRunRiskSignals(source, sourceRunId);
    const canAutoAccept = shouldWorkflowConclusionAutoAccept(handoffType, handoffPayload, {
      initialStatus,
      hasRiskSignals: runRiskSignals.hasRiskSignals,
    });
    if (canAutoAccept) {
      updatedTarget = await updateWorkflowPendingConclusionStatus(target.id, storedConclusion.id, 'accepted')
        || await getSession(target.id)
        || updatedTarget;
      resolvedStatus = 'accepted';
    } else if (
      shouldWorkflowConclusionAutoAccept(handoffType, handoffPayload, { initialStatus, hasRiskSignals: false })
      && runRiskSignals.hasRiskSignals
    ) {
      await appendEvent(
        target.id,
        systemEvent(
          'workflow_auto_absorb',
          `检测到潜在风险（${summarizeWorkflowRiskSignals(runRiskSignals.matches)}），结论暂未自动吸收。`,
        ),
      );
      broadcastSessionInvalidation(target.id);
    }
  }

  if (sourceRunId) {
    await persistLastWorkflowHandoffRunId(source.id, sourceRunId);
  }
  broadcastSessionInvalidation(target.id);

  return {
    sourceSession: await getSession(source.id) || source,
    targetSession: updatedTarget,
    handoff: {
      kind: handoffKind,
      type: handoffType,
      label: getWorkflowHandoffTypeLabel(handoffType),
      summary: clipCompactionSection(conclusionText, 280),
      status: resolvedStatus,
      ...(storedConclusion?.id ? { conclusionId: storedConclusion.id } : {}),
      ...(Object.keys(handoffPayload).length > 0 ? { payload: handoffPayload } : {}),
    },
  };
}

function inferRuntimeFamilyFromTool(toolId, toolDefinition) {
  if (toolDefinition?.runtimeFamily) return toolDefinition.runtimeFamily;
  if (toolId === 'codex') return 'codex-json';
  if (toolId === 'claude') return 'claude-stream-json';
  if (toolId === 'cursor') return 'cursor-stream-json';
  return '';
}

export async function resolveWorkflowExecutionRuntimeOptions(session, effectiveTool) {
  const appName = getWorkflowSessionAppName(session);
  const toolDefinition = await getToolDefinitionAsync(effectiveTool);
  const runtimeFamily = inferRuntimeFamilyFromTool(effectiveTool, toolDefinition);
  if (runtimeFamily !== 'codex-json') return {};
  if (isWorkflowVerificationAppName(appName)) {
    return {
      executionMode: 'verification_read_only',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      developerInstructions: [
        DEFAULT_CODEX_DEVELOPER_INSTRUCTIONS,
        CODEX_VERIFICATION_READ_ONLY_DEVELOPER_INSTRUCTIONS,
      ].filter(Boolean).join(' '),
    };
  }
  if (isWorkflowDeliberationAppName(appName)) {
    return {
      executionMode: 'deliberation_advisory',
      approvalPolicy: 'never',
      developerInstructions: [
        DEFAULT_CODEX_DEVELOPER_INSTRUCTIONS,
        CODEX_DELIBERATION_ADVISORY_DEVELOPER_INSTRUCTIONS,
      ].filter(Boolean).join(' '),
    };
  }
  return {};
}

export function scheduleSessionWorkflowStateSuggestion(session, run) {
  if (!session?.id || !run || session.archived || isInternalSession(session)) {
    return false;
  }

  const suggestionDone = triggerSessionWorkflowStateSuggestion({
    id: session.id,
    folder: session.folder,
    name: session.name || '',
    group: session.group || '',
    description: session.description || '',
    workflowState: session.workflowState || '',
    workflowPriority: session.workflowPriority || '',
    tool: run.tool || session.tool,
    model: run.model || undefined,
    thinking: false,
    runState: run.state,
    queuedCount: getSessionQueueCount(session),
  });

  suggestionDone.then(async (result) => {
    const nextWorkflowState = normalizeSessionWorkflowState(result?.workflowState || '');
    const nextWorkflowPriority = normalizeSessionWorkflowPriority(result?.workflowPriority || '');
    if (!nextWorkflowState && !nextWorkflowPriority) return;
    await updateSessionWorkflowClassification(session.id, {
      workflowState: nextWorkflowState,
      workflowPriority: nextWorkflowPriority,
    });
  }).catch((error) => {
    console.error(`[workflow-state] Failed to update workflow state for ${session.id?.slice(0, 8)}: ${error.message}`);
  });

  return true;
}
