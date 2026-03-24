"use strict";

const buildInfo = window.__REMOTELAB_BUILD__ || {};
const pageBootstrap =
  window.__REMOTELAB_BOOTSTRAP__ && typeof window.__REMOTELAB_BOOTSTRAP__ === "object"
    ? window.__REMOTELAB_BOOTSTRAP__
    : {};
const buildAssetVersion = buildInfo.assetVersion || "dev";

function normalizeBootstrapText(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized || "";
}

function normalizeBootstrapAuthInfo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const role = raw.role === "visitor" ? "visitor" : "owner";
  if (role === "owner") {
    return { role };
  }

  const sessionId = normalizeBootstrapText(raw.sessionId);
  if (!sessionId) return null;

  const info = {
    role,
    sessionId,
  };
  const appId = normalizeBootstrapText(raw.appId);
  const visitorId = normalizeBootstrapText(raw.visitorId);
  if (appId) info.appId = appId;
  if (visitorId) info.visitorId = visitorId;
  return info;
}

const bootstrapAuthInfo = normalizeBootstrapAuthInfo(pageBootstrap.auth);

function normalizeBootstrapShareSnapshot(rawPayload, rawMeta = null) {
  const payload = rawPayload && typeof rawPayload === "object"
    ? rawPayload
    : {};
  const meta = rawMeta && typeof rawMeta === "object"
    ? rawMeta
    : {};
  if (Object.keys(payload).length === 0 && Object.keys(meta).length === 0) {
    return null;
  }

  const id = normalizeBootstrapText(payload.id || meta.id || meta.shareId);
  const sessionRaw = payload.session && typeof payload.session === "object"
    ? payload.session
    : (meta.session && typeof meta.session === "object" ? meta.session : {});
  const payloadView = payload.view && typeof payload.view === "object"
    ? payload.view
    : {};
  const metaView = meta.view && typeof meta.view === "object"
    ? meta.view
    : {};
  const view = {
    ...payloadView,
    ...metaView,
  };
  if (meta.badge && !view.badge) view.badge = meta.badge;
  if (meta.note && !view.note) view.note = meta.note;
  if (meta.titleSuffix && !view.titleSuffix) view.titleSuffix = meta.titleSuffix;
  const eventBlocks = payload.eventBlocks && typeof payload.eventBlocks === "object"
    ? Object.fromEntries(
      Object.entries(payload.eventBlocks)
        .filter(([key, events]) => typeof key === "string" && Array.isArray(events)),
    )
    : {};
  const displayEvents = Array.isArray(payload.displayEvents)
    ? payload.displayEvents.filter((event) => event && typeof event === "object")
    : [];

  return {
    id,
    version: payload.version,
    createdAt: normalizeBootstrapText(payload.createdAt || meta.createdAt) || null,
    session: {
      name: normalizeBootstrapText(sessionRaw.name),
      tool: normalizeBootstrapText(sessionRaw.tool),
      created: normalizeBootstrapText(sessionRaw.created) || null,
    },
    view,
    eventCount: Number.isInteger(payload.eventCount)
      ? payload.eventCount
      : displayEvents.length,
    displayEvents,
    eventBlocks,
  };
}

const bootstrapShareSnapshot = normalizeBootstrapShareSnapshot(
  window.__REMOTELAB_SHARE__,
  pageBootstrap.shareSnapshot,
);

function getBootstrapAuthInfo() {
  return bootstrapAuthInfo ? { ...bootstrapAuthInfo } : null;
}

function getBootstrapShareSnapshot() {
  return bootstrapShareSnapshot;
}

console.info(
  "RemoteLab build",
  buildInfo.title || buildInfo.serviceTitle || buildAssetVersion,
);

let buildRefreshScheduled = false;
let newerBuildInfo = null;

async function clearFrontendCaches() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration().catch(
    () => null,
  );
  if (!registration) return;
  const message = { type: "remotelab:clear-caches" };
  registration.installing?.postMessage(message);
  registration.waiting?.postMessage(message);
  registration.active?.postMessage(message);
}

function updateFrontendRefreshUi() {
  if (!refreshFrontendBtn) return;
  const hasUpdate = !!newerBuildInfo?.assetVersion;
  refreshFrontendBtn.hidden = !hasUpdate;
  refreshFrontendBtn.classList.toggle("ready", hasUpdate);
  const updateTitle = hasUpdate
    ? "Frontend update available — tap to reload"
    : "Reload latest frontend";
  refreshFrontendBtn.title = updateTitle;
  refreshFrontendBtn.setAttribute("aria-label", updateTitle);
  if (!hasUpdate) {
    refreshFrontendBtn.removeAttribute("aria-busy");
  }
}

async function reloadForFreshBuild(nextBuildInfo) {
  if (buildRefreshScheduled) return;
  buildRefreshScheduled = true;
  refreshFrontendBtn?.setAttribute("aria-busy", "true");
  console.info(
    "RemoteLab frontend updated; reloading",
    nextBuildInfo?.title ||
      newerBuildInfo?.title ||
      nextBuildInfo?.assetVersion ||
      newerBuildInfo?.assetVersion ||
      "unknown",
  );
  try {
    await clearFrontendCaches();
  } catch {}
  window.location.reload();
  return true;
}

async function applyBuildInfo(nextBuildInfo) {
  if (buildRefreshScheduled) return false;
  if (!nextBuildInfo?.assetVersion) {
    return false;
  }
  if (nextBuildInfo.assetVersion === buildAssetVersion) {
    if (!buildRefreshScheduled) {
      newerBuildInfo = null;
      updateFrontendRefreshUi();
    }
    return false;
  }
  newerBuildInfo = nextBuildInfo;
  updateFrontendRefreshUi();
  return false;
}

window.RemoteLabBuild = {
  applyBuildInfo,
  reloadForFreshBuild,
};

// ---- Elements ----
const menuBtn = document.getElementById("menuBtn");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const closeSidebar = document.getElementById("closeSidebar");
const workflowSummaryBtn = document.getElementById("workflowSummaryBtn");
const forkSessionBtn = document.getElementById("forkSessionBtn");
const handoffSessionBtn = document.getElementById("handoffSessionBtn");
const shareSnapshotBtn = document.getElementById("shareSnapshotBtn");
const sidebarFilters = document.getElementById("sidebarFilters");
const sessionList = document.getElementById("sessionList");
const sessionListFooter = document.getElementById("sessionListFooter");
const themeSettingsSelect = document.getElementById("themeSettingsSelect");
const themeSettingsStatus = document.getElementById("themeSettingsStatus");
const newUserNameInput = document.getElementById("newUserNameInput");
const newUserAppsPicker = document.getElementById("newUserAppsPicker");
const newUserDefaultAppSelect = document.getElementById("newUserDefaultAppSelect");
const createUserBtn = document.getElementById("createUserBtn");
const userFormStatus = document.getElementById("userFormStatus");
const settingsUsersList = document.getElementById("settingsUsersList");
const settingsAppsList = document.getElementById("settingsAppsList");
const newAppNameInput = document.getElementById("newAppNameInput");
const newAppToolSelect = document.getElementById("newAppToolSelect");
const newAppWelcomeInput = document.getElementById("newAppWelcomeInput");
const newAppSystemPromptInput = document.getElementById("newAppSystemPromptInput");
const createAppConfigBtn = document.getElementById("createAppConfigBtn");
const appFormStatus = document.getElementById("appFormStatus");
const newAppBtn = document.getElementById("newAppBtn");
const newSessionBtn = document.getElementById("newSessionBtn");
const messagesEl = document.getElementById("messages");
const messagesInner = document.getElementById("messagesInner");
const emptyState = document.getElementById("emptyState");
const queuedPanel = document.getElementById("queuedPanel");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const headerTitle = document.getElementById("headerTitle");
const refreshFrontendBtn = document.getElementById("refreshFrontendBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const imgBtn = document.getElementById("imgBtn");
const imgFileInput = document.getElementById("imgFileInput");
const imgPreviewStrip = document.getElementById("imgPreviewStrip");
const inlineToolSelect = document.getElementById("inlineToolSelect");
const inlineModelSelect = document.getElementById("inlineModelSelect");
const effortSelect = document.getElementById("effortSelect");
const thinkingToggle = document.getElementById("thinkingToggle");
const cancelBtn = document.getElementById("cancelBtn");
const contextTokens = document.getElementById("contextTokens");
const compactBtn = document.getElementById("compactBtn");
const dropToolsBtn = document.getElementById("dropToolsBtn");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const sessionTemplateRow = document.getElementById("sessionTemplateRow");
const sessionTemplateSelect = document.getElementById("sessionTemplateSelect");
const sessionTemplateStatus = document.getElementById("sessionTemplateStatus");
const tabSessions = document.getElementById("tabSessions");
const tabBoard = document.getElementById("tabBoard");
const tabSettings = document.getElementById("tabSettings");
const sourceFilterSelect = document.getElementById("sourceFilterSelect");
const sessionAppFilterSelect = document.getElementById("sessionAppFilterSelect");
const userFilterSelect = document.getElementById("userFilterSelect");
const boardPanel = document.getElementById("boardPanel");
const settingsPanel = document.getElementById("settingsPanel");
const inputArea = document.getElementById("inputArea");
const composerPendingState = document.getElementById("composerPendingState");
const inputResizeHandle = document.getElementById("inputResizeHandle");
const codexImportModal = document.getElementById("codexImportModal");
const closeCodexImportModalBtn = document.getElementById("closeCodexImportModal");
const cancelCodexImportBtn = document.getElementById("cancelCodexImportBtn");
const confirmCodexImportBtn = document.getElementById("confirmCodexImportBtn");
const codexImportThreadInput = document.getElementById("codexImportThreadInput");
const codexImportStatus = document.getElementById("codexImportStatus");
const addToolModal = document.getElementById("addToolModal");
const closeAddToolModalBtn = document.getElementById("closeAddToolModal");
const closeAddToolModalFooterBtn = document.getElementById(
  "closeAddToolModalFooter",
);
const addToolNameInput = document.getElementById("addToolNameInput");
const addToolCommandInput = document.getElementById("addToolCommandInput");
const addToolRuntimeFamilySelect = document.getElementById(
  "addToolRuntimeFamilySelect",
);
const addToolModelsInput = document.getElementById("addToolModelsInput");
const addToolReasoningKindSelect = document.getElementById(
  "addToolReasoningKindSelect",
);
const addToolReasoningLevelsInput = document.getElementById(
  "addToolReasoningLevelsInput",
);
const addToolStatus = document.getElementById("addToolStatus");
const providerPromptCode = document.getElementById("providerPromptCode");
const saveToolConfigBtn = document.getElementById("saveToolConfigBtn");
const copyProviderPromptBtn = document.getElementById("copyProviderPromptBtn");

let chromeBridgeListeners = new Set();
let lastChromeBridgeState = null;

function cloneChromeSummaryConclusion(conclusion) {
  if (!conclusion || typeof conclusion !== "object") return null;
  return {
    id: conclusion.id || "",
    label: conclusion.label || "",
    status: conclusion.status || "pending",
    summary: conclusion.summary || "",
    sourceSessionName: conclusion.sourceSessionName || "",
    handledAt: conclusion.handledAt || "",
    payload: conclusion.payload && typeof conclusion.payload === "object"
      ? {
          confidence: conclusion.payload.confidence || "",
          recommendation: conclusion.payload.recommendation || "",
          parallelTasks: Array.isArray(conclusion.payload.parallelTasks)
            ? conclusion.payload.parallelTasks
              .map((task, index) => {
                if (!task || typeof task !== "object") return null;
                const title = normalizeWorkflowTaskText(task.title || task.name) || `并行子任务 ${index + 1}`;
                const taskText = normalizeWorkflowTaskText(task.task || task.goal || task.summary);
                const boundary = normalizeWorkflowTaskText(task.boundary || task.constraints);
                const repo = normalizeWorkflowTaskText(task.repo || task.folder || task.project);
                return {
                  title,
                  ...(taskText ? { task: taskText } : {}),
                  ...(boundary ? { boundary } : {}),
                  ...(repo ? { repo } : {}),
                };
              })
              .filter(Boolean)
            : [],
        }
      : null,
  };
}

function getConclusionById(session, conclusionId) {
  const entries = Array.isArray(session?.workflowPendingConclusions) ? session.workflowPendingConclusions : [];
  return entries.find((entry) => entry?.id === conclusionId) || null;
}

function getConclusionParallelTasks(conclusion) {
  const tasks = Array.isArray(conclusion?.payload?.parallelTasks) ? conclusion.payload.parallelTasks : [];
  return tasks
    .map((task, index) => {
      if (!task || typeof task !== "object") return null;
      const title = normalizeWorkflowTaskText(task.title || task.name) || `并行子任务 ${index + 1}`;
      const taskText = normalizeWorkflowTaskText(task.task || task.goal || task.summary);
      const boundary = normalizeWorkflowTaskText(task.boundary || task.constraints);
      const repo = normalizeWorkflowTaskText(task.repo || task.folder || task.project);
      return {
        title,
        ...(taskText ? { task: taskText } : {}),
        ...(boundary ? { boundary } : {}),
        ...(repo ? { repo } : {}),
      };
    })
    .filter(Boolean);
}

function cloneChromeSummarySuggestion(session) {
  const suggestion = typeof getActiveWorkflowSuggestion === "function"
    ? getActiveWorkflowSuggestion(session)
    : null;
  if (!suggestion) return null;
  return {
    type: suggestion.type || "",
    title: typeof getWorkflowSuggestionTitle === "function"
      ? getWorkflowSuggestionTitle(suggestion)
      : "",
    body: typeof getWorkflowSuggestionBody === "function"
      ? getWorkflowSuggestionBody(session, suggestion)
      : "",
  };
}

function getChromeWorkflowStatusLabel(session) {
  const workflowInfo = typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.getWorkflowStatusInfo === "function"
    ? window.RemoteLabSessionStateModel.getWorkflowStatusInfo(session?.workflowState)
    : null;
  if (workflowInfo?.label) return workflowInfo.label;
  return "";
}

const CHROME_WORKFLOW_STAGE_ROLE_LABELS = {
  execute: "执行",
  verify: "验收",
  deliberate: "再议",
};

function getNormalizedWorkflowDefinitionForChrome(session) {
  const definition = session?.workflowDefinition;
  if (!definition || typeof definition !== "object") return null;
  const stages = Array.isArray(definition.stages)
    ? definition.stages
      .map((stage) => {
        if (!stage || typeof stage !== "object") return null;
        const role = typeof stage.role === "string" ? stage.role.trim().toLowerCase() : "";
        if (!role) return null;
        const label = typeof stage.label === "string" ? stage.label.trim() : "";
        return {
          role,
          ...(label ? { label } : {}),
        };
      })
      .filter(Boolean)
    : [];
  if (stages.length === 0) return null;
  const currentStageIndex = Number.isInteger(definition.currentStageIndex) && definition.currentStageIndex >= 0
    ? Math.min(definition.currentStageIndex, stages.length - 1)
    : 0;
  return {
    stages,
    currentStageIndex,
  };
}

function getWorkflowStageBaseLabelForChrome(stage, index) {
  const explicit = typeof stage?.label === "string" ? stage.label.trim() : "";
  if (explicit) return explicit;
  const role = typeof stage?.role === "string" ? stage.role.trim().toLowerCase() : "";
  return CHROME_WORKFLOW_STAGE_ROLE_LABELS[role] || `阶段 ${index + 1}`;
}

function getWorkflowCurrentStageLabelForChrome(stage, index) {
  const label = getWorkflowStageBaseLabelForChrome(stage, index);
  return /中$/u.test(label) ? label : `${label}中`;
}

function isWorkflowActiveForChrome(session) {
  return !!getNormalizedWorkflowDefinitionForChrome(session)
    && String(session?.workflowState || "").trim() !== "done";
}

function buildChromeWorkflowStages(session) {
  const definition = getNormalizedWorkflowDefinitionForChrome(session);
  if (!definition || !isWorkflowActiveForChrome(session)) return [];
  return definition.stages.map((stage, index) => ({
    label: index === definition.currentStageIndex
      ? getWorkflowCurrentStageLabelForChrome(stage, index)
      : getWorkflowStageBaseLabelForChrome(stage, index),
    state: index < definition.currentStageIndex
      ? "completed"
      : (index === definition.currentStageIndex ? "current" : "upcoming"),
  }));
}

function getChromeWorkflowTimelineSortValue(stamp) {
  const parsed = new Date(stamp || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getChromeWorkflowTimelineTone(status = "") {
  const normalized = normalizeWorkflowTaskText(status).toLowerCase();
  if (["completed", "accepted"].includes(normalized)) return "success";
  if (["paused_for_decision", "needs_decision", "pending"].includes(normalized)) return "notice";
  if (["failed", "error", "rejected"].includes(normalized)) return "error";
  if (["ignored", "superseded"].includes(normalized)) return "muted";
  if (["needs_fix", "needs_more_validation"].includes(normalized)) return "warning";
  return "neutral";
}

function getChromeWorkflowTimelineStatusLabel(status = "") {
  const normalized = normalizeWorkflowTaskText(status).toLowerCase();
  if (normalized === "running") return "运行中";
  if (normalized === "completed") return "已完成";
  if (normalized === "paused_for_decision") return "待决策";
  if (normalized === "needs_decision") return "待决策";
  if (normalized === "pending") return "待处理";
  if (normalized === "accepted") return "已吸收";
  if (normalized === "ignored") return "已忽略";
  if (normalized === "superseded") return "已覆盖";
  if (normalized === "failed") return "失败";
  if (normalized === "needs_fix") return "需要修复";
  if (normalized === "needs_more_validation") return "需要补验";
  return normalizeWorkflowTaskText(status);
}

function getChromeWorkflowTimelineKindLabel(handoffType = "") {
  const normalized = normalizeWorkflowTaskText(handoffType).toLowerCase();
  if (normalized === "verification_result") return "验收结论";
  if (normalized === "decision_result") return "再议结论";
  if (normalized === "workflow_result") return "阶段结论";
  if (normalized === "inline_stage_advance") return "阶段推进";
  return "结果回流";
}

function getChromeWorkflowAutomationTone(type = "", content = "") {
  const normalizedType = normalizeWorkflowTaskText(type).toLowerCase();
  const normalizedContent = normalizeWorkflowTaskText(content).toLowerCase();
  if (/失败|回退|error/u.test(normalizedContent)) return "error";
  if (/暂停|待确认|风险/u.test(normalizedContent)) return "warning";
  if (normalizedType === "workflow_auto_absorb") return "success";
  if (/已自动启用工作流|已自动启动|已自动推进|已自动吸收/u.test(content)) return "success";
  if (normalizedType === "workflow_auto_advance") return "notice";
  return "neutral";
}

function buildChromeWorkflowStageTimelineEntry(entry, currentStageTraceId = "") {
  if (!entry || typeof entry !== "object" || !entry.id) return null;
  const stageRole = normalizeWorkflowTaskText(entry.stageRole).toLowerCase();
  const stageLabel = normalizeWorkflowTaskText(entry.stage)
    || CHROME_WORKFLOW_STAGE_ROLE_LABELS[stageRole]
    || normalizeWorkflowTaskText(entry.appName)
    || "阶段";
  const status = normalizeWorkflowTaskText(entry.status)
    || (entry.id === currentStageTraceId ? "running" : "");
  const sessionKind = normalizeWorkflowTaskText(entry.sessionKind);
  const stageIndex = Number.isInteger(entry.stageIndex) && entry.stageIndex >= 0 ? entry.stageIndex : -1;
  const sessionName = normalizeWorkflowTaskText(entry.sessionName);
  const outcome = normalizeWorkflowTaskText(entry.outcome);
  const title = sessionKind === "mainline"
    ? `${stageIndex >= 0 ? `阶段 ${stageIndex + 1}` : "主线阶段"} · ${stageLabel}`
    : `${stageLabel}子线`;
  const detailParts = [];
  if (sessionName) detailParts.push(sessionName);
  if (outcome && !["completed", "running"].includes(outcome.toLowerCase())) {
    detailParts.push(outcome);
  }
  const at = entry.completedAt || entry.updatedAt || entry.startedAt || "";
  return {
    id: entry.id,
    kind: "stage",
    title,
    detail: detailParts.join(" · "),
    statusLabel: getChromeWorkflowTimelineStatusLabel(status),
    tone: getChromeWorkflowTimelineTone(status),
    at,
  };
}

function buildChromeWorkflowDecisionTimelineEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.id) return null;
  const reason = normalizeWorkflowTaskText(entry.reason);
  const summary = normalizeWorkflowTaskText(entry.summary);
  const title = reason ? `决策点 · ${reason}` : "决策点";
  const status = normalizeWorkflowTaskText(entry.status) || "pending";
  return {
    id: entry.id,
    kind: "decision",
    title,
    detail: summary || normalizeWorkflowTaskText(entry.type),
    statusLabel: getChromeWorkflowTimelineStatusLabel(status),
    tone: getChromeWorkflowTimelineTone(status),
    at: entry.resolvedAt || entry.updatedAt || entry.createdAt || "",
  };
}

function buildChromeWorkflowReconcileTimelineEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.id) return null;
  const status = normalizeWorkflowTaskText(entry.status) || "pending";
  return {
    id: entry.id,
    kind: "reconcile",
    title: `${getChromeWorkflowTimelineKindLabel(entry.handoffType)}回流`,
    detail: normalizeWorkflowTaskText(entry.summary),
    statusLabel: getChromeWorkflowTimelineStatusLabel(status),
    tone: getChromeWorkflowTimelineTone(status),
    at: entry.resolvedAt || entry.updatedAt || entry.createdAt || "",
  };
}

function buildChromeWorkflowAutomationTimelineEntry(event) {
  if (!event || typeof event !== "object") return null;
  const type = normalizeWorkflowTaskText(event.type);
  const content = normalizeWorkflowTaskText(event.content || event.text || "");
  if (!type || !content) return null;

  let title = "";
  if (type === "workflow_auto_advance") {
    title = "自动推进";
  } else if (type === "workflow_auto_absorb") {
    title = "自动吸收";
  } else if (type === "status" && /^已自动启用工作流/u.test(content)) {
    title = "自动启用工作流";
  } else if (type === "status" && /^工作流已自动推进/u.test(content)) {
    title = "阶段自动流转";
  } else {
    return null;
  }

  return {
    id: `event:${Number.isInteger(event.seq) ? event.seq : content}`,
    kind: "event",
    title,
    detail: content,
    tone: getChromeWorkflowAutomationTone(type, content),
    at: event.timestamp || event.createdAt || "",
  };
}

function buildChromeWorkflowAutomationTimeline(session) {
  if (!session?.id || renderedEventState.sessionId !== session.id) return [];
  const displayEvents = Array.isArray(renderedEventState.displayEvents)
    ? renderedEventState.displayEvents
    : [];
  return displayEvents
    .map((event) => buildChromeWorkflowAutomationTimelineEntry(event))
    .filter(Boolean)
    .slice(-6);
}

function buildChromeWorkflowTimeline(session) {
  const trace = session?.workflowTaskTrace && typeof session.workflowTaskTrace === "object"
    ? session.workflowTaskTrace
    : null;
  const automationEntries = buildChromeWorkflowAutomationTimeline(session);
  if (!trace) {
    return automationEntries
      .sort((left, right) => getChromeWorkflowTimelineSortValue(right?.at) - getChromeWorkflowTimelineSortValue(left?.at))
      .slice(0, 8);
  }
  const currentStageTraceId = normalizeWorkflowTaskText(trace.currentStageTraceId);
  const stageEntries = Array.isArray(trace.stageTraces)
    ? trace.stageTraces
      .map((entry) => buildChromeWorkflowStageTimelineEntry(entry, currentStageTraceId))
      .filter(Boolean)
    : [];
  const decisionEntries = Array.isArray(trace.decisionRecords)
    ? trace.decisionRecords
      .map((entry) => buildChromeWorkflowDecisionTimelineEntry(entry))
      .filter(Boolean)
    : [];
  const reconcileEntries = Array.isArray(trace.reconcileRecords)
    ? trace.reconcileRecords
      .map((entry) => buildChromeWorkflowReconcileTimelineEntry(entry))
      .filter(Boolean)
    : [];
  return [...automationEntries, ...stageEntries, ...decisionEntries, ...reconcileEntries]
    .sort((left, right) => getChromeWorkflowTimelineSortValue(right?.at) - getChromeWorkflowTimelineSortValue(left?.at))
    .slice(0, 8);
}

function buildChromeWorkflowAutoTriggerState(session) {
  if (!session || session.visitorId || session.archived) return null;
  return {
    visible: true,
    disabled: session.workflowAutoTriggerDisabled === true,
    activeWorkflow: !!getNormalizedWorkflowDefinitionForChrome(session),
  };
}

function buildChromeBridgeSummary(session) {
  if (!session || typeof isWorkflowMainlineSession !== "function" || !isWorkflowMainlineSession(session)) {
    return null;
  }
  const getByStatus = typeof getWorkflowConclusionsByStatus === "function"
    ? getWorkflowConclusionsByStatus
    : () => [];
  const currentTask = typeof getWorkflowPanelCurrentTask === "function"
    ? getWorkflowPanelCurrentTask(session)
    : (session?.name || session?.description || "");
  const activeVerification = (function findActiveVerificationSession() {
    if (!session?.id || !Array.isArray(sessions)) return null;
    const verificationAppNames = ["验收", "执行验收", "风险复核"];
    const deliberationAppNames = ["再议", "深度裁决", "PR把关", "推敲"];
    const candidate = sessions.find((candidateSession) => {
      if (!candidateSession || candidateSession.archived || candidateSession.id === session.id) {
        return false;
      }
      if (typeof candidateSession.handoffTargetSessionId !== "string"
          || candidateSession.handoffTargetSessionId !== session.id) {
        return false;
      }
      const candidateAppName = (candidateSession.templateAppName || candidateSession.appName || "").trim();
      return verificationAppNames.includes(candidateAppName) || deliberationAppNames.includes(candidateAppName);
    });
    if (!candidate) return null;
    const candidateAppName = (candidate.templateAppName || candidate.appName || "").trim();
    return {
      id: candidate.id,
      name: candidate.name || "验收",
      kind: deliberationAppNames.includes(candidateAppName) ? "deliberation" : "verification",
      runState: candidate?.activity?.run?.state || "idle",
    };
  })();
  return {
    currentTask: currentTask || "",
    suggestion: cloneChromeSummarySuggestion(session),
    workflowStatus: getChromeWorkflowStatusLabel(session),
    workflowStages: buildChromeWorkflowStages(session),
    workflowTimeline: buildChromeWorkflowTimeline(session),
    activeVerification,
    pending: getByStatus(session, ["pending"]).map(cloneChromeSummaryConclusion).filter(Boolean),
    decisions: getByStatus(session, ["needs_decision"]).map(cloneChromeSummaryConclusion).filter(Boolean),
    handled: getByStatus(session, ["accepted", "ignored"])
      .map(cloneChromeSummaryConclusion)
      .filter(Boolean)
      .slice(0, 4),
  };
}

async function runChromeWorkflowConclusionAction(conclusionId, status) {
  const sessionId = typeof currentSessionId === "string" ? currentSessionId : "";
  if (!sessionId || !conclusionId || !status) return;
  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(sessionId)}/conclusions/${encodeURIComponent(conclusionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (data?.session) {
    const updated = upsertSession(data.session) || data.session;
    renderSessionList();
    if (updated && currentSessionId === updated.id) {
      applyAttachedSessionState(updated.id, updated);
    }
    return;
  }
  if (currentSessionId === sessionId) {
    await refreshCurrentSession();
  }
}

async function runChromeWorkflowSuggestionAction(action) {
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  if (!session?.id || !action) return;
  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}/workflow-suggestion/${encodeURIComponent(action)}`, {
    method: "POST",
  });
  if (action === "accept" && data?.session) {
    let sourceSession = null;
    if (data?.sourceSession) {
      sourceSession = upsertSession(data.sourceSession) || data.sourceSession;
    }
    upsertSession(data.session);
    renderSessionList();
    if (typeof showAppToast === "function") {
      showAppToast(data?.run ? "已开启验收并自动开始" : "已开启验收", "success");
    }
    if (sourceSession && currentSessionId === sourceSession.id) {
      applyAttachedSessionState(sourceSession.id, sourceSession);
    } else if (currentSessionId) {
      await refreshCurrentSession();
    }
    if (typeof emitChromeBridgeState === "function") {
      emitChromeBridgeState();
    }
    return;
  }
  if (action === "dismiss" && data?.session) {
    const updated = upsertSession(data.session) || data.session;
    if (updated && currentSessionId === updated.id) {
      applyAttachedSessionState(updated.id, updated);
    } else {
      renderSessionList();
    }
    if (typeof showAppToast === "function") {
      showAppToast("已跳过本轮建议", "neutral");
    }
  }
}

function buildParallelTaskGroupLabel(session) {
  return normalizeWorkflowTaskText(session?.group)
    || normalizeWorkflowTaskText(session?.workflowCurrentTask)
    || (typeof getSessionDisplayName === "function" ? normalizeWorkflowTaskText(getSessionDisplayName(session)) : "")
    || "并行任务";
}

function buildParallelTaskKickoffMessage(session, task) {
  const mainlineLabel = typeof getSessionDisplayName === "function"
    ? normalizeWorkflowTaskText(getSessionDisplayName(session))
    : "";
  return [
    mainlineLabel ? `这是从主线 session“${mainlineLabel}”拆出来的并行执行子任务。` : "这是一个并行执行子任务。",
    `目标：${normalizeWorkflowTaskText(task?.task) || normalizeWorkflowTaskText(task?.title) || "请按这条子线直接推进实现。"}`,
    task?.boundary ? `边界：${normalizeWorkflowTaskText(task.boundary)}` : "",
    task?.repo ? `目标仓库：${normalizeWorkflowTaskText(task.repo)}` : "",
    "请直接开始实现；完成后把结果回流主线。",
  ].filter(Boolean).join("\n");
}

function resolveParallelTaskFolder(session, task) {
  return normalizeWorkflowTaskText(task?.repo)
    || normalizeWorkflowTaskText(session?.folder)
    || normalizeWorkflowTaskText(session?.worktree?.repoRoot)
    || "~";
}

async function createParallelSessionsFromConclusion(conclusionId) {
  const sourceSession = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  if (!sourceSession?.id) {
    throw new Error("当前没有可用的主线 session");
  }

  const conclusion = getConclusionById(sourceSession, conclusionId);
  const parallelTasks = getConclusionParallelTasks(conclusion);
  if (parallelTasks.length === 0) {
    throw new Error("这条结论没有可创建的并行任务");
  }

  const groupLabel = buildParallelTaskGroupLabel(sourceSession);
  const createdSessions = [];

  try {
    for (const [index, task] of parallelTasks.entries()) {
      const createPayload = {
        folder: resolveParallelTaskFolder(sourceSession, task),
        tool: normalizeWorkflowTaskText(sourceSession.tool) || preferredTool || selectedTool || toolsList?.[0]?.id || "",
        model: normalizeWorkflowTaskText(sourceSession.model),
        effort: normalizeWorkflowTaskText(sourceSession.effort),
        thinking: sourceSession.thinking === true,
        name: normalizeWorkflowTaskText(task.title) || `并行子任务 ${index + 1}`,
        description: normalizeWorkflowTaskText(task.task) || normalizeWorkflowTaskText(task.boundary) || normalizeWorkflowTaskText(task.title),
        appId: sourceSession.appId || "",
        appName: sourceSession.appName || "",
        sourceId: sourceSession.sourceId || "",
        sourceName: sourceSession.sourceName || "",
        userId: sourceSession.userId || "",
        userName: sourceSession.userName || "",
        group: groupLabel,
        worktree: true,
      };

      const created = await fetchJsonOrRedirect("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
      });
      let nextSession = upsertSession(created.session) || created.session;
      if (!nextSession?.id) {
        throw new Error(`创建第 ${index + 1} 条并行 session 失败`);
      }

      const patched = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(nextSession.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoffTargetSessionId: sourceSession.id,
        }),
      });
      nextSession = upsertSession(patched.session) || patched.session || nextSession;

      const kickoffMessage = buildParallelTaskKickoffMessage(sourceSession, task);
      if (kickoffMessage) {
        const messageResponse = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(nextSession.id)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: createRequestId(),
            text: kickoffMessage,
          }),
        });
        nextSession = upsertSession(messageResponse.session) || messageResponse.session || nextSession;
      }

      createdSessions.push(nextSession);
    }
  } catch (error) {
    renderSessionList();
    const prefix = createdSessions.length > 0 ? `前面已创建 ${createdSessions.length} 条。` : "";
    throw new Error(`${prefix}${error instanceof Error ? error.message : "批量创建失败"}`.trim());
  }

  await runChromeWorkflowConclusionAction(conclusionId, "accepted");
  collapsedFolders[`group:${groupLabel}`] = false;
  try {
    localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(collapsedFolders));
  } catch {}
  renderSessionList();
  if (typeof switchTab === "function") {
    switchTab("sessions");
  }
  if (typeof showAppToast === "function") {
    showAppToast(`已创建 ${createdSessions.length} 个并行 session`, "success");
  }

  return createdSessions;
}

function buildChromeBridgeState() {
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  return {
    title: headerTitle?.textContent || "",
    statusLabel: statusText?.textContent || "",
    currentSessionId: typeof currentSessionId === "string" ? currentSessionId : "",
    visitorMode: visitorMode === true,
    summary: buildChromeBridgeSummary(session),
    workflowAutoTrigger: buildChromeWorkflowAutoTriggerState(session),
    actions: {
      fork: {
        visible: !!forkSessionBtn && forkSessionBtn.hidden !== true,
        disabled: !!forkSessionBtn && forkSessionBtn.disabled === true,
      },
      share: {
        visible: !!shareSnapshotBtn && shareSnapshotBtn.hidden !== true,
        disabled: !!shareSnapshotBtn && shareSnapshotBtn.disabled === true,
      },
      handoff: {
        visible: !!handoffSessionBtn && handoffSessionBtn.hidden !== true,
        disabled: !!handoffSessionBtn && handoffSessionBtn.disabled === true,
      },
    },
  };
}

function emitChromeBridgeState() {
  lastChromeBridgeState = buildChromeBridgeState();
  window.__REMOTELAB_CHROME_STATE__ = lastChromeBridgeState;
  for (const listener of chromeBridgeListeners) {
    try {
      listener(lastChromeBridgeState);
    } catch (error) {
      console.warn("[chrome-bridge] listener failed:", error?.message || error);
    }
  }
  window.dispatchEvent(new CustomEvent("remotelab:chrome-state", { detail: lastChromeBridgeState }));
}

window.remotelabChromeBridge = {
  getState() {
    if (!lastChromeBridgeState) {
      lastChromeBridgeState = buildChromeBridgeState();
    }
    return lastChromeBridgeState;
  },
  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    chromeBridgeListeners.add(listener);
    listener(window.remotelabChromeBridge.getState());
    return () => {
      chromeBridgeListeners.delete(listener);
    };
  },
  actions: {
    fork: () => (typeof forkCurrentSession === "function" ? forkCurrentSession() : Promise.resolve()),
    share: () => (typeof shareCurrentSessionSnapshot === "function" ? shareCurrentSessionSnapshot() : Promise.resolve()),
    handoff: () => (typeof handoffCurrentSessionResult === "function" ? handoffCurrentSessionResult() : Promise.resolve()),
    setWorkflowAutoTriggerDisabled: (disabled) => setWorkflowAutoTriggerDisabledOnCurrentSession(disabled),
    workflowConclusionStatus: (conclusionId, status) => runChromeWorkflowConclusionAction(conclusionId, status),
    acceptWorkflowSuggestion: () => runChromeWorkflowSuggestionAction("accept"),
    dismissWorkflowSuggestion: () => runChromeWorkflowSuggestionAction("dismiss"),
    createParallelSessionsFromConclusion: (conclusionId) => createParallelSessionsFromConclusion(conclusionId),
  },
};

const WORKFLOW_APP_ALIASES = {
  execute: ["执行", "主交付", "功能交付"],
  verify: ["验收", "执行验收", "风险复核"],
  deliberate: ["再议", "深度裁决", "PR把关", "合并", "发布把关", "推敲"],
};

function normalizeWorkflowTaskText(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized || "";
}

function buildWorkflowTaskSessionName(appName, input) {
  const goal = normalizeWorkflowTaskText(input?.goal);
  if (!goal) return "";
  const compact = goal.replace(/\s+/gu, " ");
  const clipped = compact.length > 26 ? `${compact.slice(0, 26).trim()}…` : compact;
  return `${appName} · ${clipped}`;
}

function findWorkflowTaskAppByNames(names = []) {
  const candidates = Array.isArray(availableApps) ? availableApps : [];
  const normalizedNames = names
    .map((name) => normalizeWorkflowTaskText(name))
    .filter(Boolean);
  for (const name of normalizedNames) {
    const found = candidates.find((app) => normalizeWorkflowTaskText(app?.name) === name);
    if (found) return found;
  }
  return null;
}

function getWorkflowTaskSeedInput() {
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  const seed = {
    goal: "",
    project: "",
  };
  if (!session) return seed;
  const folder = normalizeWorkflowTaskText(session.folder || "");
  if (folder && folder !== "~") {
    seed.project = folder;
  }
  if (typeof getSessionDisplayName === "function") {
    const displayName = normalizeWorkflowTaskText(getSessionDisplayName(session));
    if (displayName && !/^chat$/iu.test(displayName)) {
      seed.goal = displayName;
    }
  }
  return seed;
}

async function ensureWorkflowTaskAppsLoaded() {
  if (Array.isArray(availableApps) && availableApps.length > 0) return availableApps;
  if (typeof fetchAppsList === "function") {
    await fetchAppsList();
  }
  return availableApps;
}

async function createWorkflowTaskSession({ input = {}, kickoffMessage = "", successToast = "" }) {
  const principal = typeof resolveSelectedSessionPrincipal === "function"
    ? resolveSelectedSessionPrincipal()
    : (typeof getAdminSessionPrincipal === "function" ? getAdminSessionPrincipal() : { kind: "admin" });
  const folder = normalizeWorkflowTaskText(input.project) || "~";
  const payload = {
    folder,
    tool: preferredTool || selectedTool || toolsList?.[0]?.id || DEFAULT_TOOL_ID,
    name: buildWorkflowTaskSessionName("任务", input),
    description: normalizeWorkflowTaskText(input.goal),
    sourceId: DEFAULT_APP_ID,
    sourceName: DEFAULT_APP_NAME,
    worktree: folder !== "~",
    ...(typeof buildSessionPrincipalPayload === "function" ? buildSessionPrincipalPayload(principal) : {}),
  };
  const created = await fetchJsonOrRedirect("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const session = upsertSession(created.session) || created.session;
  renderSessionList();
  attachSession(session.id, session);

  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      workflowCurrentTask: normalizeWorkflowTaskText(input.goal),
      kickoffMessage: normalizeWorkflowTaskText(kickoffMessage),
    }),
  });
  const updatedSession = upsertSession(data.session) || data.session || session;
  renderSessionList();
  attachSession(updatedSession.id, updatedSession);

  if (!isDesktop && typeof closeSidebarFn === "function") {
    closeSidebarFn();
  }
  if (successToast && typeof showAppToast === "function") {
    showAppToast(successToast, "success");
  }
  return {
    session: updatedSession,
    run: data?.run || null,
  };
}

async function classifyWorkflowTask({ text = "", folder = "" } = {}) {
  const normalizedText = normalizeWorkflowTaskText(text);
  if (!normalizedText) {
    return null;
  }
  const url = new URL("/api/workflow/classify", window.location.origin);
  url.searchParams.set("text", normalizedText);
  const normalizedFolder = normalizeWorkflowTaskText(folder);
  if (normalizedFolder) {
    url.searchParams.set("folder", normalizedFolder);
  }
  return fetchJsonOrRedirect(`${url.pathname}${url.search}`);
}

function canStartWorkflowOnAttachedSession(session) {
  if (!session || typeof session !== "object") return false;
  if (!session.id || session.visitorId || session.archived) return false;
  const runState = normalizeWorkflowTaskText(session?.activity?.run?.state);
  if (runState && runState !== "idle" && runState !== "completed" && runState !== "failed" && runState !== "cancelled") {
    return false;
  }
  return true;
}

async function startWorkflowOnAttachedSession({ input = {}, kickoffMessage = "", successToast = "" }) {
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  if (!canStartWorkflowOnAttachedSession(session)) {
    return null;
  }

  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      workflowCurrentTask: normalizeWorkflowTaskText(input.goal),
      kickoffMessage: normalizeWorkflowTaskText(kickoffMessage),
    }),
  });
  const updatedSession = upsertSession(data.session) || data.session;
  renderSessionList();
  attachSession(updatedSession.id, updatedSession);
  if (successToast && typeof showAppToast === "function") {
    showAppToast(successToast, "success");
  }
  return {
    session: updatedSession,
    run: data?.run || null,
  };
}

async function setWorkflowAutoTriggerDisabledOnCurrentSession(disabled = false) {
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  if (!session?.id || session.visitorId) {
    return null;
  }

  const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflowAutoTriggerDisabled: disabled === true,
    }),
  });
  const updatedSession = upsertSession(data.session) || data.session || session;
  renderSessionList();
  if (currentSessionId === updatedSession.id) {
    applyAttachedSessionState(updatedSession.id, updatedSession);
  }
  if (typeof showAppToast === "function") {
    showAppToast(disabled === true ? "已关闭自动提升" : "已开启自动提升", "success");
  }
  return updatedSession;
}

window.remotelabWorkflowBridge = {
  getSeedInput() {
    return getWorkflowTaskSeedInput();
  },
  ensureAppsLoaded() {
    return ensureWorkflowTaskAppsLoaded();
  },
  getAppAliases() {
    return {
      execute: [...WORKFLOW_APP_ALIASES.execute],
      verify: [...WORKFLOW_APP_ALIASES.verify],
      deliberate: [...WORKFLOW_APP_ALIASES.deliberate],
    };
  },
  classifyTask(options = {}) {
    return classifyWorkflowTask({
      text: normalizeWorkflowTaskText(options?.text),
      folder: normalizeWorkflowTaskText(options?.folder),
    });
  },
  async startTask(options = {}) {
    const reused = await startWorkflowOnAttachedSession({
      input: options.input && typeof options.input === "object" ? options.input : {},
      kickoffMessage: normalizeWorkflowTaskText(options.kickoffMessage),
      successToast: normalizeWorkflowTaskText(options.successToast),
    });
    if (reused?.session) {
      return reused;
    }
    return createWorkflowTaskSession({
      input: options.input && typeof options.input === "object" ? options.input : {},
      kickoffMessage: normalizeWorkflowTaskText(options.kickoffMessage),
      successToast: normalizeWorkflowTaskText(options.successToast),
    });
  },
};

refreshFrontendBtn?.addEventListener("click", () => {
  void reloadForFreshBuild(newerBuildInfo);
});

let ws = null;
let pendingImages = [];
const ACTIVE_SESSION_STORAGE_KEY = "activeSessionId";
const ACTIVE_SIDEBAR_TAB_STORAGE_KEY = "activeSidebarTab";
const LEGACY_ACTIVE_SOURCE_FILTER_STORAGE_KEY = "activeAppFilter";
const ACTIVE_SOURCE_FILTER_STORAGE_KEY = "activeSourceFilter";
const ACTIVE_SESSION_APP_FILTER_STORAGE_KEY = "activeSessionAppFilter";
const ACTIVE_USER_FILTER_STORAGE_KEY = "activeUserFilter";
const LEGACY_SESSION_SEND_FAILURES_STORAGE_KEY = "sessionSendFailures";
const SESSION_REVIEW_MARKERS_STORAGE_KEY = "sessionReviewedAtById";
const SESSION_REVIEW_BASELINE_AT_STORAGE_KEY = "sessionReviewBaselineAt";
const FILTER_ALL_VALUE = "__all__";
const SOURCE_FILTER_CHAT_VALUE = "chat_ui";
const SOURCE_FILTER_BOT_VALUE = "bot";
const SOURCE_FILTER_AUTOMATION_VALUE = "automation";
const ADMIN_USER_FILTER_VALUE = "user_admin";
const USER_FILTER_ALL_VALUE = "__all_users__";
const DEFAULT_APP_ID = "chat";
const BASIC_CHAT_APP_ID = "app_basic_chat";
const BASIC_CHAT_TEMPLATE_APP_ID = BASIC_CHAT_APP_ID;
const IMPORT_SESSION_TEMPLATE_APP_ID = "app_import_session";
const CREATE_APP_TEMPLATE_APP_ID = "app_create_app";
const DEFAULT_APP_NAME = "Chat";
const sessionStateModel = window.RemoteLabSessionStateModel;
if (!sessionStateModel) {
  throw new Error("RemoteLabSessionStateModel must load before bootstrap.js");
}

function normalizeSidebarTab(tab) {
  if (tab === "board" || tab === "progress") return "board";
  if (tab === "settings") return "settings";
  return "sessions";
}

function normalizeNavigationState(raw) {
  let sessionId = null;
  let tab = null;

  if (raw && typeof raw === "object") {
    if (typeof raw.sessionId === "string") sessionId = raw.sessionId;
    if (typeof raw.tab === "string") tab = raw.tab;
    if (raw.url) {
      try {
        const url = new URL(raw.url, window.location.origin);
        if (!sessionId) sessionId = url.searchParams.get("session") || null;
        if (!tab) tab = url.searchParams.get("tab") || null;
      } catch {}
    }
  }

  return {
    sessionId:
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.trim()
        : null,
    tab: tab ? normalizeSidebarTab(tab) : null,
  };
}

function readNavigationStateFromLocation() {
  return normalizeNavigationState({
    sessionId: new URLSearchParams(window.location.search).get("session"),
    tab: new URLSearchParams(window.location.search).get("tab"),
  });
}

let pendingNavigationState = readNavigationStateFromLocation();
let currentSessionId =
  pendingNavigationState.sessionId ||
  localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) ||
  null;
let hasAttachedSession = false;
let sessionStatus = "idle";
let reconnectTimer = null;
let sessions = [];
let sessionAppCatalog = [];
let availableApps = [];
let availableUsers = [];
let hasLoadedSessions = false;
let archivedSessionCount = 0;
let archivedSessionsLoaded = false;
let archivedSessionsLoading = false;
let archivedSessionsRefreshPromise = null;
let visitorMode = false;
let visitorSessionId = null;
let shareSnapshotMode = false;
let shareSnapshotPayload = bootstrapShareSnapshot;
let currentSessionRefreshPromise = null;
let pendingCurrentSessionRefresh = false;
let hasSeenWsOpen = false;
const sidebarSessionRefreshPromises = new Map();
const pendingSidebarSessionRefreshes = new Set();
const jsonResponseCache = new Map();
const eventBodyCache = new Map();
const eventBodyRequests = new Map();
const eventBlockCache = new Map();
const eventBlockRequests = new Map();
const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const renderedEventState = {
  sessionId: null,
  latestSeq: 0,
  eventCount: 0,
  eventBaseKeys: [],
  eventKeys: [],
  displayEvents: [],
  runState: "idle",
  runningBlockExpanded: false,
};

function setRunningEventBlockExpanded(sessionId, expanded) {
  if (!sessionId || renderedEventState.sessionId !== sessionId) return;
  renderedEventState.runningBlockExpanded = expanded === true;
}

function shouldUseVisitorRequests() {
  if (visitorMode) return true;
  try {
    return new URL(window.location.href).searchParams.get("visitor") === "1";
  } catch {
    return false;
  }
}

function withVisitorModeUrl(url) {
  const parsed = new URL(String(url || ""), window.location.href);
  if (shouldUseVisitorRequests()) {
    parsed.searchParams.set("visitor", "1");
  }
  if (parsed.origin === window.location.origin) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return parsed.toString();
}

let currentTokens = 0;

const DEFAULT_TOOL_ID = "codex";
const LEGACY_AUTO_PREFERRED_TOOL_IDS = new Set(["codex", "micro-agent"]);

function normalizeStoredToolId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function derivePreferredToolId(storedPreferredTool, storedLegacySelectedTool) {
  const preferred = normalizeStoredToolId(storedPreferredTool);
  const legacySelected = normalizeStoredToolId(storedLegacySelectedTool);
  if (preferred && !(LEGACY_AUTO_PREFERRED_TOOL_IDS.has(preferred) && !legacySelected)) {
    return preferred;
  }
  if (legacySelected) {
    return legacySelected;
  }
  return null;
}

const storedPreferredTool = normalizeStoredToolId(localStorage.getItem("preferredTool"));
const storedLegacySelectedTool = normalizeStoredToolId(localStorage.getItem("selectedTool"));

let preferredTool = derivePreferredToolId(storedPreferredTool, storedLegacySelectedTool);
let selectedTool = preferredTool;
// Default thinking to enabled; only disable if explicitly set to 'false'
let thinkingEnabled = localStorage.getItem("thinkingEnabled") !== "false";
// Model/effort are stored per-tool: "selectedModel_claude", "selectedModel_codex"
let selectedModel = null;
let selectedEffort = null;
let currentToolModels = []; // model list for current tool
let currentToolEffortLevels = null; // null = binary toggle, string[] = effort dropdown
let currentToolReasoningKind = "toggle";
let currentToolReasoningLabel = "Thinking";
let currentToolReasoningDefault = null;
let allToolsList = [];
let toolsList = [];
let isDesktop = window.matchMedia("(min-width: 768px)").matches;
const ADD_MORE_TOOL_VALUE = "__add_more__";
const COLLAPSED_GROUPS_STORAGE_KEY = "collapsedSessionGroups";
let isSavingToolConfig = false;
let collapsedFolders = JSON.parse(
  localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) ||
    localStorage.getItem("collapsedFolders") ||
    "{}",
);

try {
  localStorage.removeItem(LEGACY_SESSION_SEND_FAILURES_STORAGE_KEY);
} catch {}

let sessionReviewMarkers = readStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, {});
let sessionReviewBaselineAt = readStoredTimestampValue(SESSION_REVIEW_BASELINE_AT_STORAGE_KEY);
if (!sessionReviewBaselineAt) {
  sessionReviewBaselineAt = new Date().toISOString();
  writeStoredTimestampValue(SESSION_REVIEW_BASELINE_AT_STORAGE_KEY, sessionReviewBaselineAt);
}

function readStoredJsonValue(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJsonValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function normalizeStoredTimestamp(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  const time = new Date(trimmed).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function readStoredTimestampValue(key) {
  try {
    return normalizeStoredTimestamp(localStorage.getItem(key));
  } catch {
    return "";
  }
}

function writeStoredTimestampValue(key, value) {
  try {
    const normalized = normalizeStoredTimestamp(value);
    if (normalized) {
      localStorage.setItem(key, normalized);
    } else {
      localStorage.removeItem(key);
    }
  } catch {}
}

function getSessionReviewedAtTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSessionReviewBaselineAt() {
  return sessionReviewBaselineAt || "";
}

function getLocalSessionReviewedAt(sessionId) {
  if (!sessionId || !sessionReviewMarkers || typeof sessionReviewMarkers !== "object") return "";
  const normalized = normalizeStoredTimestamp(sessionReviewMarkers[sessionId]);
  if (normalized) return normalized;
  if (Object.prototype.hasOwnProperty.call(sessionReviewMarkers, sessionId)) {
    const next = { ...sessionReviewMarkers };
    delete next[sessionId];
    sessionReviewMarkers = next;
    writeStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, sessionReviewMarkers);
  }
  return "";
}

function setLocalSessionReviewedAt(sessionId, stamp) {
  if (!sessionId) return "";
  const normalized = normalizeStoredTimestamp(stamp);
  const current = getLocalSessionReviewedAt(sessionId);
  if (normalized) {
    if (getSessionReviewedAtTime(normalized) <= getSessionReviewedAtTime(current)) {
      return current;
    }
    sessionReviewMarkers = {
      ...sessionReviewMarkers,
      [sessionId]: normalized,
    };
    writeStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, sessionReviewMarkers);
  } else if (Object.prototype.hasOwnProperty.call(sessionReviewMarkers, sessionId)) {
    const next = { ...sessionReviewMarkers };
    delete next[sessionId];
    sessionReviewMarkers = next;
    writeStoredJsonValue(SESSION_REVIEW_MARKERS_STORAGE_KEY, sessionReviewMarkers);
  }

  const existing = sessions.find((session) => session.id === sessionId);
  if (existing) {
    if (normalized) {
      existing.localReviewedAt = normalized;
    } else {
      delete existing.localReviewedAt;
    }
  }

  return normalized || "";
}
