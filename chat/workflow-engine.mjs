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
  getCurrentWorkflowStage,
  getNextWorkflowStage,
  getWorkflowGatePolicy,
  getWorkflowHandoffTypeForRole,
  getStageRuntimeHint,
  normalizeGatePolicy,
  normalizeWorkflowDefinition,
  resolveWorkflowDefinitionForMode,
  WORKFLOW_RISK_SIGNAL_KEYWORDS,
} from './workflow-definition.mjs';
import { classifyTaskComplexity } from './workflow-auto-router.mjs';
import { resolveRuntimeOverrideForTier } from './models.mjs';

let dependencies = null;

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

function applySessionAppMetadata(id, app, extra = {}) {
  return requireDeps().applySessionAppMetadata(id, app, extra);
}

function updateSessionWorkflowClassification(id, payload = {}) {
  return requireDeps().updateSessionWorkflowClassification(id, payload);
}

function updateSessionWorkflowSuggestion(id, suggestion) {
  return requireDeps().updateSessionWorkflowSuggestion(id, suggestion);
}

function appendWorkflowPendingConclusion(id, conclusion) {
  return requireDeps().appendWorkflowPendingConclusion(id, conclusion);
}

function updateWorkflowPendingConclusionStatus(id, conclusionId, status) {
  return requireDeps().updateWorkflowPendingConclusionStatus(id, conclusionId, status);
}

function submitHttpMessage(sessionId, text, images, options = {}) {
  return requireDeps().submitHttpMessage(sessionId, text, images, options);
}

function buildSessionNavigationHref(sessionId) {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalized) return '/?tab=sessions';
  return `/?session=${encodeURIComponent(normalized)}&tab=sessions`;
}

function generateId() {
  return randomBytes(16).toString('hex');
}

function normalizeWorktreeCoordinationText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionSourceName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSessionUserName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function clipCompactionSection(value, maxChars = 12000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length <= maxChars) return text;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(1, maxChars - headChars);
  return `${text.slice(0, headChars).trimEnd()}\n[... truncated by RemoteLab ...]\n${text.slice(-tailChars).trimStart()}`;
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

function getWorkflowHandoffKind(session) {
  const appName = normalizeSessionAppName(
    session?.templateAppName
    || session?.appName
    || '',
  );
  if (['验收', '执行验收', '风险复核', '挑战', '后台挑战'].includes(appName)) {
    return 'risk_review';
  }
  if (['再议', '深度裁决', 'PR把关', '合并', '发布把关'].includes(appName)) {
    return 'pr_gate';
  }
  return 'workflow';
}

export function getWorkflowHandoffTypeForSession(session) {
  return normalizeWorkflowHandoffType('', getWorkflowHandoffKind(session));
}

export function getWorkflowSessionAppName(session) {
  return normalizeSessionAppName(
    session?.templateAppName
    || session?.appName
    || '',
  );
}

export function doesWorkflowSessionAppMatchStage(session, stage) {
  if (!stage || typeof stage !== 'object') return false;
  const sessionAppName = getWorkflowSessionAppName(session);
  if (!sessionAppName) return false;
  const stageAppNames = Array.isArray(stage.appNames) ? stage.appNames : [];
  return stageAppNames.some((name) => normalizeSessionAppName(name || '') === sessionAppName);
}

export function isWorkflowMainlineAppName(appName) {
  return ['执行', '主交付', '功能交付'].includes(normalizeSessionAppName(appName || ''));
}

export function isWorkflowVerificationAppName(appName) {
  return ['验收', '执行验收', '风险复核'].includes(normalizeSessionAppName(appName || ''));
}

export function isWorkflowDeliberationAppName(appName) {
  return ['再议', '深度裁决', 'PR把关', '推敲'].includes(normalizeSessionAppName(appName || ''));
}

export function isWorkflowMainlineSession(session) {
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  if (definition) {
    return !normalizeWorktreeCoordinationText(session?.handoffTargetSessionId || '');
  }
  return isWorkflowMainlineAppName(getWorkflowSessionAppName(session));
}

export function isWorkflowVerificationSession(session) {
  const stage = getCurrentWorkflowStage(session);
  if (stage) return stage.role === 'verify';
  return isWorkflowVerificationAppName(getWorkflowSessionAppName(session));
}

export function isWorkflowDeliberationSession(session) {
  const stage = getCurrentWorkflowStage(session);
  if (stage) return stage.role === 'deliberate';
  return isWorkflowDeliberationAppName(getWorkflowSessionAppName(session));
}

const WORKFLOW_AUTO_ABSORB_VERIFICATION_INTERNAL_OPERATION = 'workflow_auto_absorb_verification';
const WORKFLOW_FINAL_CLOSEOUT_INTERNAL_OPERATION = 'workflow_final_closeout';
const WORKFLOW_VERIFICATION_APP_NAMES = ['验收', '执行验收', '风险复核'];
const WORKFLOW_DELIBERATION_APP_NAMES = ['再议', '深度裁决', 'PR把关', '推敲'];
const CODEX_DELIBERATION_ADVISORY_DEVELOPER_INSTRUCTIONS = [
  'Treat this session as an advisory deliberation lane.',
  'Inspect code and context as needed, but do not modify files and do not produce code changes.',
  'Return judgments, tradeoffs, risks, and recommended next steps only.',
].join(' ');

function getWorkflowHandoffLabel(kind) {
  if (kind === 'risk_review') return '验收转交';
  if (kind === 'pr_gate') return '再议转交';
  return '结果转交';
}

function getWorkflowHandoffTypeIntro(handoffType) {
  const normalized = normalizeWorkflowHandoffType(handoffType);
  if (normalized === 'verification_result') {
    return '以下是本轮验收的最新结果。';
  }
  if (normalized === 'decision_result') {
    return '以下是本轮再议的最新结论。';
  }
  return '以下是本会话的最新结论。';
}

export function normalizeWorkflowCurrentTask(value) {
  return normalizeSessionDescription(value || '');
}

export function extractWorkflowCurrentTaskFromName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) return '';
  const stripped = normalized.replace(/^(?:执行|主交付|功能交付)\s*[-·•—:：]\s*/u, '').trim();
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
    /^(?:这是一个复杂新需求|继续这个任务|执行计划可以|请继续|继续推进实现|现在请你收口成最终交付结果)[。！!.]?$/u,
    /^(?:验收|再议|风险复核|PR把关)给了下面这些结论/u,
    /^(?:这是当前改动范围|这是当前 PR 评论|这是 PR 评论|这是关键 diff)/u,
  ];
  for (const line of lines) {
    if (ignoredLinePatterns.some((pattern) => pattern.test(line))) continue;
    const candidate = normalizeWorkflowCurrentTask(line);
    if (!candidate || candidate.length < 6) continue;
    if (normalizedCurrentTask && candidate === normalizedCurrentTask) {
      return normalizedCurrentTask;
    }
    return candidate;
  }

  return '';
}

function normalizeWorkflowContractText(value, maxLength = 320) {
  if (typeof value !== 'string') return '';
  const compact = value.trim().replace(/\s+/g, ' ');
  if (!compact) return '';
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function extractWorkflowAcceptanceCriteria(text) {
  const lines = String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const accepted = [];
  for (const line of lines) {
    const match = line.match(/^(?:成功标准|验收标准|验收条件|Acceptance Criteria)\s*[:：]\s*(.+)$/iu);
    if (!match) continue;
    const entries = String(match[1] || '')
      .split(/[；;]/u)
      .map((entry) => normalizeWorkflowContractText(entry, 180))
      .filter(Boolean);
    if (entries.length > 0) {
      accepted.push(...entries);
    }
  }
  return [...new Set(accepted)].slice(0, 8);
}

function mapWorkflowRoleToTaskStage(role) {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalized === 'deliberate') return 'planning';
  if (normalized === 'verify') return 'reviewing';
  if (normalized === 'execute') return 'executing';
  return 'pending';
}

export function buildWorkflowRoutingSignalText(text = '', input = {}) {
  return [
    text,
    input?.goal,
    input?.constraints,
    input?.progress,
    input?.concern,
    input?.preference,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .trim();
}

export function normalizeWorkflowLaunchMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['quick_execute', 'standard_delivery', 'careful_deliberation', 'parallel_split'].includes(normalized)) {
    return normalized;
  }
  return '';
}

export function resolveWorkflowLaunchDecision({
  requestedMode = '',
  gatePolicy = 'low_confidence_only',
  signalText = '',
  routeContext = {},
  classified = null,
} = {}) {
  const normalizedMode = normalizeWorkflowLaunchMode(requestedMode);
  const normalizedGatePolicy = normalizeGatePolicy(gatePolicy);
  if (normalizedMode) {
    return {
      mode: normalizedMode,
      gatePolicy: normalizedGatePolicy,
      autoRouted: false,
      confidence: '',
      reason: '',
    };
  }
  const resolvedClassification = classified && typeof classified === 'object'
    ? classified
    : classifyTaskComplexity(signalText || '', routeContext && typeof routeContext === 'object' ? routeContext : {});
  return {
    mode: normalizeWorkflowLaunchMode(resolvedClassification.mode || '') || 'quick_execute',
    gatePolicy: normalizedGatePolicy,
    autoRouted: true,
    confidence: typeof resolvedClassification.confidence === 'string' ? resolvedClassification.confidence : '',
    reason: normalizeWorkflowContractText(resolvedClassification.reason || '', 200),
  };
}

function buildWorkflowTaskContract({
  existingTask = null,
  session = null,
  input = {},
  workflowCurrentTask = '',
  sourceText = '',
  definition = null,
  route = null,
  now = nowIso(),
} = {}) {
  const currentStage = definition?.stages?.[definition.currentStageIndex] || definition?.stages?.[0] || null;
  const project = normalizeWorkflowContractText(
    input?.project
    || session?.folder
    || '',
    240,
  );
  const constraints = normalizeWorkflowContractText(input?.constraints || '', 240);
  return {
    id: typeof existingTask?.id === 'string' && existingTask.id.trim()
      ? existingTask.id.trim()
      : `task_${generateId()}`,
    parentId: typeof existingTask?.parentId === 'string' ? existingTask.parentId.trim() : '',
    goal: normalizeWorkflowCurrentTask(workflowCurrentTask || sourceText || session?.description || ''),
    acceptanceCriteria: extractWorkflowAcceptanceCriteria(sourceText),
    scopeBoundary: {
      ...(project ? { project } : {}),
      ...(constraints ? { constraints } : {}),
    },
    dependsOn: Array.isArray(existingTask?.dependsOn)
      ? existingTask.dependsOn.filter((entry) => typeof entry === 'string' && entry.trim())
      : [],
    stage: mapWorkflowRoleToTaskStage(currentStage?.role || ''),
    assignedRole: typeof currentStage?.role === 'string' ? currentStage.role : '',
    boundModel: normalizeWorkflowContractText(session?.model || '', 120),
    worktreePath: normalizeWorkflowContractText(session?.worktree?.path || '', 240),
    rollbackRef: normalizeWorkflowContractText(session?.worktree?.branch || '', 160),
    budgetConsumed: {
      tokenEquivalent: Number.isFinite(existingTask?.budgetConsumed?.tokenEquivalent)
        ? Number(existingTask.budgetConsumed.tokenEquivalent)
        : 0,
      wallTimeMs: Number.isFinite(existingTask?.budgetConsumed?.wallTimeMs)
        ? Number(existingTask.budgetConsumed.wallTimeMs)
        : 0,
      apiCalls: Number.isFinite(existingTask?.budgetConsumed?.apiCalls)
        ? Number(existingTask.budgetConsumed.apiCalls)
        : 0,
    },
    budgetCeiling: existingTask?.budgetCeiling ?? null,
    createdAt: typeof existingTask?.createdAt === 'string' && existingTask.createdAt
      ? existingTask.createdAt
      : now,
    updatedAt: now,
    route: {
      mode: typeof route?.mode === 'string' ? route.mode : '',
      autoRouted: route?.autoRouted === true,
      confidence: typeof route?.confidence === 'string' ? route.confidence : '',
      reason: typeof route?.reason === 'string' ? route.reason : '',
    },
  };
}

async function appendWorkflowMetric(sessionId, event, payload = {}) {
  await appendEvent(sessionId, {
    type: 'workflow_metric',
    event,
    timestamp: Date.now(),
    ...payload,
  });
}

function getWorkflowMetricStageSnapshot(definition, index) {
  if (!definition || !Number.isInteger(index) || index < 0) return null;
  const stage = definition?.stages?.[index] || null;
  if (!stage) return null;
  return {
    stage: formatWorkflowStageLabel(stage, index),
    role: typeof stage?.role === 'string' ? stage.role : '',
    index,
    terminal: stage?.terminal === true,
  };
}

function getWorkflowTaskContractId(session) {
  return typeof session?.workflowTaskContract?.id === 'string' ? session.workflowTaskContract.id.trim() : '';
}

async function appendWorkflowHumanPauseMetric(sessionId, session, reason = '', payload = {}) {
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  const currentIndex = Number.isInteger(definition?.currentStageIndex) ? definition.currentStageIndex : 0;
  const currentStage = getWorkflowMetricStageSnapshot(definition, currentIndex);
  await appendWorkflowMetric(sessionId, 'human_pause', {
    reason: normalizeWorkflowContractText(reason || '', 160),
    ...(currentStage ? {
      stage: currentStage.stage,
      stageRole: currentStage.role,
      stageIndex: currentStage.index,
      terminalStage: currentStage.terminal === true,
    } : {}),
    ...(getWorkflowTaskContractId(session) ? { taskId: getWorkflowTaskContractId(session) } : {}),
    ...payload,
  });
}

async function appendWorkflowCompletedMetric(sessionId, session, payload = {}) {
  const history = await loadHistory(sessionId, { includeBodies: false });
  const alreadyCompleted = history.some((event) => (
    event?.type === 'workflow_metric'
    && event?.event === 'completed'
  ));
  if (alreadyCompleted) return false;

  const activationEvent = history.find((event) => (
    event?.type === 'workflow_metric'
    && event?.event === 'activated'
  )) || null;
  const humanPauseCount = history.filter((event) => (
    event?.type === 'workflow_metric'
    && event?.event === 'human_pause'
  )).length;
  const runIds = new Set(
    history
      .map((event) => (typeof event?.runId === 'string' ? event.runId.trim() : ''))
      .filter(Boolean),
  );
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  await appendWorkflowMetric(sessionId, 'completed', {
    totalStages: Array.isArray(definition?.stages) ? definition.stages.length : 0,
    totalRuns: runIds.size,
    humanPauseCount,
    durationMs: Number.isFinite(activationEvent?.timestamp)
      ? Math.max(0, Date.now() - Number(activationEvent.timestamp))
      : 0,
    ...(getWorkflowTaskContractId(session) ? { taskId: getWorkflowTaskContractId(session) } : {}),
    ...payload,
  });
  return true;
}

async function markWorkflowWaitingUser(sessionId, reason = '', payload = {}) {
  const updated = await updateSessionWorkflowClassification(sessionId, { workflowState: 'waiting_user' })
    || await getSession(sessionId);
  if (updated) {
    await appendWorkflowHumanPauseMetric(sessionId, updated, reason, payload);
    await updateCurrentWorkflowStageTrace(getWorkflowTraceRootSessionId(updated) || sessionId, 'paused_for_decision', {
      outcome: normalizeWorkflowContractText(reason || '', 160),
      conclusionId: typeof payload?.conclusionId === 'string' ? payload.conclusionId : '',
      markPaused: true,
    });
    await appendWorkflowDecisionRecord(sessionId, updated, reason, payload);
    sendDecisionPush({ ...updated, id: sessionId }, reason).catch(() => {});
  }
  return updated;
}

async function markWorkflowDone(sessionId, session = null, payload = {}) {
  const updated = await updateSessionWorkflowClassification(sessionId, { workflowState: 'done' })
    || await getSession(sessionId)
    || session;
  if (updated) {
    await appendWorkflowCompletedMetric(sessionId, updated, payload);
    await updateCurrentWorkflowStageTrace(getWorkflowTraceRootSessionId(updated) || sessionId, 'completed', {
      outcome: typeof payload?.reason === 'string' ? payload.reason : 'completed',
      conclusionId: typeof payload?.conclusionId === 'string' ? payload.conclusionId : '',
      markCompleted: true,
    });
  }
  return updated;
}

const WORKFLOW_TASK_TRACE_STAGE_LIMIT = 24;
const WORKFLOW_TASK_TRACE_DECISION_LIMIT = 24;
const WORKFLOW_TASK_TRACE_RECONCILE_LIMIT = 24;
const WORKFLOW_TASK_TRACE_SESSION_LIMIT = 12;

function cloneWorkflowTraceValue(value) {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function getWorkflowTraceTaskId(session) {
  return normalizeWorkflowContractText(
    session?.workflowTaskTrace?.taskId
    || session?.workflowTraceBridge?.taskId
    || getWorkflowTaskContractId(session)
    || '',
    160,
  );
}

function getWorkflowTraceRootTaskId(session) {
  return normalizeWorkflowContractText(
    session?.workflowTaskTrace?.rootTaskId
    || session?.workflowTraceBridge?.rootTaskId
    || getWorkflowTraceTaskId(session)
    || '',
    160,
  );
}

function getWorkflowTraceRootSessionId(session) {
  return normalizeWorkflowContractText(
    session?.workflowTaskTrace?.rootSessionId
    || session?.workflowTraceBridge?.rootSessionId
    || session?.id
    || '',
    160,
  );
}

function findWorkflowTraceRecordIndex(records = [], predicate) {
  if (typeof predicate !== 'function' || !Array.isArray(records)) return -1;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (predicate(records[index], index)) return index;
  }
  return -1;
}

function buildWorkflowTraceSessionLink(session, overrides = {}) {
  const now = typeof overrides.updatedAt === 'string' && overrides.updatedAt
    ? overrides.updatedAt
    : nowIso();
  return {
    sessionId: normalizeWorkflowContractText(overrides.sessionId || session?.id || '', 160),
    sessionName: normalizeWorkflowContractText(overrides.sessionName || session?.name || '', 240),
    appName: normalizeWorkflowContractText(session?.appName || '', 120),
    role: normalizeWorkflowContractText(overrides.role || '', 80),
    sessionKind: normalizeWorkflowContractText(overrides.sessionKind || '', 80),
    sourceSessionId: normalizeWorkflowContractText(overrides.sourceSessionId || '', 160),
    runId: normalizeWorkflowContractText(overrides.runId || '', 160),
    status: normalizeWorkflowContractText(overrides.status || '', 80),
    linkedAt: typeof overrides.linkedAt === 'string' && overrides.linkedAt ? overrides.linkedAt : now,
    updatedAt: now,
  };
}

function upsertWorkflowTraceSessionLink(trace, link) {
  if (!trace || !link?.sessionId) return false;
  const current = Array.isArray(trace.sessionLinks) ? trace.sessionLinks.filter(Boolean) : [];
  const index = current.findIndex((entry) => entry?.sessionId === link.sessionId);
  if (index === -1) {
    trace.sessionLinks = [...current.slice(-(WORKFLOW_TASK_TRACE_SESSION_LIMIT - 1)), link];
    return true;
  }
  const existing = current[index];
  const next = {
    ...existing,
    ...link,
    linkedAt: existing?.linkedAt || link.linkedAt || nowIso(),
    updatedAt: link.updatedAt || nowIso(),
  };
  if (JSON.stringify(existing || null) === JSON.stringify(next)) return false;
  current[index] = next;
  trace.sessionLinks = current.slice(-WORKFLOW_TASK_TRACE_SESSION_LIMIT);
  return true;
}

function buildWorkflowStageTraceRecord({
  taskId = '',
  session = null,
  stage = '',
  stageRole = '',
  stageIndex = -1,
  sessionKind = '',
  status = 'running',
  runId = '',
  sourceSessionId = '',
  sourceRunId = '',
  handoffType = '',
  parentStageTraceId = '',
  startedAt = nowIso(),
} = {}) {
  return {
    id: `trace_stage_${generateId()}`,
    taskId: normalizeWorkflowContractText(taskId, 160),
    sessionId: normalizeWorkflowContractText(session?.id || '', 160),
    sessionName: normalizeWorkflowContractText(session?.name || '', 240),
    appName: normalizeWorkflowContractText(session?.appName || '', 120),
    stage: normalizeWorkflowContractText(stage, 120),
    stageRole: normalizeWorkflowContractText(stageRole, 80),
    stageIndex: Number.isInteger(stageIndex) ? stageIndex : -1,
    sessionKind: normalizeWorkflowContractText(sessionKind, 80),
    status: normalizeWorkflowContractText(status, 80),
    runId: normalizeWorkflowContractText(runId, 160),
    sourceSessionId: normalizeWorkflowContractText(sourceSessionId, 160),
    sourceRunId: normalizeWorkflowContractText(sourceRunId, 160),
    handoffType: normalizeWorkflowContractText(handoffType, 80),
    parentStageTraceId: normalizeWorkflowContractText(parentStageTraceId, 160),
    model: normalizeWorkflowContractText(session?.model || '', 120),
    startedAt,
    updatedAt: startedAt,
  };
}

function buildWorkflowDecisionRecord({
  taskId = '',
  sessionId = '',
  stageTraceId = '',
  conclusionId = '',
  type = '',
  reason = '',
  status = 'pending',
  sourceSessionId = '',
  sourceRunId = '',
  summary = '',
  confidence = '',
  createdAt = nowIso(),
} = {}) {
  return {
    id: `trace_decision_${generateId()}`,
    taskId: normalizeWorkflowContractText(taskId, 160),
    sessionId: normalizeWorkflowContractText(sessionId, 160),
    stageTraceId: normalizeWorkflowContractText(stageTraceId, 160),
    conclusionId: normalizeWorkflowContractText(conclusionId, 160),
    type: normalizeWorkflowContractText(type, 120),
    reason: normalizeWorkflowContractText(reason, 160),
    status: normalizeWorkflowContractText(status, 80),
    sourceSessionId: normalizeWorkflowContractText(sourceSessionId, 160),
    sourceRunId: normalizeWorkflowContractText(sourceRunId, 160),
    summary: normalizeWorkflowConclusionSummary(summary || ''),
    confidence: normalizeWorkflowContractText(confidence, 40),
    createdAt,
    updatedAt: createdAt,
  };
}

function buildWorkflowReconcileRecord({
  taskId = '',
  targetSessionId = '',
  sourceSessionId = '',
  sourceRunId = '',
  absorbRunId = '',
  conclusionId = '',
  handoffType = '',
  status = '',
  summary = '',
  autoAbsorbed = false,
  createdAt = nowIso(),
} = {}) {
  return {
    id: `trace_reconcile_${generateId()}`,
    taskId: normalizeWorkflowContractText(taskId, 160),
    sessionId: normalizeWorkflowContractText(targetSessionId, 160),
    targetSessionId: normalizeWorkflowContractText(targetSessionId, 160),
    sourceSessionId: normalizeWorkflowContractText(sourceSessionId, 160),
    sourceRunId: normalizeWorkflowContractText(sourceRunId, 160),
    absorbRunId: normalizeWorkflowContractText(absorbRunId, 160),
    conclusionId: normalizeWorkflowContractText(conclusionId, 160),
    handoffType: normalizeWorkflowContractText(handoffType, 80),
    status: normalizeWorkflowContractText(status, 80),
    summary: normalizeWorkflowConclusionSummary(summary || ''),
    autoAbsorbed: autoAbsorbed === true,
    costAttribution: {
      mode: 'session_local',
      sourceRunId: normalizeWorkflowContractText(sourceRunId, 160),
      absorbRunId: normalizeWorkflowContractText(absorbRunId, 160),
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function ensureWorkflowTaskTraceRoot(session, { mode = '' } = {}) {
  const taskId = getWorkflowTraceTaskId(session);
  if (!taskId || !session?.id) return null;
  const now = nowIso();
  const existing = cloneWorkflowTraceValue(session?.workflowTaskTrace) || {};
  const rootTaskId = getWorkflowTraceRootTaskId(session) || taskId;
  const rootSessionId = getWorkflowTraceRootSessionId(session) || session.id;
  const trace = {
    taskId,
    rootTaskId,
    rootSessionId,
    mode: normalizeWorkflowLaunchMode(existing.mode || mode || session?.workflowMode || '') || '',
    currentStageTraceId: normalizeWorkflowContractText(existing.currentStageTraceId || '', 160),
    sessionLinks: Array.isArray(existing.sessionLinks) ? existing.sessionLinks.filter(Boolean).slice(-WORKFLOW_TASK_TRACE_SESSION_LIMIT) : [],
    stageTraces: Array.isArray(existing.stageTraces) ? existing.stageTraces.filter(Boolean).slice(-WORKFLOW_TASK_TRACE_STAGE_LIMIT) : [],
    decisionRecords: Array.isArray(existing.decisionRecords) ? existing.decisionRecords.filter(Boolean).slice(-WORKFLOW_TASK_TRACE_DECISION_LIMIT) : [],
    reconcileRecords: Array.isArray(existing.reconcileRecords) ? existing.reconcileRecords.filter(Boolean).slice(-WORKFLOW_TASK_TRACE_RECONCILE_LIMIT) : [],
    createdAt: typeof existing.createdAt === 'string' && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
  };
  upsertWorkflowTraceSessionLink(trace, buildWorkflowTraceSessionLink(session, {
    role: getCurrentWorkflowStage(session)?.role || 'mainline',
    sessionKind: 'mainline',
    status: 'active',
    linkedAt: trace.createdAt,
    updatedAt: now,
  }));
  return trace;
}

function ensureWorkflowTaskTraceCurrentStage(trace, session, definition, { runId = '' } = {}) {
  if (!trace || !definition || trace.currentStageTraceId) return false;
  const currentIndex = Number.isInteger(definition?.currentStageIndex) ? definition.currentStageIndex : 0;
  const currentStage = getWorkflowMetricStageSnapshot(definition, currentIndex);
  if (!currentStage) return false;
  const record = buildWorkflowStageTraceRecord({
    taskId: trace.taskId,
    session,
    stage: currentStage.stage,
    stageRole: currentStage.role,
    stageIndex: currentIndex,
    sessionKind: 'mainline',
    runId,
    startedAt: nowIso(),
  });
  trace.stageTraces = [...trace.stageTraces.slice(-(WORKFLOW_TASK_TRACE_STAGE_LIMIT - 1)), record];
  trace.currentStageTraceId = record.id;
  return true;
}

export function isWorkflowStatusLikeEventType(type = '') {
  return ['status', 'workflow_auto_advance', 'workflow_auto_absorb'].includes(type);
}

function parseWorkflowVerificationResult(content) {
  const taggedPayloadText = extractTaggedBlock(content, 'verification_result');
  const parsedPayload = taggedPayloadText ? parseJsonObjectText(taggedPayloadText) : null;
  const summarySource = normalizeWorkflowConclusionSummary(
    (parsedPayload && typeof parsedPayload.summary === 'string' ? parsedPayload.summary : '')
    || stripTaggedBlock(content, 'verification_result'),
  );
  const payload = normalizeWorkflowConclusionPayload(parsedPayload || {}, 'verification_result');
  return {
    summary: summarySource,
    payload,
  };
}

function parseWorkflowDecisionResult(content) {
  const taggedPayloadText = extractTaggedBlock(content, 'decision_result');
  const parsedPayload = taggedPayloadText ? parseJsonObjectText(taggedPayloadText) : null;
  const payload = normalizeWorkflowConclusionPayload(parsedPayload || {}, 'decision_result');
  const summarySource = normalizeWorkflowConclusionSummary(
    (parsedPayload && typeof parsedPayload.summary === 'string' ? parsedPayload.summary : '')
    || (parsedPayload && typeof parsedPayload.recommendation === 'string' ? parsedPayload.recommendation : '')
    || stripTaggedBlock(content, 'decision_result'),
  );
  return {
    summary: summarySource,
    payload,
  };
}

function parseWorkflowDeliverySummary(content) {
  const taggedPayloadText = extractTaggedBlock(content, 'delivery_summary');
  const parsedPayload = taggedPayloadText ? parseJsonObjectText(taggedPayloadText) : null;
  const summary = normalizeWorkflowConclusionSummary(
    (parsedPayload && typeof parsedPayload.summary === 'string' ? parsedPayload.summary : '')
    || stripTaggedBlock(content, 'delivery_summary'),
  );
  const completed = normalizeWorkflowConclusionList(parsedPayload?.completed);
  const remainingRisks = normalizeWorkflowConclusionList(parsedPayload?.remainingRisks || parsedPayload?.risks);
  return {
    summary,
    payload: {
      ...(summary ? { summary } : {}),
      ...(completed.length > 0 ? { completed } : {}),
      ...(remainingRisks.length > 0 ? { remainingRisks } : {}),
    },
  };
}

export function buildWorkflowPendingConclusionsPromptBlock(session) {
  if (!isWorkflowMainlineSession(session)) {
    return '';
  }
  const entries = normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || [])
    .filter((entry) => ['pending', 'needs_decision'].includes(normalizeWorkflowConclusionStatus(entry.status)));
  if (entries.length === 0) return 'No open workflow handoffs.';
  const lines = entries.map((entry, index) => {
    const label = entry.label || getWorkflowHandoffTypeLabel(entry.handoffType || entry.handoffKind || 'workflow');
    const source = entry.sourceSessionName ? `来源：${entry.sourceSessionName}` : '来源：辅助会话';
    const status = normalizeWorkflowConclusionStatus(entry.status) === 'needs_decision' ? '状态：待用户决策' : '状态：待处理';
    const confidence = entry.handoffType === 'decision_result' && entry?.payload?.confidence
      ? `\n   - 置信度：${entry.payload.confidence}`
      : '';
    return `${index + 1}. ${label}\n   - ${source}\n   - ${status}${confidence}\n   - 摘要：${entry.summary}`;
  });
  return [
    'Open workflow conclusions requiring attention:',
    ...lines,
    'When relevant, explicitly absorb, reject, or defer these conclusions instead of silently ignoring them.',
  ].join('\n');
}

export function buildWorkflowCurrentTaskPromptBlock(session) {
  const currentTask = normalizeWorkflowCurrentTask(session?.workflowCurrentTask || '');
  if (!currentTask) return '';
  return `Current workflow task: ${currentTask}`;
}

function formatWorkflowStageLabel(stage = {}, fallbackIndex = 0) {
  const explicitLabel = typeof stage?.label === 'string' ? stage.label.trim() : '';
  if (explicitLabel) return explicitLabel;
  if (stage?.role === 'execute') return fallbackIndex > 0 ? `执行 ${fallbackIndex + 1}` : '执行';
  if (stage?.role === 'verify') return '验收';
  if (stage?.role === 'deliberate') return '再议';
  return `阶段 ${fallbackIndex + 1}`;
}

function getWorkflowStageStatusText(session, stage = null) {
  if (!stage) return '';
  if (stage.role === 'execute') {
    return stage.terminal === true ? 'terminal closeout stage' : 'implementation in progress';
  }
  const expectedType = getWorkflowHandoffTypeForRole(stage.role);
  if (!expectedType) return '';
  const entries = normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || []);
  const openEntry = entries.find((entry) => (
    normalizeWorkflowHandoffType(entry?.handoffType || '', entry?.handoffKind || '') === expectedType
    && ['pending', 'needs_decision'].includes(normalizeWorkflowConclusionStatus(entry?.status || ''))
  ));
  if (openEntry) {
    return normalizeWorkflowConclusionStatus(openEntry.status) === 'needs_decision'
      ? 'waiting for user decision on latest substage result'
      : 'waiting for latest substage result to be handled';
  }
  if (stage.role === 'verify') return 'ready to launch verification';
  if (stage.role === 'deliberate') return 'ready to launch deliberation';
  return '';
}

export function buildWorkflowStagePromptBlock(session) {
  if (!isWorkflowMainlineSession(session)) return '';
  const definition = normalizeWorkflowDefinition(session?.workflowDefinition);
  if (!definition) return '';
  const currentIndex = Number.isInteger(definition.currentStageIndex) ? definition.currentStageIndex : 0;
  const currentStage = definition.stages[currentIndex] || null;
  const nextStage = definition.stages[currentIndex + 1] || null;
  if (!currentStage) return '';
  const currentStatus = getWorkflowStageStatusText(session, currentStage);
  return [
    `Current workflow: ${definition.mode || 'custom'} (stage ${currentIndex + 1} of ${definition.stages.length})`,
    `Current stage: ${formatWorkflowStageLabel(currentStage, currentIndex)} (${currentStage.role})${currentStage.terminal === true ? ' — terminal' : ''}${currentStatus ? ` — ${currentStatus}` : ''}`,
    nextStage
      ? `Next stage: ${formatWorkflowStageLabel(nextStage, currentIndex + 1)} (${nextStage.role})${nextStage.terminal === true ? ', terminal' : ''}`
      : 'Next stage: none',
    `Gate policy: ${definition.gatePolicy || 'low_confidence_only'}`,
  ].join('\n');
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

function isInlineWorkflowWhitespace(char) {
  return typeof char === 'string' && char.trim() === '';
}

function readInlineWorkflowDeclarationLabel(text, index) {
  if (typeof text !== 'string') return '';
  if (text.startsWith('工作流', index)) return '工作流';
  if (text.startsWith('模式', index)) return '模式';
  if (text.startsWith('策略', index)) return '策略';
  if (text.slice(index).toLowerCase().startsWith('workflow')) return 'workflow';
  return '';
}

function parseInlineWorkflowDeclarationLine(line) {
  const text = typeof line === 'string' ? line.trim() : '';
  if (!text) return [];

  const declarations = [];
  let cursor = 0;

  while (cursor < text.length) {
    while (cursor < text.length && isInlineWorkflowWhitespace(text[cursor])) {
      cursor += 1;
    }
    if (cursor >= text.length) break;

    const label = readInlineWorkflowDeclarationLabel(text, cursor);
    if (!label) return [];
    cursor += label.length;

    while (cursor < text.length && isInlineWorkflowWhitespace(text[cursor])) {
      cursor += 1;
    }
    const separator = text[cursor];
    if (separator !== ':' && separator !== '：') return [];
    cursor += 1;

    while (cursor < text.length && isInlineWorkflowWhitespace(text[cursor])) {
      cursor += 1;
    }
    const valueStart = cursor;
    let nextDeclarationIndex = text.length;

    for (let index = cursor; index < text.length; index += 1) {
      if (!isInlineWorkflowWhitespace(text[index])) continue;
      let probe = index;
      while (probe < text.length && isInlineWorkflowWhitespace(text[probe])) {
        probe += 1;
      }
      const nextLabel = readInlineWorkflowDeclarationLabel(text, probe);
      if (!nextLabel) continue;
      let separatorIndex = probe + nextLabel.length;
      while (separatorIndex < text.length && isInlineWorkflowWhitespace(text[separatorIndex])) {
        separatorIndex += 1;
      }
      if (text[separatorIndex] === ':' || text[separatorIndex] === '：') {
        nextDeclarationIndex = index;
        break;
      }
    }

    const value = text.slice(valueStart, nextDeclarationIndex).trim();
    if (!value) return [];
    declarations.push({ label, value });
    cursor = nextDeclarationIndex;
  }

  return declarations;
}

const INLINE_WORKFLOW_MODE_LABELS = Object.freeze({
  快速执行: 'quick_execute',
  标准交付: 'standard_delivery',
  审慎模式: 'careful_deliberation',
  并行拆分: 'parallel_split',
});

const INLINE_WORKFLOW_MODE_DISPLAY = Object.freeze({
  quick_execute: '快速执行',
  standard_delivery: '标准交付',
  careful_deliberation: '审慎模式',
  parallel_split: '并行拆分',
});

const INLINE_WORKFLOW_GATE_POLICY_LABELS = Object.freeze({
  每步确认: 'always_manual',
  有把握自动: 'low_confidence_only',
  只看最终: 'final_confirm_only',
});

const INLINE_WORKFLOW_GATE_POLICY_DISPLAY = Object.freeze({
  always_manual: '每步确认',
  low_confidence_only: '有把握自动',
  final_confirm_only: '只看最终',
});

function formatInlineWorkflowActivationStatus({
  mode = '',
  gatePolicy = 'low_confidence_only',
  autoRouted = false,
  reason = '',
} = {}) {
  const modeLabel = INLINE_WORKFLOW_MODE_DISPLAY[mode] || mode;
  if (autoRouted) {
    return `已自动激活工作流 · ${modeLabel}${reason ? `（原因：${reason}）` : ''}`;
  }
  const policyLabel = INLINE_WORKFLOW_GATE_POLICY_DISPLAY[gatePolicy] || gatePolicy;
  return `已激活工作流 · ${modeLabel}（策略：${policyLabel}）`;
}

function summarizeInlineWorkflowActivationStatus(route) {
  return formatInlineWorkflowActivationStatus(route).replace(/^已(?:自动)?激活工作流 · /u, '');
}

function normalizeInlineWorkflowMode(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return '';
  return normalizeWorkflowLaunchMode(INLINE_WORKFLOW_MODE_LABELS[normalized] || normalized);
}

function normalizeInlineWorkflowGatePolicy(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return 'low_confidence_only';
  return normalizeGatePolicy(INLINE_WORKFLOW_GATE_POLICY_LABELS[normalized] || normalized);
}

const WORKFLOW_EFFORT_RANKS = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
});

function resolvePreferredWorkflowEffort(...values) {
  let best = '';
  let bestRank = 0;
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const rank = WORKFLOW_EFFORT_RANKS[normalized] || 0;
    if (rank > bestRank) {
      best = normalized;
      bestRank = rank;
    }
  }
  return best;
}

function isInlineWorkflowAutoValue(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['自动', 'auto', '默认'].includes(normalized);
}

export function parseInlineWorkflowDeclarations(text) {
  const lines = String(text || '').split(/\r?\n/u);
  let mode = '';
  let gatePolicy = 'low_confidence_only';
  let sawDeclaration = false;
  let autoRequested = false;
  let sawModeDeclaration = false;
  let sawStrategyDeclaration = false;
  let bodyStartIndex = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = typeof lines[index] === 'string' ? lines[index].trim() : '';
    if (!line) continue;

    const declarations = parseInlineWorkflowDeclarationLine(line);
    if (declarations.length === 0) {
      if (!sawDeclaration) return null;
      bodyStartIndex = index;
      break;
    }

    sawDeclaration = true;
    for (const declaration of declarations) {
      if (declaration.label === '模式' || declaration.label === '工作流' || declaration.label === 'workflow') {
        sawModeDeclaration = true;
        const nextMode = normalizeInlineWorkflowMode(declaration.value);
        if (nextMode) {
          mode = nextMode;
        } else if (isInlineWorkflowAutoValue(declaration.value)) {
          autoRequested = true;
        }
      } else if (declaration.label === '策略') {
        sawStrategyDeclaration = true;
        gatePolicy = normalizeInlineWorkflowGatePolicy(declaration.value);
      }
    }
  }

  if (!sawDeclaration) return null;
  const cleanedText = lines.slice(bodyStartIndex).join('\n').trim();
  return {
    mode,
    gatePolicy: normalizeGatePolicy(gatePolicy),
    cleanedText,
    autoRouted: false,
    autoRequested: autoRequested || (!mode && sawStrategyDeclaration && !sawModeDeclaration),
  };
}

function normalizeWorkflowHandoffType(value, fallbackKind = '') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['verification_result', 'decision_result', 'workflow_result'].includes(normalized)) {
    return normalized;
  }
  const legacyKind = typeof fallbackKind === 'string' ? fallbackKind.trim().toLowerCase() : '';
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

function normalizeWorkflowParallelTaskText(value, maxChars = 600) {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact ? clipCompactionSection(compact, maxChars) : '';
}

function normalizeWorkflowParallelTask(task = {}, index = 0) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return null;
  }
  const title = normalizeWorkflowParallelTaskText(task.title || task.name || '', 120)
    || `并行子任务 ${index + 1}`;
  const taskText = normalizeWorkflowParallelTaskText(task.task || task.goal || task.summary || '', 600);
  const boundary = normalizeWorkflowParallelTaskText(task.boundary || task.constraints || '', 400);
  const repo = normalizeWorkflowParallelTaskText(task.repo || task.folder || task.project || '', 240);
  if (!(title || taskText || boundary || repo)) {
    return null;
  }
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
  const titles = normalized
    .map((task) => task.title)
    .filter(Boolean)
    .slice(0, 3);
  return `建议按 ${normalized.length} 条并行执行线推进${titles.length > 0 ? `：${titles.join('、')}` : ''}`;
}

function normalizeWorkflowConclusionList(values = [], maxItems = 12) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeWorkflowConclusionSummary(value))
    .filter(Boolean)
    .slice(0, maxItems);
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

function normalizeWorkflowBooleanFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['true', 'yes', 'y', 'on', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'off', '0'].includes(normalized)) return false;
  return undefined;
}

function normalizeWorkflowConclusionPayload(payload = {}, handoffType = 'workflow_result') {
  const normalizedType = normalizeWorkflowHandoffType(handoffType);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  if (normalizedType === 'verification_result') {
    const summary = normalizeWorkflowConclusionSummary(payload.summary);
    const recommendation = normalizeWorkflowVerificationRecommendation(payload.recommendation);
    const confidence = normalizeWorkflowDecisionConfidence(payload.confidence);
    const requiresHumanReview = normalizeWorkflowBooleanFlag(payload.requiresHumanReview);
    const blockingIssues = normalizeWorkflowConclusionList(payload.blockingIssues || payload.blockers);
    return {
      ...(summary ? { summary } : {}),
      validated: normalizeWorkflowConclusionList(payload.validated),
      unverified: normalizeWorkflowConclusionList(payload.unverified),
      findings: normalizeWorkflowConclusionList(payload.findings),
      evidence: normalizeWorkflowConclusionList(payload.evidence),
      ...(recommendation ? { recommendation } : {}),
      ...(confidence ? { confidence } : {}),
      ...(blockingIssues.length > 0 ? { blockingIssues } : {}),
      ...(requiresHumanReview === true ? { requiresHumanReview: true } : {}),
    };
  }
  if (normalizedType === 'decision_result') {
    const confidence = normalizeWorkflowDecisionConfidence(payload.confidence);
    const parallelTasks = normalizeWorkflowParallelTasks(
      payload.parallelTasks || payload.parallel_tasks || payload.tasks || [],
    );
    return {
      ...(normalizeWorkflowConclusionSummary(payload.recommendation || '')
        ? { recommendation: normalizeWorkflowConclusionSummary(payload.recommendation || '') }
        : {}),
      rejectedOptions: normalizeWorkflowConclusionList(payload.rejectedOptions),
      tradeoffs: normalizeWorkflowConclusionList(payload.tradeoffs),
      decisionNeeded: normalizeWorkflowConclusionList(payload.decisionNeeded),
      ...(parallelTasks.length > 0 ? { parallelTasks } : {}),
      ...(confidence ? { confidence } : {}),
    };
  }
  return {};
}

function isValidVerificationResultPayload(payload = {}) {
  const normalized = normalizeWorkflowConclusionPayload(payload, 'verification_result');
  const summary = typeof normalized.summary === 'string' ? normalized.summary.trim() : '';
  const recommendation = normalizeWorkflowVerificationRecommendation(normalized.recommendation);
  const confidence = normalizeWorkflowDecisionConfidence(normalized.confidence);
  return summary.length > 0 && !!recommendation && !!confidence;
}

function shouldWorkflowVerificationRequireHumanReview(payload = {}, gatePolicy = 'low_confidence_only') {
  const normalizedPolicy = normalizeGatePolicy(gatePolicy);
  if (normalizedPolicy === 'always_manual') return true;
  if (normalizedPolicy === 'final_confirm_only') return false;
  const normalized = normalizeWorkflowConclusionPayload(payload, 'verification_result');
  const confidence = normalizeWorkflowDecisionConfidence(normalized.confidence);
  const recommendation = normalizeWorkflowVerificationRecommendation(normalized.recommendation);
  if (normalized.requiresHumanReview === true) return true;
  if (recommendation === 'needs_fix' || recommendation === 'needs_more_validation') return true;
  if ((normalized.blockingIssues || []).length > 0) return true;
  if ((normalized.unverified || []).length > 0) return true;
  if ((normalized.findings || []).length > 0) return true;
  if (confidence && confidence !== 'high') return true;
  return false;
}

function canWorkflowVerificationAutoAbsorb(payload = {}, gatePolicy = 'low_confidence_only') {
  const normalizedPolicy = normalizeGatePolicy(gatePolicy);
  if (normalizedPolicy === 'always_manual') return false;
  if (normalizedPolicy === 'final_confirm_only') return true;
  const normalized = normalizeWorkflowConclusionPayload(payload, 'verification_result');
  return !shouldWorkflowVerificationRequireHumanReview(normalized, normalizedPolicy)
    && normalizeWorkflowDecisionConfidence(normalized.confidence) === 'high'
    && normalizeWorkflowVerificationRecommendation(normalized.recommendation) === 'ok';
}

function shouldWorkflowDecisionRequireHumanReview(payload = {}, gatePolicy = 'low_confidence_only') {
  const normalizedPolicy = normalizeGatePolicy(gatePolicy);
  if (normalizedPolicy === 'always_manual') return true;
  if (normalizedPolicy === 'final_confirm_only') return false;
  const normalized = normalizeWorkflowConclusionPayload(payload, 'decision_result');
  const confidence = normalizeWorkflowDecisionConfidence(normalized.confidence);
  const recommendation = normalizeWorkflowConclusionSummary(normalized.recommendation || '');
  if (!recommendation) return true;
  if (!confidence || confidence !== 'high') return true;
  return false;
}

function canWorkflowDecisionAutoAbsorb(payload = {}, gatePolicy = 'low_confidence_only') {
  const normalizedPolicy = normalizeGatePolicy(gatePolicy);
  if (normalizedPolicy === 'always_manual') return false;
  if (normalizedPolicy === 'final_confirm_only') return true;
  const normalized = normalizeWorkflowConclusionPayload(payload, 'decision_result');
  return !shouldWorkflowDecisionRequireHumanReview(normalized, normalizedPolicy)
    && normalizeWorkflowDecisionConfidence(normalized.confidence) === 'high'
    && !!normalizeWorkflowConclusionSummary(normalized.recommendation || '');
}

function normalizeWorkflowRiskSignalKeywords(keywords = WORKFLOW_RISK_SIGNAL_KEYWORDS) {
  return (Array.isArray(keywords) ? keywords : [])
    .map((keyword) => (typeof keyword === 'string' ? keyword.trim() : ''))
    .filter(Boolean);
}

function detectWorkflowRiskSignalMatches(text = '', keywords = WORKFLOW_RISK_SIGNAL_KEYWORDS) {
  const content = typeof text === 'string' ? text.trim() : '';
  if (!content) return [];
  const haystack = content.toLowerCase();
  const matches = [];
  for (const keyword of normalizeWorkflowRiskSignalKeywords(keywords)) {
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
    return { hasRiskSignals: false, matches: [], content: '' };
  }
  const assistantMessage = await findLatestAssistantMessageForRun(sessionId, normalizedRunId);
  const content = typeof assistantMessage?.content === 'string' ? assistantMessage.content.trim() : '';
  const matches = detectWorkflowRiskSignalMatches(content);
  return {
    hasRiskSignals: matches.length > 0,
    matches,
    content,
  };
}

function resolveWorkflowSuggestionStage(session, suggestionType) {
  const executor = getWorkflowSubstageExecutorBySuggestionType(suggestionType);
  if (!executor) return null;
  const currentStage = getCurrentWorkflowStage(session);
  if (currentStage?.role === executor.role) {
    return currentStage;
  }
  const nextStage = getNextWorkflowStage(session);
  if (nextStage?.stage?.role === executor.role) {
    return nextStage.stage;
  }
  if (!normalizeWorkflowDefinition(session?.workflowDefinition) && executor.role === 'verify') {
    return { role: 'verify', terminal: false };
  }
  return null;
}

export function shouldAutoAdvanceWorkflowStage(session, suggestionType, options = {}) {
  const stage = resolveWorkflowSuggestionStage(session, suggestionType);
  if (!stage) return false;
  if (stage.terminal === true) return false;
  if (options?.hasRiskSignals === true) return false;
  const normalizedPolicy = normalizeGatePolicy(getWorkflowGatePolicy(session));
  if (normalizedPolicy === 'always_manual') return false;
  return normalizedPolicy === 'low_confidence_only' || normalizedPolicy === 'final_confirm_only';
}

function shouldWorkflowConclusionAutoAccept(handoffType, handoffPayload = {}, options = {}) {
  if (normalizeWorkflowConclusionStatus(options.initialStatus || '') !== 'pending') return false;
  if (options?.hasRiskSignals === true) return false;
  const normalizedType = normalizeWorkflowHandoffType(handoffType || '');
  if (normalizedType === 'verification_result') {
    const normalized = normalizeWorkflowConclusionPayload(handoffPayload, normalizedType);
    return normalizeWorkflowDecisionConfidence(normalized.confidence) === 'high'
      && normalizeWorkflowVerificationRecommendation(normalized.recommendation) === 'ok';
  }
  if (normalizedType === 'decision_result') {
    const normalized = normalizeWorkflowConclusionPayload(handoffPayload, normalizedType);
    return normalizeWorkflowDecisionConfidence(normalized.confidence) === 'high'
      && !!normalizeWorkflowConclusionSummary(normalized.recommendation || '');
  }
  return false;
}

function normalizeWorkflowPendingConclusion(conclusion = {}) {
  const id = typeof conclusion?.id === 'string' && conclusion.id.trim()
    ? conclusion.id.trim()
    : generateId();
  const sourceSessionId = typeof conclusion?.sourceSessionId === 'string'
    ? conclusion.sourceSessionId.trim()
    : '';
  const sourceSessionName = typeof conclusion?.sourceSessionName === 'string'
    ? conclusion.sourceSessionName.trim()
    : '';
  const handoffKind = typeof conclusion?.handoffKind === 'string' && conclusion.handoffKind.trim()
    ? conclusion.handoffKind.trim()
    : 'workflow';
  const handoffType = normalizeWorkflowHandoffType(conclusion?.handoffType || '', handoffKind);
  const label = typeof conclusion?.label === 'string' && conclusion.label.trim()
    ? conclusion.label.trim()
    : getWorkflowHandoffTypeLabel(handoffType);
  const summary = normalizeWorkflowConclusionSummary(conclusion?.summary || '');
  const status = normalizeWorkflowConclusionStatus(conclusion?.status || '');
  const round = Number.isInteger(conclusion?.round) && conclusion.round > 0
    ? conclusion.round
    : 1;
  const supersedesHandoffId = typeof conclusion?.supersedesHandoffId === 'string' && conclusion.supersedesHandoffId.trim()
    ? conclusion.supersedesHandoffId.trim()
    : '';
  const createdAt = typeof conclusion?.createdAt === 'string' && conclusion.createdAt.trim()
    ? conclusion.createdAt.trim()
    : nowIso();
  const handledAt = typeof conclusion?.handledAt === 'string' && conclusion.handledAt.trim()
    ? conclusion.handledAt.trim()
    : '';
  const eventSeq = Number.isInteger(conclusion?.eventSeq) ? conclusion.eventSeq : undefined;
  const payload = normalizeWorkflowConclusionPayload(conclusion?.payload || {}, handoffType);
  return {
    id,
    sourceSessionId,
    sourceSessionName,
    handoffKind,
    handoffType,
    label,
    summary,
    status,
    round,
    createdAt,
    ...(supersedesHandoffId ? { supersedesHandoffId } : {}),
    ...(handledAt ? { handledAt } : {}),
    ...(eventSeq !== undefined ? { eventSeq } : {}),
    ...(Object.keys(payload).length > 0 ? { payload } : {}),
  };
}

function normalizeWorkflowPendingConclusions(conclusions = []) {
  if (!Array.isArray(conclusions)) return [];
  return conclusions
    .map((item) => normalizeWorkflowPendingConclusion(item))
    .filter((item) => item.summary)
    .slice(-20);
}

function normalizeWorkflowSuggestionType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'suggest_verification') return normalized;
  if (normalized === 'suggest_decision') return normalized;
  return '';
}

function normalizeWorkflowSuggestionStatus(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'pending') return normalized;
  return '';
}

function normalizeWorkflowSuggestion(suggestion = {}) {
  if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) return null;
  const type = normalizeWorkflowSuggestionType(suggestion.type || '');
  if (!type) return null;
  const status = normalizeWorkflowSuggestionStatus(suggestion.status || '');
  if (!status) return null;
  const runId = typeof suggestion.runId === 'string' ? suggestion.runId.trim() : '';
  const createdAt = typeof suggestion.createdAt === 'string' && suggestion.createdAt.trim()
    ? suggestion.createdAt.trim()
    : nowIso();
  return {
    type,
    status,
    ...(runId ? { runId } : {}),
    createdAt,
  };
}

function getActiveWorkflowSuggestion(session) {
  const normalized = normalizeWorkflowSuggestion(session?.workflowSuggestion || null);
  if (!normalized || normalized.status !== 'pending') return null;
  return normalized;
}

function hasOpenWorkflowConclusionOfType(session, handoffType) {
  const normalizedType = normalizeWorkflowHandoffType(handoffType || '');
  if (!normalizedType) return false;
  const conclusions = normalizeWorkflowPendingConclusions(session?.workflowPendingConclusions || []);
  return conclusions.some((entry) => {
    const status = normalizeWorkflowConclusionStatus(entry?.status || '');
    const type = normalizeWorkflowHandoffType(entry?.handoffType || '', entry?.handoffKind || '');
    return ['pending', 'needs_decision'].includes(status) && type === normalizedType;
  });
}

export function isWorkflowAuxiliaryMessage(event) {
  return event?.type === 'message'
    && event?.role === 'assistant'
    && ['session_delegate_notice', 'workflow_handoff_notice', 'workflow_handoff'].includes(event?.messageKind || '');
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

export function normalizeSessionAppName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}
