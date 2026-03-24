function esc(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

const worktreeStatusInline = document.getElementById("worktreeStatusInline");
const worktreeStatusText = document.getElementById("worktreeStatusText");
const mergeWorktreeBtn = document.getElementById("mergeWorktreeBtn");
let mergeWorktreePending = false;

function getSessionWorktree(session) {
  const wt = session?.worktree;
  return wt && typeof wt === "object" ? wt : null;
}

function getWorktreeMergeButtonLabel(worktree) {
  const branch = typeof worktree?.branch === "string" ? worktree.branch.trim() : "";
  const baseRef = typeof worktree?.baseRef === "string" ? worktree.baseRef.trim() : "";
  if (branch && baseRef) return `合并 ${branch} → ${baseRef}`;
  return "合并到主分支";
}

function getWorktreeStatusLabel(worktree) {
  if (!worktree?.enabled) return "";
  if (worktree.status === "merged") {
    const baseRef = typeof worktree?.baseRef === "string" ? worktree.baseRef.trim() : "";
    return baseRef ? `已合并到 ${baseRef}` : "已合并";
  }
  if (worktree.status === "cleaned") return "已清理 worktree";
  return "";
}

function getWorktreeBranchShortLabel(branch) {
  const normalized = typeof branch === "string" ? branch.trim() : "";
  if (!normalized) return "";
  const short = normalized.includes("/") ? normalized.split("/").slice(1).join("/") : normalized;
  return short.length > 22 ? `${short.slice(0, 22)}…` : short;
}

function revealSessionGroup(group) {
  const normalized = typeof group === "string" ? group.trim() : "";
  if (!normalized) return;
  if (typeof collapsedFolders !== "undefined" && collapsedFolders && typeof collapsedFolders === "object") {
    collapsedFolders[`group:${normalized}`] = false;
    try {
      localStorage.setItem("collapsedFolders", JSON.stringify(collapsedFolders));
    } catch {}
  }
  if (typeof renderSessionList === "function") {
    renderSessionList();
  }
  if (typeof switchTab === "function") {
    switchTab("sessions");
  }
}

function buildWorktreeMergeToastMessage(result, session, didNavigate) {
  const coordination = result?.coordination && typeof result.coordination === "object" ? result.coordination : null;
  const baseRef = typeof result?.baseRef === "string" && result.baseRef.trim()
    ? result.baseRef.trim()
    : (typeof session?.worktree?.baseRef === "string" ? session.worktree.baseRef.trim() : "");
  const mergedLabel = baseRef ? `已合并到 ${baseRef}` : "已合并到主分支";

  if (coordination?.remainingActiveCount > 0) {
    const labels = Array.isArray(coordination.remainingActiveWorktrees)
      ? coordination.remainingActiveWorktrees
        .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
        .filter(Boolean)
      : [];
    const suffix = labels.length > 0
      ? `：${labels.slice(0, 2).join("、")}${labels.length > 2 ? " 等" : ""}`
      : "";
    return `${mergedLabel}，还有 ${coordination.remainingActiveCount} 个分支待合并${suffix}`;
  }

  if (coordination?.allMerged) {
    return didNavigate
      ? `${mergedLabel}，并行分支已全部收口 · 已跳转到主线`
      : `${mergedLabel}，并行分支已全部收口`;
  }

  return mergedLabel;
}

function renderSessionWorktreeMetaHtml(session) {
  const worktree = getSessionWorktree(session);
  if (!worktree?.enabled) return "";
  if (worktree.status === "active") {
    const branch = typeof worktree?.branch === "string" ? worktree.branch.trim() : "";
    const baseRef = typeof worktree?.baseRef === "string" ? worktree.baseRef.trim() : "";
    const shortBranch = getWorktreeBranchShortLabel(branch);
    if (!shortBranch) return "";
    const title = baseRef ? `独立分支：${branch} → ${baseRef}` : `独立分支：${branch}`;
    return `<span class="session-worktree-pill active" title="${esc(title)}">分支 ${esc(shortBranch)}</span>`;
  }
  if (worktree.status === "merged") {
    const baseRef = typeof worktree?.baseRef === "string" ? worktree.baseRef.trim() : "";
    const title = baseRef ? `已合并到 ${baseRef}` : "已合并";
    return `<span class="session-worktree-pill merged" title="${esc(title)}">已合并</span>`;
  }
  if (worktree.status === "cleaned") {
    return `<span class="session-worktree-pill cleaned" title="Worktree 已清理">已清理</span>`;
  }
  return "";
}

async function mergeCurrentSessionWorktree() {
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  const sessionId = typeof currentSessionId === "string" ? currentSessionId : "";
  const worktree = getSessionWorktree(session);
  if (!sessionId || !worktree?.enabled || worktree.status !== "active" || mergeWorktreePending) return;

  mergeWorktreePending = true;
  renderSessionWorktreePanel(session);
  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(sessionId)}/worktree/merge`, {
      method: "POST",
    });
    const updated = data?.session ? (upsertSession(data.session) || data.session) : null;
    const coordination = data?.coordination && typeof data.coordination === "object" ? data.coordination : null;
    renderSessionList();
    if (updated && currentSessionId === updated.id) {
      applyAttachedSessionState(updated.id, updated);
    } else if (currentSessionId === sessionId && typeof refreshCurrentSession === "function") {
      await refreshCurrentSession();
    }
    if (coordination?.remainingActiveCount > 0) {
      revealSessionGroup(typeof coordination.group === "string" ? coordination.group : "");
    }
    const targetSession = coordination?.allMerged && typeof coordination?.handoffTargetSessionId === "string" && coordination.handoffTargetSessionId
      ? sessions.find((s) => s.id === coordination.handoffTargetSessionId)
      : null;
    const didNavigate = !!(targetSession && typeof attachSession === "function");
    if (typeof showAppToast === "function") {
      showAppToast(buildWorktreeMergeToastMessage(data, updated || session, didNavigate), "success");
    }
    if (didNavigate) {
      attachSession(targetSession.id, targetSession);
    }
  } catch (error) {
    if (typeof showAppToast === "function") {
      showAppToast(error instanceof Error ? error.message : "合并失败", "error");
    }
  } finally {
    mergeWorktreePending = false;
    const latestSession = typeof getCurrentSession === "function" ? getCurrentSession() : session;
    renderSessionWorktreePanel(latestSession);
  }
}

function renderSessionWorktreePanel(session) {
  if (!worktreeStatusInline || !worktreeStatusText || !mergeWorktreeBtn) return;
  const worktree = getSessionWorktree(session);
  if (!worktree?.enabled) {
    worktreeStatusInline.hidden = true;
    worktreeStatusText.textContent = "";
    mergeWorktreeBtn.hidden = true;
    mergeWorktreeBtn.disabled = false;
    mergeWorktreeBtn.textContent = "";
    return;
  }

  worktreeStatusInline.hidden = false;
  const mergeLabel = getWorktreeMergeButtonLabel(worktree);
  mergeWorktreeBtn.title = mergeLabel;
  mergeWorktreeBtn.setAttribute("aria-label", mergeLabel);

  if (worktree.status === "active") {
    worktreeStatusText.textContent = "";
    mergeWorktreeBtn.hidden = false;
    mergeWorktreeBtn.disabled = mergeWorktreePending;
    mergeWorktreeBtn.textContent = mergeWorktreePending ? "合并中…" : mergeLabel;
    return;
  }

  worktreeStatusText.textContent = getWorktreeStatusLabel(worktree);
  mergeWorktreeBtn.hidden = true;
  mergeWorktreeBtn.disabled = false;
  mergeWorktreeBtn.textContent = mergeLabel;
}

mergeWorktreeBtn?.addEventListener("click", () => {
  mergeCurrentSessionWorktree().catch(() => {});
});

function getWorkflowPanelAppName(session) {
  const templateAppId = typeof getEffectiveSessionTemplateAppId === "function"
    ? getEffectiveSessionTemplateAppId(session)
    : "";
  const appEntry = templateAppId && typeof getSessionAppCatalogEntry === "function"
    ? getSessionAppCatalogEntry(templateAppId)
    : null;
  const appName = appEntry?.name || session?.templateAppName || session?.appName || "";
  return typeof appName === "string" ? appName.trim() : "";
}

function isWorkflowMainlineSession(session) {
  return ["执行", "主交付", "功能交付"].includes(getWorkflowPanelAppName(session));
}

const WORKFLOW_STAGE_ROLE_LABELS = {
  execute: "执行",
  verify: "验收",
  deliberate: "再议",
};

function getNormalizedWorkflowDefinition(session) {
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

function isWorkflowSessionActive(session) {
  return !!getNormalizedWorkflowDefinition(session)
    && String(session?.workflowState || "").trim() !== "done";
}

function getWorkflowStageBaseLabel(stage, index) {
  const explicit = typeof stage?.label === "string" ? stage.label.trim() : "";
  if (explicit) return explicit;
  const role = typeof stage?.role === "string" ? stage.role.trim().toLowerCase() : "";
  return WORKFLOW_STAGE_ROLE_LABELS[role] || `阶段 ${index + 1}`;
}

function getCurrentWorkflowStageLabel(session) {
  const definition = getNormalizedWorkflowDefinition(session);
  if (!definition || !isWorkflowSessionActive(session)) return "";
  const stage = definition.stages[definition.currentStageIndex] || null;
  if (!stage) return "";
  const baseLabel = getWorkflowStageBaseLabel(stage, definition.currentStageIndex);
  return /中$/u.test(baseLabel) ? baseLabel : `${baseLabel}中`;
}

function renderCurrentWorkflowStageHtml(session) {
  const label = getCurrentWorkflowStageLabel(session);
  if (!label) return "";
  return `<span class="session-workflow-stage-pill" title="当前 workflow 阶段">${esc(label)}</span>`;
}

function normalizeWorkflowConclusionStatusLabel(status) {
  if (status === "needs_decision") return "待决策";
  if (status === "accepted") return "已吸收";
  if (status === "ignored") return "已忽略";
  if (status === "superseded") return "已覆盖";
  return "待处理";
}

function getWorkflowConclusionTypeLabel(conclusion) {
  const type = typeof conclusion?.handoffType === "string" ? conclusion.handoffType.trim() : "";
  if (type === "verification_result") return "验收结果";
  if (type === "decision_result") return "再议结论";
  const legacyKind = typeof conclusion?.handoffKind === "string" ? conclusion.handoffKind.trim() : "";
  if (legacyKind === "risk_review") return "验收转交";
  if (legacyKind === "pr_gate") return "再议转交";
  return "结果转交";
}

function getWorkflowDecisionConfidenceLabel(confidence) {
  if (confidence === "high") return "高";
  if (confidence === "medium") return "中";
  if (confidence === "low") return "低";
  return "";
}

function getWorkflowPanelCurrentTask(session) {
  const explicit = typeof session?.workflowCurrentTask === "string" ? session.workflowCurrentTask.trim() : "";
  if (explicit) return explicit;
  const displayName = getSessionDisplayName(session);
  if (displayName) return displayName;
  const description = typeof session?.description === "string" ? session.description.trim() : "";
  if (description) return description;
  return "";
}

function getActiveWorkflowSuggestion(session) {
  const suggestion = session?.workflowSuggestion && typeof session.workflowSuggestion === "object"
    ? session.workflowSuggestion
    : null;
  if (!suggestion) return null;
  const type = typeof suggestion.type === "string" ? suggestion.type.trim() : "";
  const status = typeof suggestion.status === "string" ? suggestion.status.trim() : "";
  if (!type || status !== "pending") return null;
  return suggestion;
}

function getWorkflowSuggestionTitle(suggestion) {
  if (suggestion?.type === "suggest_verification") return "建议开启验收";
  if (suggestion?.type === "suggest_decision") return "建议开启再议";
  return "建议下一步";
}

function getWorkflowSuggestionBody(session, suggestion) {
  if (suggestion?.type === "suggest_verification") {
    const task = getWorkflowPanelCurrentTask(session);
    return task
      ? `“${task}”这轮实现已经完成，建议现在开启独立验收，单独核对测试、交互和边界。`
      : "这轮实现已经完成，建议现在开启独立验收，单独核对测试、交互和边界。";
  }
  if (suggestion?.type === "suggest_decision") {
    const task = getWorkflowPanelCurrentTask(session);
    return task
      ? `“${task}”当前进入再议阶段，建议现在开启独立再议，先收敛方案判断、tradeoff 和下一步方向。`
      : "当前进入再议阶段，建议现在开启独立再议，先收敛方案判断、tradeoff 和下一步方向。";
  }
  return "系统建议你进入下一步工作流。";
}

function getOpenWorkflowConclusions(session) {
  const entries = Array.isArray(session?.workflowPendingConclusions) ? session.workflowPendingConclusions : [];
  return entries.filter((entry) => ["pending", "needs_decision"].includes(String(entry?.status || "").trim()));
}

function getWorkflowConclusionsByStatus(session, statuses = []) {
  const allowed = new Set((Array.isArray(statuses) ? statuses : []).map((status) => String(status || "").trim()));
  const entries = Array.isArray(session?.workflowPendingConclusions) ? session.workflowPendingConclusions : [];
  return entries.filter((entry) => allowed.has(String(entry?.status || "").trim()));
}

function formatWorkflowConclusionHandledAt(stamp) {
  if (!stamp) return "";
  const parsed = new Date(stamp).getTime();
  if (!Number.isFinite(parsed)) return "";
  return messageTimeFormatter.format(parsed);
}

function renderWorkflowSummaryPanel(session) {
  if (!workflowSummaryBtn) return;
  if (!session || !isWorkflowMainlineSession(session)) {
    workflowSummaryBtn.hidden = true;
    workflowSummaryBtn.classList.remove("has-notice");
    if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
    return;
  }
  if (session.pendingIntake === true) {
    workflowSummaryBtn.hidden = true;
    workflowSummaryBtn.classList.remove("has-notice");
    if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
    return;
  }

  const pendingConclusions = getWorkflowConclusionsByStatus(session, ["pending"]);
  const decisionConclusions = getWorkflowConclusionsByStatus(session, ["needs_decision"]);
  workflowSummaryBtn.hidden = false;
  workflowSummaryBtn.classList.toggle("has-notice", decisionConclusions.length > 0 || pendingConclusions.length > 0);
  const task = getWorkflowPanelCurrentTask(session) || "当前任务";
  const detail = decisionConclusions.length > 0
    ? `，${decisionConclusions.length} 条待决策`
    : (pendingConclusions.length > 0 ? `，${pendingConclusions.length} 条待处理` : "");
  workflowSummaryBtn.title = `任务状态：${task}${detail}`;
  workflowSummaryBtn.setAttribute("aria-label", `任务状态：${task}${detail}`);
  if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
}

function getShortFolder(folder) {
  return (folder || "").replace(/^\/Users\/[^/]+/, "~");
}

function getFolderLabel(folder) {
  const shortFolder = getShortFolder(folder);
  return shortFolder.split("/").pop() || shortFolder || "Session";
}

function getSessionDisplayName(session) {
  return session?.name || getFolderLabel(session?.folder) || "Session";
}

function formatQueuedMessageTimestamp(stamp) {
  if (!stamp) return "Queued";
  const parsed = new Date(stamp).getTime();
  if (!Number.isFinite(parsed)) return "Queued";
  return `Queued ${messageTimeFormatter.format(parsed)}`;
}

function renderQueuedMessagePanel(session) {
  if (!queuedPanel) return;
  const items = Array.isArray(session?.queuedMessages) ? session.queuedMessages : [];
  if (!session?.id || session.id !== currentSessionId || items.length === 0) {
    queuedPanel.innerHTML = "";
    queuedPanel.classList.remove("visible");
    return;
  }

  queuedPanel.innerHTML = "";
  queuedPanel.classList.add("visible");

  const header = document.createElement("div");
  header.className = "queued-panel-header";

  const title = document.createElement("div");
  title.className = "queued-panel-title";
  title.textContent = items.length === 1 ? "1 follow-up queued" : `${items.length} follow-ups queued`;

  const note = document.createElement("div");
  note.className = "queued-panel-note";
  const activity = getSessionActivity(session);
  note.textContent = activity.run.state === "running" || activity.compact.state === "pending"
    ? "Will send automatically after the current run"
    : "Preparing the next turn";

  header.appendChild(title);
  header.appendChild(note);
  queuedPanel.appendChild(header);

  const list = document.createElement("div");
  list.className = "queued-list";
  const visibleItems = items.slice(-5);
  for (const item of visibleItems) {
    const row = document.createElement("div");
    row.className = "queued-item";

    const meta = document.createElement("div");
    meta.className = "queued-item-meta";
    meta.textContent = formatQueuedMessageTimestamp(item.queuedAt);

    const text = document.createElement("div");
    text.className = "queued-item-text";
    text.textContent = item.text || "(attachment)";

    row.appendChild(meta);
    row.appendChild(text);

    const imageNames = (item.images || []).map((image) => getAttachmentDisplayName(image)).filter(Boolean);
    if (imageNames.length > 0) {
      const imageLine = document.createElement("div");
      imageLine.className = "queued-item-images";
      imageLine.textContent = `Attachments: ${imageNames.join(", ")}`;
      row.appendChild(imageLine);
    }

    list.appendChild(row);
  }

  queuedPanel.appendChild(list);

  if (items.length > visibleItems.length) {
    const more = document.createElement("div");
    more.className = "queued-panel-more";
    more.textContent = `${items.length - visibleItems.length} older queued follow-up${items.length - visibleItems.length === 1 ? "" : "s"} hidden`;
    queuedPanel.appendChild(more);
  }
}

function renderSessionMessageCount(session) {
  const count = Number.isInteger(session?.messageCount)
    ? session.messageCount
    : (Number.isInteger(session?.activeMessageCount) ? session.activeMessageCount : 0);
  if (count <= 0) return "";
  const label = `${count} msg${count === 1 ? "" : "s"}`;
  return `<span class="session-item-count" title="Messages in this session">${label}</span>`;
}

function getSessionMetaStatusInfo(session) {
  const liveStatus = getSessionStatusSummary(session).primary;
  if (liveStatus?.key && liveStatus.key !== "idle") {
    return liveStatus;
  }
  const workflowStatus = typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.getWorkflowStatusInfo === "function"
    ? window.RemoteLabSessionStateModel.getWorkflowStatusInfo(session?.workflowState)
    : null;
  return workflowStatus || liveStatus;
}

function getSessionReviewStatusInfo(session) {
  return typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.getSessionReviewStatusInfo === "function"
    ? window.RemoteLabSessionStateModel.getSessionReviewStatusInfo(session)
    : null;
}

function isSessionCompleteAndReviewed(session) {
  return typeof window !== "undefined"
    && window.RemoteLabSessionStateModel
    && typeof window.RemoteLabSessionStateModel.isSessionCompleteAndReviewed === "function"
    ? window.RemoteLabSessionStateModel.isSessionCompleteAndReviewed(session)
    : false;
}

function buildSessionMetaParts(session) {
  const parts = [];
  const workflowStageHtml = renderCurrentWorkflowStageHtml(session);
  if (workflowStageHtml) parts.push(workflowStageHtml);
  const reviewHtml = renderSessionStatusHtml(getSessionReviewStatusInfo(session));
  if (reviewHtml) parts.push(reviewHtml);
  const liveStatus = getSessionStatusSummary(session).primary;
  const statusHtml = liveStatus?.key && liveStatus.key !== "idle"
    ? renderSessionStatusHtml(liveStatus)
    : "";
  if (statusHtml) parts.push(statusHtml);
  const worktreeHtml = renderSessionWorktreeMetaHtml(session);
  if (worktreeHtml) parts.push(worktreeHtml);
  const countHtml = renderSessionMessageCount(session);
  if (countHtml) parts.push(countHtml);
  return parts;
}

function buildBoardCardMetaParts(session) {
  const parts = [];
  parts.push(...renderSessionScopeContext(session));
  const reviewHtml = renderSessionStatusHtml(getSessionReviewStatusInfo(session));
  if (reviewHtml) parts.push(reviewHtml);
  const statusHtml = renderSessionStatusHtml(getSessionMetaStatusInfo(session));
  if (statusHtml) parts.push(statusHtml);
  const worktreeHtml = renderSessionWorktreeMetaHtml(session);
  if (worktreeHtml) parts.push(worktreeHtml);
  return parts;
}

function renderSessionScopeContext(session) {
  const parts = [];
  const sourceName = typeof getEffectiveSessionSourceName === "function"
    ? getEffectiveSessionSourceName(session)
    : "";
  if (sourceName) {
    parts.push(`<span title="Session source">${esc(sourceName)}</span>`);
  }

  const templateAppId = typeof getEffectiveSessionTemplateAppId === "function"
    ? getEffectiveSessionTemplateAppId(session)
    : "";
  if (templateAppId) {
    const appEntry = typeof getSessionAppCatalogEntry === "function"
      ? getSessionAppCatalogEntry(templateAppId)
      : null;
    const appName = appEntry?.name || session?.appName || "App";
    parts.push(`<span title="Session app">App: ${esc(appName)}</span>`);
  }

  if (session?.visitorId) {
    const visitorLabel = typeof session?.visitorName === "string" && session.visitorName.trim()
      ? `Visitor: ${session.visitorName.trim()}`
      : (session?.visitorId ? "Visitor" : "Owner");
    parts.push(`<span title="Session owner scope">${esc(visitorLabel)}</span>`);
  }

  return parts;
}

function getFilteredSessionEmptyText({ archived = false } = {}) {
  if (archived) return "No archived sessions";
  if (
    activeSourceFilter !== FILTER_ALL_VALUE
    || activeSessionAppFilter !== FILTER_ALL_VALUE
    || activeUserFilter !== ADMIN_USER_FILTER_VALUE
  ) {
    return "No sessions match the current filters";
  }
  return "No sessions yet";
}

function getSessionGroupInfo(session) {
  const group = typeof session?.group === "string" ? session.group.trim() : "";
  if (group) {
    return {
      key: `group:${group}`,
      label: group,
      title: group,
    };
  }

  const folder = session?.folder || "?";
  const shortFolder = getShortFolder(folder);
  return {
    key: `folder:${folder}`,
    label: getFolderLabel(folder),
    title: shortFolder,
  };
}

function renderSessionStatusHtml(statusInfo) {
  if (!statusInfo?.label) return "";
  const title = statusInfo.title ? ` title="${esc(statusInfo.title)}"` : "";
  if (!statusInfo.className) {
    return `<span${title}>${esc(statusInfo.label)}</span>`;
  }
  return `<span class="${statusInfo.className}"${title}>● ${esc(statusInfo.label)}</span>`;
}

function formatBoardTimestampValue(stamp) {
  const parsed = new Date(stamp || "").getTime();
  if (!Number.isFinite(parsed)) return "";
  return messageTimeFormatter.format(parsed);
}

function formatBoardSessionTimestamp(session) {
  const stamp = session?.lastEventAt || session?.updatedAt || session?.created || "";
  return formatBoardTimestampValue(stamp);
}

function renderBoardPriorityPill(priorityInfo) {
  if (!priorityInfo?.label) return "";
  const title = priorityInfo.title ? ` title="${esc(priorityInfo.title)}"` : "";
  const className = priorityInfo.className ? ` ${priorityInfo.className}` : "";
  return `<span class="board-priority-pill${className}"${title}>${esc(priorityInfo.label)}</span>`;
}

function createBoardSessionCard(session) {
  const priorityInfo = getSessionBoardPriority(session);
  const card = document.createElement("div");
  card.className = "board-card"
    + (priorityInfo?.className ? ` ${priorityInfo.className}` : "")
    + (session.id === currentSessionId ? " active" : "");

  const displayName = getSessionDisplayName(session);
  const metaParts = buildBoardCardMetaParts(session);

  const description = typeof session?.description === "string"
    ? session.description.trim()
    : "";
  const timestamp = formatBoardSessionTimestamp(session);

  card.innerHTML = `
    <div class="board-card-topline">
      ${renderBoardPriorityPill(priorityInfo)}
      ${timestamp ? `<div class="board-card-time">Updated ${esc(timestamp)}</div>` : ""}
    </div>
    <div class="board-card-title">${session.pinned ? `<span class="session-pin-badge" title="Pinned">${renderUiIcon("pinned")}</span>` : ""}${esc(displayName)}</div>
    ${metaParts.length > 0 ? `<div class="board-card-meta">${metaParts.join(" · ")}</div>` : ""}
    ${description ? `<div class="board-card-description">${esc(description)}</div>` : ""}`;

  card.addEventListener("click", () => {
    attachSession(session.id, session);
    if (!isDesktop) closeSidebarFn();
  });

  return card;
}

function createSessionBoardScroller(sessionList) {
  const scroller = document.createElement("div");
  scroller.className = "board-scroller";

  const visibleSessions = Array.isArray(sessionList) ? sessionList : [];
  const columns = getSessionBoardColumns(visibleSessions);
  const grouped = new Map(columns.map((column) => [column.key, {
    column,
    sessions: [],
  }]));

  for (const session of visibleSessions) {
    const boardColumn = getSessionBoardColumn(session, visibleSessions);
    const target = grouped.get(boardColumn.key) || grouped.get(columns[0]?.key);
    target?.sessions.push(session);
  }

  for (const { column, sessions: columnSessions } of grouped.values()) {
    columnSessions.sort(compareBoardSessions);
    const highPriorityCount = columnSessions.filter((session) => getSessionBoardPriority(session)?.key === "high").length;
    const columnEl = document.createElement("div");
    columnEl.className = "board-column";
    columnEl.dataset.column = column.key;

    const header = document.createElement("div");
    header.className = "board-column-header";
    header.innerHTML = `
      <span class="board-column-dot"></span>
      <span class="board-column-title" title="${esc(column.title || column.label)}">${esc(column.label)}</span>
      ${highPriorityCount > 0 ? `<span class="board-column-attention">${highPriorityCount} high</span>` : ""}
      <span class="board-column-count">${columnSessions.length}</span>`;

    const body = document.createElement("div");
    body.className = "board-column-body";
    if (columnSessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "board-card-empty";
      empty.textContent = column.emptyText || "No sessions";
      body.appendChild(empty);
    } else {
      for (const session of columnSessions) {
        body.appendChild(createBoardSessionCard(session));
      }
    }

    columnEl.appendChild(header);
    columnEl.appendChild(body);
    scroller.appendChild(columnEl);
  }

  return scroller;
}

function renderSessionBoard() {
  if (!boardPanel) return;
  boardPanel.innerHTML = "";
  const visibleSessions = getActiveSessions().filter((session) => matchesCurrentFilters(session));
  boardPanel.appendChild(createSessionBoardScroller(visibleSessions));
}

function createActiveSessionItem(session) {
  const statusInfo = getSessionMetaStatusInfo(session);
  const completeRead = isSessionCompleteAndReviewed(session);
  const div = document.createElement("div");
  div.className =
    "session-item"
    + (session.pinned ? " pinned" : "")
    + (session.id === currentSessionId ? " active" : "")
    + (completeRead ? " is-complete-read" : "")
    + (statusInfo.itemClass ? ` ${statusInfo.itemClass}` : "");

  const displayName = getSessionDisplayName(session);
  const metaParts = buildSessionMetaParts(session);
  const metaHtml = metaParts.join(" · ");
  const pinTitle = session.pinned ? "Unpin" : "Pin";

  div.innerHTML = `
    <div class="session-item-info">
      <div class="session-item-name">${session.pinned ? `<span class="session-pin-badge" title="Pinned">${renderUiIcon("pinned")}</span>` : ""}${esc(displayName)}</div>
      ${metaHtml ? `<div class="session-item-meta">${metaHtml}</div>` : ""}
    </div>
    <div class="session-item-actions">
      <button class="session-action-btn pin${session.pinned ? " pinned" : ""}" type="button" title="${pinTitle}" aria-label="${pinTitle}" data-id="${session.id}">${renderUiIcon(session.pinned ? "pinned" : "pin")}</button>
      <button class="session-action-btn rename" type="button" title="Rename" aria-label="Rename" data-id="${session.id}">${renderUiIcon("edit")}</button>
      <button class="session-action-btn archive" type="button" title="Archive" aria-label="Archive" data-id="${session.id}">${renderUiIcon("archive")}</button>
    </div>`;

  div.addEventListener("click", (e) => {
    if (e.target.closest(".session-action-btn")) {
      return;
    }
    attachSession(session.id, session);
    if (!isDesktop) closeSidebarFn();
  });

  div.querySelector(".pin").addEventListener("click", (e) => {
    e.stopPropagation();
    dispatchAction({ action: session.pinned ? "unpin" : "pin", sessionId: session.id });
  });

  div.querySelector(".rename").addEventListener("click", (e) => {
    e.stopPropagation();
    startRename(div, session);
  });

  div.querySelector(".archive").addEventListener("click", (e) => {
    e.stopPropagation();
    dispatchAction({ action: "archive", sessionId: session.id });
  });

  return div;
}
