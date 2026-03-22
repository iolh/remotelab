function esc(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

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
  return "建议下一步";
}

function getWorkflowSuggestionBody(session, suggestion) {
  if (suggestion?.type === "suggest_verification") {
    const task = getWorkflowPanelCurrentTask(session);
    return task
      ? `“${task}”这轮实现已经完成，建议现在开启独立验收，单独核对测试、交互和边界。`
      : "这轮实现已经完成，建议现在开启独立验收，单独核对测试、交互和边界。";
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

async function updateWorkflowConclusionStatus(sessionId, conclusionId, status, button) {
  if (!sessionId || !conclusionId || !status) return;
  const buttons = button?.closest?.(".workflow-conclusion-actions")?.querySelectorAll?.("button") || [];
  for (const entry of buttons) {
    entry.disabled = true;
  }
  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(sessionId)}/conclusions/${encodeURIComponent(conclusionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (data?.session) {
      const updated = upsertSession(data.session) || data.session;
      if (updated && currentSessionId === updated.id) {
        applyAttachedSessionState(updated.id, updated);
      } else {
        renderSessionList();
      }
    } else if (currentSessionId === sessionId) {
      await refreshCurrentSession();
    }
  } catch (error) {
    console.warn("[workflow-summary] Failed to update conclusion status:", error.message);
  }
}

async function handleWorkflowSuggestionAction(session, action, button) {
  if (!session?.id || !action) return;
  const actions = button?.closest?.(".workflow-suggestion-actions")?.querySelectorAll?.("button") || [];
  for (const entry of actions) {
    entry.disabled = true;
  }
  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}/workflow-suggestion/${encodeURIComponent(action)}`, {
      method: "POST",
    });
    if (action === "accept" && data?.session) {
      if (data?.sourceSession) {
        upsertSession(data.sourceSession);
      }
      const created = upsertSession(data.session) || data.session;
      if (typeof showAppToast === "function") {
        showAppToast("已开启验收", "success");
      }
      attachSession(created.id, created);
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
  } catch (error) {
    if (typeof showAppToast === "function") {
      showAppToast(action === "accept" ? "开启验收失败" : "跳过建议失败", "error");
    }
    console.warn("[workflow-suggestion] Failed to process action:", error.message);
    for (const entry of actions) {
      entry.disabled = false;
    }
  }
}

function buildWorkflowSuggestionCard(session, suggestion) {
  const card = document.createElement("section");
  card.className = "workflow-summary-section workflow-suggestion-card";

  const heading = document.createElement("div");
  heading.className = "workflow-summary-heading";
  heading.textContent = getWorkflowSuggestionTitle(suggestion);
  card.appendChild(heading);

  const body = document.createElement("div");
  body.className = "workflow-suggestion-text";
  body.textContent = getWorkflowSuggestionBody(session, suggestion);
  card.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "workflow-suggestion-actions";

  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "workflow-conclusion-btn primary";
  acceptBtn.textContent = "开启验收";
  acceptBtn.addEventListener("click", () => {
    void handleWorkflowSuggestionAction(session, "accept", acceptBtn);
  });
  actions.appendChild(acceptBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "workflow-conclusion-btn";
  dismissBtn.textContent = "暂时跳过";
  dismissBtn.addEventListener("click", () => {
    void handleWorkflowSuggestionAction(session, "dismiss", dismissBtn);
  });
  actions.appendChild(dismissBtn);

  card.appendChild(actions);
  return card;
}

function openWorkflowSummaryModal() {
  if (!workflowSummaryModal || !workflowSummaryModalBody) return;
  if (!workflowSummaryModalBody.childElementCount) return;
  workflowSummaryModal.hidden = false;
}

function closeWorkflowSummaryModal() {
  if (!workflowSummaryModal) return;
  workflowSummaryModal.hidden = true;
}

function buildWorkflowSummaryDetails(session) {
  const wrap = document.createElement("div");
  wrap.className = "workflow-summary-grid";

  const pendingConclusions = getWorkflowConclusionsByStatus(session, ["pending"]);
  const decisionConclusions = getWorkflowConclusionsByStatus(session, ["needs_decision"]);
  const handledConclusions = getWorkflowConclusionsByStatus(session, ["accepted", "ignored"])
    .sort((left, right) => {
      const rightStamp = new Date(right?.handledAt || right?.createdAt || 0).getTime();
      const leftStamp = new Date(left?.handledAt || left?.createdAt || 0).getTime();
      return rightStamp - leftStamp;
    })
    .slice(0, 4);

  const taskSection = document.createElement("section");
  taskSection.className = "workflow-summary-section";
  const taskHeading = document.createElement("div");
  taskHeading.className = "workflow-summary-heading";
  taskHeading.textContent = "当前任务";
  const taskBody = document.createElement("div");
  taskBody.className = "workflow-summary-task";
  taskBody.textContent = getWorkflowPanelCurrentTask(session) || "暂未设置";
  taskSection.appendChild(taskHeading);
  taskSection.appendChild(taskBody);
  wrap.appendChild(taskSection);

  if (decisionConclusions.length > 0) {
    const decisionSection = document.createElement("section");
    decisionSection.className = "workflow-summary-section workflow-decision-brief";
    const decisionHeading = document.createElement("div");
    decisionHeading.className = "workflow-summary-heading";
    decisionHeading.textContent = "待我决策";
    decisionSection.appendChild(decisionHeading);

    const decisionText = document.createElement("div");
    decisionText.className = "workflow-decision-text";
    const pendingHint = pendingConclusions.length > 0
      ? `另外还有 ${pendingConclusions.length} 条待处理结论可稍后再看。`
      : "处理完这些后，主线就能更顺地继续往前推进。";
    decisionText.textContent = `现在有 ${decisionConclusions.length} 条结论在等你拍板。${pendingHint}`;
    decisionSection.appendChild(decisionText);
    const decisionList = document.createElement("div");
    decisionList.className = "workflow-decision-list";
    for (const conclusion of decisionConclusions.slice(0, 3)) {
      const item = document.createElement("div");
      item.className = "workflow-decision-item";
      const source = conclusion.sourceSessionName
        ? `来自 ${conclusion.sourceSessionName}`
        : "来自辅助会话";
      const confidence = getWorkflowDecisionConfidenceLabel(conclusion?.payload?.confidence || "");
      item.textContent = `${source}${confidence ? `（置信度：${confidence}）` : ""}：${conclusion.summary || "暂无摘要"}`;
      decisionList.appendChild(item);
    }
    decisionSection.appendChild(decisionList);
    wrap.appendChild(decisionSection);
  }
  const hasConclusionContent = pendingConclusions.length > 0 || decisionConclusions.length > 0 || handledConclusions.length > 0;
  if (hasConclusionContent) {
    const conclusionSection = document.createElement("section");
    conclusionSection.className = "workflow-summary-section";
    const conclusionHeading = document.createElement("div");
    conclusionHeading.className = "workflow-summary-heading";
    conclusionHeading.textContent = "主线吸收区";
    conclusionSection.appendChild(conclusionHeading);

    const renderConclusionGroup = (title, conclusions, { handled = false } = {}) => {
      if (!conclusions.length) return null;
      const group = document.createElement("div");
      group.className = "workflow-summary-subsection";

      const heading = document.createElement("div");
      heading.className = "workflow-summary-subheading";
      heading.textContent = title;
      group.appendChild(heading);

      const list = document.createElement("div");
      list.className = "workflow-conclusion-list";
      for (const conclusion of conclusions) {
        const item = document.createElement("div");
        item.className = "workflow-conclusion-item";

      const meta = document.createElement("div");
      meta.className = "workflow-conclusion-meta";

      const label = document.createElement("span");
      label.className = "workflow-conclusion-label";
      label.textContent = conclusion.label || getWorkflowConclusionTypeLabel(conclusion);

      const normalizedStatus = String(conclusion.status || "").trim();
      const status = document.createElement("span");
      status.className = `workflow-conclusion-status ${normalizedStatus || "pending"}`.trim();
      status.textContent = normalizeWorkflowConclusionStatusLabel(normalizedStatus);

      const source = document.createElement("span");
      source.className = "workflow-conclusion-source";
      source.textContent = conclusion.sourceSessionName
        ? `来自 ${conclusion.sourceSessionName}`
        : "来自辅助会话";

      meta.appendChild(label);
      meta.appendChild(status);
      meta.appendChild(source);

      const confidence = getWorkflowDecisionConfidenceLabel(conclusion?.payload?.confidence || "");
      if (confidence) {
        const confidenceNode = document.createElement("span");
        confidenceNode.className = "workflow-conclusion-confidence";
        confidenceNode.textContent = `置信度 ${confidence}`;
        meta.appendChild(confidenceNode);
      }

      const handledAt = handled ? formatWorkflowConclusionHandledAt(conclusion.handledAt || "") : "";
      if (handledAt) {
        const handledStamp = document.createElement("span");
        handledStamp.className = "workflow-conclusion-handled-at";
        handledStamp.textContent = `处理于 ${handledAt}`;
        meta.appendChild(handledStamp);
      }

      item.appendChild(meta);

      const summary = document.createElement("div");
      summary.className = "workflow-conclusion-summary";
      summary.textContent = conclusion.summary || "暂无摘要";
      item.appendChild(summary);

      const actions = document.createElement("div");
      actions.className = "workflow-conclusion-actions";
      const options = handled
        ? [
            { status: "pending", label: "改回待处理" },
            { status: "needs_decision", label: "改成待决策" },
          ]
        : [
            { status: "accepted", label: "已吸收" },
            { status: "needs_decision", label: "待决策" },
            { status: "ignored", label: "忽略" },
          ];
      for (const option of options) {
        const actionBtn = document.createElement("button");
        actionBtn.className = "workflow-conclusion-btn";
        actionBtn.type = "button";
        actionBtn.textContent = option.label;
        actionBtn.addEventListener("click", () => {
          void updateWorkflowConclusionStatus(session.id, conclusion.id, option.status, actionBtn);
        });
        actions.appendChild(actionBtn);
      }
        item.appendChild(actions);
        list.appendChild(item);
      }

      group.appendChild(list);
      return group;
    };

    const pendingGroup = renderConclusionGroup("待处理", pendingConclusions);
    const decisionGroup = renderConclusionGroup("待决策", decisionConclusions);
    const handledGroup = renderConclusionGroup("最近已处理", handledConclusions, {
      handled: true,
    });
    if (pendingGroup) conclusionSection.appendChild(pendingGroup);
    if (decisionGroup) conclusionSection.appendChild(decisionGroup);
    if (handledGroup) conclusionSection.appendChild(handledGroup);
    wrap.appendChild(conclusionSection);
  }
  return wrap;
}

function renderWorkflowSummaryPanel(session) {
  if (!workflowSummaryBtn) return;
  if (!session || !isWorkflowMainlineSession(session)) {
    workflowSummaryPanel.hidden = true;
    workflowSummaryPanel.innerHTML = "";
    workflowSummaryBtn.hidden = true;
    workflowSummaryBtn.classList.remove("has-notice");
    if (workflowSummaryModalBody) {
      workflowSummaryModalBody.innerHTML = "";
    }
    closeWorkflowSummaryModal();
    if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
    return;
  }

  const pendingConclusions = getWorkflowConclusionsByStatus(session, ["pending"]);
  const decisionConclusions = getWorkflowConclusionsByStatus(session, ["needs_decision"]);
  const suggestion = getActiveWorkflowSuggestion(session);
  workflowSummaryPanel.innerHTML = "";
  if (suggestion) {
    workflowSummaryPanel.hidden = false;
    workflowSummaryPanel.appendChild(buildWorkflowSuggestionCard(session, suggestion));
  } else {
    workflowSummaryPanel.hidden = true;
  }
  workflowSummaryBtn.hidden = false;
  workflowSummaryBtn.classList.toggle("has-notice", decisionConclusions.length > 0 || pendingConclusions.length > 0);
  const task = getWorkflowPanelCurrentTask(session) || "当前任务";
  const detail = decisionConclusions.length > 0
    ? `，${decisionConclusions.length} 条待决策`
    : (pendingConclusions.length > 0 ? `，${pendingConclusions.length} 条待处理` : "");
  workflowSummaryBtn.title = `摘要通知：${task}${detail}`;
  workflowSummaryBtn.setAttribute("aria-label", `摘要通知：${task}${detail}`);
  if (workflowSummaryModalBody) {
    workflowSummaryModalBody.innerHTML = "";
    workflowSummaryModalBody.appendChild(buildWorkflowSummaryDetails(session));
  }
  if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
}

workflowSummaryBtn?.addEventListener("click", openWorkflowSummaryModal);
closeWorkflowSummaryModalBtn?.addEventListener("click", closeWorkflowSummaryModal);
workflowSummaryModal?.addEventListener("click", (event) => {
  if (event.target === workflowSummaryModal) closeWorkflowSummaryModal();
});

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
  const reviewHtml = renderSessionStatusHtml(getSessionReviewStatusInfo(session));
  if (reviewHtml) parts.push(reviewHtml);
  const liveStatus = getSessionStatusSummary(session).primary;
  const statusHtml = liveStatus?.key && liveStatus.key !== "idle"
    ? renderSessionStatusHtml(liveStatus)
    : "";
  if (statusHtml) parts.push(statusHtml);
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
