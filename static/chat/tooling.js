// ---- Thinking toggle / effort select ----
let runtimeSelectionSyncPromise = Promise.resolve();
let lastSyncedRuntimeSelectionPayload = '';

function buildRuntimeSelectionPayload() {
  if (visitorMode || !selectedTool) return null;
  return {
    selectedTool,
    selectedModel: selectedModel || '',
    selectedEffort: currentToolReasoningKind === 'enum' ? (selectedEffort || '') : '',
    thinkingEnabled: currentToolReasoningKind === 'toggle' ? thinkingEnabled === true : false,
    reasoningKind: currentToolReasoningKind || 'none',
  };
}

function queueRuntimeSelectionSync() {
  const payload = buildRuntimeSelectionPayload();
  if (!payload) return;
  const serialized = JSON.stringify(payload);
  if (serialized === lastSyncedRuntimeSelectionPayload) {
    return;
  }
  lastSyncedRuntimeSelectionPayload = serialized;
  runtimeSelectionSyncPromise = runtimeSelectionSyncPromise
    .catch(() => {})
    .then(async () => {
      try {
        await fetchJsonOrRedirect('/api/runtime-selection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        });
      } catch (error) {
        lastSyncedRuntimeSelectionPayload = '';
        console.warn('[runtime-selection] Failed to sync current selection:', error.message);
      }
    });
}

function updateThinkingUI() {
  thinkingToggle.classList.toggle("active", thinkingEnabled);
}
updateThinkingUI();

function getAttachedSessionToolPreferences(toolId = selectedTool) {
  const session = getCurrentSession();
  if (!session || !toolId || session.tool !== toolId) return null;
  return {
    hasModel: Object.prototype.hasOwnProperty.call(session, "model"),
    model: typeof session.model === "string" ? session.model : "",
    hasEffort: Object.prototype.hasOwnProperty.call(session, "effort"),
    effort: typeof session.effort === "string" ? session.effort : "",
    hasThinking: Object.prototype.hasOwnProperty.call(session, "thinking"),
    thinking: session.thinking === true,
  };
}

function persistCurrentSessionToolPreferences() {
  if (visitorMode || !currentSessionId || !selectedTool) return;
  const payload = {
    action: "session_preferences",
    sessionId: currentSessionId,
    tool: selectedTool,
    model: selectedModel || "",
    effort: selectedEffort || "",
    thinking: currentToolReasoningKind === "toggle" ? thinkingEnabled : false,
  };
  dispatchAction(payload);
}

thinkingToggle.addEventListener("click", () => {
  thinkingEnabled = !thinkingEnabled;
  localStorage.setItem("thinkingEnabled", thinkingEnabled);
  updateThinkingUI();
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});

effortSelect.addEventListener("change", () => {
  selectedEffort = effortSelect.value;
  if (selectedTool) localStorage.setItem(`selectedEffort_${selectedTool}`, selectedEffort);
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});
// ---- Inline tool select ----
function slugifyToolValue(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "my-agent";
}

function getSelectedToolDefinition(toolId = selectedTool) {
  return toolsList.find((tool) => tool.id === toolId) || null;
}

function getPinnedDefaultModelId(toolId, models = []) {
  if (toolId !== "cursor") return "";
  const availableIds = new Set(
    models.map((model) => String(model?.id || "").trim()).filter(Boolean),
  );
  const preferredOrder = [
    "claude-4.6-opus-high-thinking",
    "claude-4.6-opus-high",
    "claude-4.6-opus-max-thinking",
    "claude-4.6-opus-max",
  ];
  return preferredOrder.find((id) => availableIds.has(id)) || "";
}

function updateModelQuickSwitchUi() {
}

function parseModelLines(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      const id = String(parts.shift() || "").trim();
      const label = String(parts.join("|") || id).trim() || id;
      return id ? { id, label } : null;
    })
    .filter(Boolean);
}

function parseReasoningLevels(raw) {
  return [...new Set(
    String(raw || "")
      .split(",")
      .map((level) => level.trim())
      .filter(Boolean),
  )];
}

function setAddToolStatus(message = "", tone = "") {
  if (!addToolStatus) return;
  addToolStatus.textContent = message;
  addToolStatus.className = `provider-helper-status${tone ? ` ${tone}` : ""}`;
}

function syncQuickAddControls() {
  const family = addToolRuntimeFamilySelect?.value || "claude-stream-json";
  const allowedKinds = family === "codex-json" ? ["enum", "none"] : ["toggle", "none"];

  for (const opt of addToolReasoningKindSelect.options) {
    const allowed = allowedKinds.includes(opt.value);
    opt.disabled = !allowed;
    opt.hidden = !allowed;
  }
  if (!allowedKinds.includes(addToolReasoningKindSelect.value)) {
    addToolReasoningKindSelect.value = allowedKinds[0];
  }

  const showLevels = addToolReasoningKindSelect.value === "enum";
  const levelsField = addToolReasoningLevelsInput.closest(".provider-helper-field");
  addToolReasoningLevelsInput.disabled = !showLevels;
  if (levelsField) levelsField.style.opacity = showLevels ? "1" : "0.55";
  if (family === "codex-json" && !addToolReasoningLevelsInput.value.trim()) {
    addToolReasoningLevelsInput.value = "low, medium, high, xhigh";
  }
}

function getAddToolDraft() {
  const name = (addToolNameInput?.value || "").trim() || "My Agent";
  const command = (addToolCommandInput?.value || "").trim() || "my-agent";
  const runtimeFamily =
    addToolRuntimeFamilySelect?.value || "claude-stream-json";
  const models = parseModelLines(addToolModelsInput?.value || "");
  const reasoningKind = addToolReasoningKindSelect?.value || "toggle";
  const reasoning = { kind: reasoningKind, label: "Thinking" };
  if (reasoningKind === "enum") {
    reasoning.levels = parseReasoningLevels(addToolReasoningLevelsInput?.value || "")
      .length > 0
      ? parseReasoningLevels(addToolReasoningLevelsInput?.value || "")
      : ["low", "medium", "high", "xhigh"];
    reasoning.default = reasoning.levels[0];
  }

  return {
    name,
    command,
    runtimeFamily,
    commandSlug: slugifyToolValue(command),
    models,
    reasoning,
  };
}

function buildProviderBasePrompt() {
  const draft = getAddToolDraft();
  const modelLines = draft.models.length > 0
    ? draft.models.map((model) => `- ${model.id}${model.label !== model.id ? ` | ${model.label}` : ""}`).join("\n")
    : "- none configured yet";
  const reasoningLine = draft.reasoning.kind === "enum"
    ? `${draft.reasoning.kind} (${draft.reasoning.levels.join(", ")})`
    : draft.reasoning.kind;
  return [
    `I want to add a new agent/provider to RemoteLab.`,
    ``,
    `Target tool`,
    `- Name: ${draft.name}`,
    `- Command: ${draft.command}`,
    `- Derived ID / slug: ${draft.commandSlug}`,
    `- Runtime family: ${draft.runtimeFamily}`,
    `- Reasoning mode: ${reasoningLine}`,
    `- Models:`,
    modelLines,
    ``,
    `Work in the RemoteLab repo root (usually \`~/code/remotelab\`; adjust if your checkout lives elsewhere).`,
    `Read \`AGENTS.md\` (legacy \`CLAUDE.md\` is only a compatibility shim) and \`notes/directional/provider-architecture.md\` first.`,
    ``,
    `Please:`,
    `1. Decide whether this can stay a simple provider bound to an existing runtime family or needs full provider code.`,
    `2. If simple config is enough, explain the minimal runtimeFamily/models/reasoning config that should be saved.`,
    `3. If the command is not compatible with the runtime family's normal CLI flags, implement the minimal arg-mapping/provider code needed to make it work.`,
    `4. If full provider support is needed (models, thinking, runtime, parser, resume handling), implement the minimal code changes in the repo.`,
    `5. Keep changes surgical, update docs if needed, and validate the flow end-to-end.`,
    ``,
    `Do not stop at planning — apply the changes if they are clear.`,
  ].join("\n");
}

function updateCopyButtonLabel(button, label) {
  if (!button) return;
  if (button.classList.contains("header-btn")) {
    const originalTitle = button.dataset.originalTitle || button.getAttribute("title") || "";
    const originalAriaLabel = button.dataset.originalAriaLabel || button.getAttribute("aria-label") || "";
    button.dataset.originalTitle = originalTitle;
    button.dataset.originalAriaLabel = originalAriaLabel;
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);
    button.classList.add("is-feedback");
    window.clearTimeout(button._copyResetTimer);
    button._copyResetTimer = window.setTimeout(() => {
      button.setAttribute("title", button.dataset.originalTitle || originalTitle);
      button.setAttribute("aria-label", button.dataset.originalAriaLabel || originalAriaLabel);
      button.classList.remove("is-feedback");
    }, 1400);
    return;
  }
  const original = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = original;
  button.textContent = label;
  window.clearTimeout(button._copyResetTimer);
  button._copyResetTimer = window.setTimeout(() => {
    button.textContent = button.dataset.originalLabel || original;
  }, 1400);
}

function resetHeaderActionButton(button) {
  if (!button) return;
  button.disabled = false;
  window.clearTimeout(button._copyResetTimer);
  if (button.classList.contains("header-btn")) {
    if (button.dataset.originalTitle) {
      button.setAttribute("title", button.dataset.originalTitle);
    }
    if (button.dataset.originalAriaLabel) {
      button.setAttribute("aria-label", button.dataset.originalAriaLabel);
    }
    button.classList.remove("is-feedback");
    return;
  }
  if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
}

function showAppToast(message, tone = "neutral", options = undefined) {
  if (!message || !window.remotelabToastBridge?.show) return;
  const mappedType = ["success", "error"].includes(tone) ? tone : "neutral";
  window.remotelabToastBridge.show(message, mappedType, options);
}

function setHeaderActionBusy(button, label) {
  if (!button) return;
  button.disabled = true;
  if (button.classList.contains("header-btn")) {
    const originalTitle = button.dataset.originalTitle || button.getAttribute("title") || "";
    const originalAriaLabel = button.dataset.originalAriaLabel || button.getAttribute("aria-label") || "";
    button.dataset.originalTitle = originalTitle;
    button.dataset.originalAriaLabel = originalAriaLabel;
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);
    button.classList.add("is-feedback");
    return;
  }
  const original = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = original;
  button.textContent = label;
}

function getWorkflowSessionAppName(session) {
  const templateAppId = typeof getEffectiveSessionTemplateAppId === "function"
    ? getEffectiveSessionTemplateAppId(session)
    : "";
  const appEntry = templateAppId && typeof getSessionAppCatalogEntry === "function"
    ? getSessionAppCatalogEntry(templateAppId)
    : null;
  const appName = appEntry?.name || session?.templateAppName || session?.appName || "";
  return typeof appName === "string" ? appName.trim() : "";
}

function isMainlineWorkflowSession(session) {
  return ["执行", "主交付", "功能交付"].includes(getWorkflowSessionAppName(session));
}

function isHandoffSourceWorkflowSession(session) {
  return [
    "验收",
    "再议",
    "风险复核",
    "PR把关",
    "挑战",
    "合并",
    "发布把关",
    "后台挑战",
  ].includes(getWorkflowSessionAppName(session));
}

function findSessionById(sessionId) {
  return getActiveSessions().find((session) => session.id === sessionId) || null;
}

function getHandoffCandidates(sourceSession) {
  const active = getActiveSessions().filter((session) => (
    session?.id
    && session.id !== sourceSession?.id
    && !session.archived
    && !session.visitorId
  ));
  const mainline = active.filter((session) => isMainlineWorkflowSession(session));
  const candidates = (mainline.length > 0 ? mainline : active).slice();
  const sourceFolder = typeof sourceSession?.folder === "string" ? sourceSession.folder : "";
  candidates.sort((a, b) => {
    const aSameFolder = sourceFolder && a.folder === sourceFolder ? 1 : 0;
    const bSameFolder = sourceFolder && b.folder === sourceFolder ? 1 : 0;
    return (
      bSameFolder - aSameFolder
      || (typeof getSessionSortTime === "function" ? getSessionSortTime(b) - getSessionSortTime(a) : 0)
    );
  });
  return candidates;
}

function formatHandoffCandidate(session) {
  const name = typeof getSessionDisplayName === "function"
    ? getSessionDisplayName(session)
    : (session?.name || "Session");
  const appName = getWorkflowSessionAppName(session);
  const folder = typeof getShortFolder === "function"
    ? getShortFolder(session?.folder || "")
    : (session?.folder || "");
  return [name, appName, folder].filter(Boolean).join(" · ");
}

function selectHandoffTargetSession(sourceSession) {
  const candidates = getHandoffCandidates(sourceSession);
  if (candidates.length === 0) {
    throw new Error("还没有可转交的执行会话");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const lines = candidates.slice(0, 12).map((session, index) => `${index + 1}. ${formatHandoffCandidate(session)}`);
  const answer = window.prompt(
    `选择要转交到的执行会话：\n\n${lines.join("\n")}\n\n输入序号`,
    "1",
  );
  if (answer === null) {
    return null;
  }
  const index = Number.parseInt(String(answer).trim(), 10);
  if (!Number.isInteger(index) || index < 1 || index > lines.length) {
    throw new Error("请输入有效序号");
  }
  return candidates[index - 1];
}

function syncHandoffButton() {
  if (!handoffSessionBtn) return;
  const session = getCurrentSession();
  const activity = getSessionActivity(session);
  const hasContent = Number(session?.userMessageCount || 0) > 0;
  const visible = !visitorMode
    && !!currentSessionId
    && !!session
    && !session.archived
    && hasContent
    && (isHandoffSourceWorkflowSession(session) || !!session?.handoffTargetSessionId);
  handoffSessionBtn.hidden = !visible;
  if (!visible) {
    resetHeaderActionButton(handoffSessionBtn);
    if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
    return;
  }
  handoffSessionBtn.disabled = !session || activity.run.state === "running" || activity.compact.state === "pending";
  if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
}

function syncShareButton() {
  if (!shareSnapshotBtn) return;
  const session = getCurrentSession();
  const hasContent = Number(session?.userMessageCount || 0) > 0;
  const visible = !visitorMode
    && !!currentSessionId
    && !!session
    && !session.archived
    && hasContent;
  shareSnapshotBtn.hidden = !visible;
  if (!visible) {
    resetHeaderActionButton(shareSnapshotBtn);
  }
  if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
}

function syncForkButton() {
  if (!forkSessionBtn) return;
  const session = getCurrentSession();
  const hasContent = Number(session?.userMessageCount || 0) > 0;
  const visible = !visitorMode
    && !!currentSessionId
    && !!session
    && !session.archived
    && hasContent;
  forkSessionBtn.hidden = !visible;
  if (!visible) {
    resetHeaderActionButton(forkSessionBtn);
    syncHandoffButton();
    if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
    return;
  }
  const activity = getSessionActivity(session);
  forkSessionBtn.disabled = !session || activity.run.state === "running" || activity.compact.state === "pending";
  syncHandoffButton();
  if (typeof emitChromeBridgeState === "function") emitChromeBridgeState();
}

function buildShareSnapshotShareText(shareUrl) {
  return typeof shareUrl === "string" ? shareUrl.trim() : "";
}

async function shareCurrentSessionSnapshot() {
  if (!currentSessionId || visitorMode || !shareSnapshotBtn) return;

  shareSnapshotBtn.disabled = true;

  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(currentSessionId)}/share`, {
      method: "POST",
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {}

    const shareUrl = payload?.share?.url
      ? new URL(payload.share.url, location.origin).toString()
      : null;
    const shareText = buildShareSnapshotShareText(shareUrl);

    if (!res.ok || !shareUrl) {
      throw new Error(payload?.error || "Failed to create share link");
    }

    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        showAppToast("已分享", "success", {
          position: "top-center",
          className: "remotelab-top-notice-toast",
        });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }

    try {
      await copyText(shareText);
      showAppToast("分享链接已复制", "success", {
        position: "top-center",
        className: "remotelab-top-notice-toast",
      });
    } catch {
      window.prompt("Copy share link", shareText);
      showAppToast("已准备分享链接", "neutral", {
        position: "top-center",
        className: "remotelab-top-notice-toast",
      });
    }
  } catch (err) {
    console.warn("[share] Failed to create snapshot:", err.message);
    showAppToast("分享失败", "error", {
      position: "top-center",
      className: "remotelab-top-notice-toast",
    });
  } finally {
    shareSnapshotBtn.disabled = false;
    syncShareButton();
  }
}

async function forkCurrentSession() {
  if (!currentSessionId || visitorMode || !forkSessionBtn) return;

  setHeaderActionBusy(forkSessionBtn, "Forking…");

  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSessionId)}/fork`, {
      method: "POST",
    });
    if (data.session) {
      showAppToast("已 Fork 当前会话", "success", {
        position: "top-center",
        className: "remotelab-top-notice-toast",
      });
      upsertSession(data.session);
      renderSessionList();
    } else {
      showAppToast("Fork 失败", "error", {
        position: "top-center",
        className: "remotelab-top-notice-toast",
      });
    }
  } catch (err) {
    console.warn("[fork] Failed to fork session:", err.message);
    showAppToast("Fork 失败", "error", {
      position: "top-center",
      className: "remotelab-top-notice-toast",
    });
  } finally {
    syncForkButton();
  }
}

async function handoffCurrentSessionResult() {
  if (!currentSessionId || visitorMode || !handoffSessionBtn) return;
  const sourceSession = getCurrentSession();
  if (!sourceSession) return;

  let targetSession = null;
  const rememberedTarget = typeof sourceSession?.handoffTargetSessionId === "string"
    ? sourceSession.handoffTargetSessionId.trim()
    : "";
  if (rememberedTarget) {
    targetSession = findSessionById(rememberedTarget);
  }
  if (!targetSession) {
    targetSession = selectHandoffTargetSession(sourceSession);
    if (!targetSession) return;
  }

  setHeaderActionBusy(handoffSessionBtn, "转交中…");

  try {
    const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSessionId)}/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetSessionId: targetSession.id }),
    });
    if (data?.sourceSession) {
      upsertSession(data.sourceSession);
    }
    if (data?.session) {
      upsertSession(data.session);
      renderSessionList();
      showAppToast("已转交", "success");
    } else {
      showAppToast("转交失败", "error");
    }
  } catch (error) {
    console.warn("[handoff] Failed to hand off session result:", error.message);
    showAppToast("转交失败", "error");
  } finally {
    syncHandoffButton();
  }
}

function syncAddToolModal() {
  if (!providerPromptCode) return;
  syncQuickAddControls();
  providerPromptCode.textContent = buildProviderBasePrompt();
}

function openAddToolModal() {
  if (!addToolModal) return;
  if (!addToolNameInput.value.trim()) addToolNameInput.value = "My Agent";
  if (!addToolCommandInput.value.trim()) {
    addToolCommandInput.value = "my-agent";
  }
  const selectedToolDef = getSelectedToolDefinition();
  if (selectedToolDef?.runtimeFamily) {
    addToolRuntimeFamilySelect.value = selectedToolDef.runtimeFamily;
  }
  setAddToolStatus("");
  syncAddToolModal();
  addToolModal.hidden = false;
  addToolNameInput.focus();
  addToolNameInput.select();
}

function closeAddToolModal() {
  if (!addToolModal) return;
  addToolModal.hidden = true;
}

async function saveSimpleToolConfig() {
  if (isSavingToolConfig) return;
  const draft = getAddToolDraft();

  if (!draft.command) {
    setAddToolStatus("Command is required.", "error");
    addToolCommandInput.focus();
    return;
  }

  isSavingToolConfig = true;
  saveToolConfigBtn.disabled = true;
  setAddToolStatus("Saving and refreshing picker...");

  try {
    const data = await fetchJsonOrRedirect("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });

    const savedTool = data.tool;
    if (savedTool?.id) {
      selectedTool = savedTool.id;
      preferredTool = savedTool.id;
      localStorage.setItem("preferredTool", preferredTool);
      localStorage.setItem("selectedTool", selectedTool);
    }

    await loadInlineTools({ skipModelLoad: true });
    if (selectedTool) {
      await loadModelsForCurrentTool({ refresh: true });
    }

    if (savedTool?.available) {
      setAddToolStatus("Saved. The new agent is ready in the picker.", "success");
      closeAddToolModal();
    } else {
      setAddToolStatus(
        "Saved, but the command is not currently available on PATH, so it will stay hidden until the binary is available.",
        "error",
      );
    }
  } catch (err) {
    setAddToolStatus(err.message || "Failed to save tool config", "error");
  } finally {
    isSavingToolConfig = false;
    saveToolConfigBtn.disabled = false;
    syncAddToolModal();
  }
}

function renderInlineToolOptions(selectedValue, emptyMessage = "No agents found") {
  inlineToolSelect.disabled = visitorMode;
  inlineToolSelect.innerHTML = "";

  if (toolsList.length === 0) {
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = emptyMessage;
    emptyOpt.disabled = true;
    emptyOpt.selected = true;
    inlineToolSelect.appendChild(emptyOpt);
  } else {
    for (const tool of toolsList) {
      const opt = document.createElement("option");
      opt.value = tool.id;
      opt.textContent = tool.name;
      inlineToolSelect.appendChild(opt);
    }
  }

  const addMoreOpt = document.createElement("option");
  addMoreOpt.value = ADD_MORE_TOOL_VALUE;
  addMoreOpt.textContent = "+ Add more...";
  inlineToolSelect.appendChild(addMoreOpt);

  if (selectedValue && toolsList.some((tool) => tool.id === selectedValue)) {
    inlineToolSelect.value = selectedValue;
  } else if (toolsList[0]) {
    inlineToolSelect.value = toolsList[0].id;
  }
}

function getVisiblePrimaryToolOptions(keepToolIds = []) {
  const allKeepIds = [
    ...(Array.isArray(keepToolIds) ? keepToolIds : [keepToolIds]),
    selectedTool,
    preferredTool,
  ];
  return prioritizeToolOptions(
    filterPrimaryToolOptions(
      (Array.isArray(allToolsList) ? allToolsList : []).filter((tool) => tool?.available),
      { keepIds: allKeepIds },
    ),
  );
}

function refreshPrimaryToolPicker({ keepToolIds = [], selectedValue = "" } = {}) {
  toolsList = getVisiblePrimaryToolOptions(keepToolIds);
  const resolvedTool = resolvePreferredToolId(toolsList, [
    selectedValue,
    ...(Array.isArray(keepToolIds) ? keepToolIds : [keepToolIds]),
    selectedTool,
    preferredTool,
  ]);
  renderInlineToolOptions(resolvedTool);
  return resolvedTool;
}

const modelResponseCache = new Map();
const pendingModelResponseRequests = new Map();

async function fetchModelResponse(toolId, { refresh = false } = {}) {
  if (!toolId) {
    return {
      models: [],
      effortLevels: null,
      defaultModel: null,
      reasoning: { kind: "none", label: "Thinking" },
    };
  }

  if (!refresh && modelResponseCache.has(toolId)) {
    return modelResponseCache.get(toolId);
  }

  if (!refresh && pendingModelResponseRequests.has(toolId)) {
    return pendingModelResponseRequests.get(toolId);
  }

  const request = fetchJsonOrRedirect(`/api/models?tool=${encodeURIComponent(toolId)}`, {
    revalidate: !refresh,
  })
    .then((data) => {
      modelResponseCache.set(toolId, data);
      return data;
    })
    .finally(() => {
      pendingModelResponseRequests.delete(toolId);
    });

  pendingModelResponseRequests.set(toolId, request);
  return request;
}

async function loadInlineTools({ skipModelLoad = false } = {}) {
  if (visitorMode) {
    allToolsList = [];
    toolsList = [];
    selectedTool = null;
    selectedModel = null;
    selectedEffort = null;
    return;
  }
  try {
    const data = await fetchJsonOrRedirect("/api/tools");
    allToolsList = Array.isArray(data.tools) ? data.tools : [];
    const initialTool = refreshPrimaryToolPicker();
    if (initialTool) {
      selectedTool = initialTool;
      if (!preferredTool) {
        preferredTool = initialTool;
        localStorage.setItem("preferredTool", preferredTool);
      }
    }
    if (!skipModelLoad) {
      await loadModelsForCurrentTool();
    }
    if (typeof renderAppToolSelectOptions === "function") {
      renderAppToolSelectOptions(newAppToolSelect, newAppToolSelect?.value || selectedTool || initialTool || "");
    }
    if (typeof renderSettingsAppsPanel === "function") {
      renderSettingsAppsPanel();
    }
  } catch (err) {
    allToolsList = [];
    toolsList = [];
    console.warn("[tools] Failed to load tools:", err.message);
    renderInlineToolOptions("", "Failed to load agents");
    if (typeof renderAppToolSelectOptions === "function") {
      renderAppToolSelectOptions(newAppToolSelect, newAppToolSelect?.value || "");
    }
  }
}

inlineToolSelect.addEventListener("change", async () => {
  const nextTool = inlineToolSelect.value;
  if (nextTool === ADD_MORE_TOOL_VALUE) {
    renderInlineToolOptions(resolvePreferredToolId(toolsList, [selectedTool, preferredTool]));
    openAddToolModal();
    return;
  }

  selectedTool = nextTool;
  preferredTool = selectedTool;
  localStorage.setItem("preferredTool", preferredTool);
  localStorage.setItem("selectedTool", selectedTool);
  await loadModelsForCurrentTool();
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});

// ---- Model select ----
async function loadModelsForCurrentTool({ refresh = false } = {}) {
  if (visitorMode) {
    currentToolModels = [];
    currentToolEffortLevels = null;
    currentToolReasoningKind = "none";
    currentToolReasoningLabel = "Thinking";
    currentToolReasoningDefault = null;
    selectedModel = null;
    selectedEffort = null;
    inlineModelSelect.innerHTML = "";
    inlineModelSelect.style.display = "none";
    thinkingToggle.style.display = "none";
    effortSelect.style.display = "none";
    updateModelQuickSwitchUi();
    return;
  }
  const toolId = selectedTool;
  if (!selectedTool) {
    currentToolModels = [];
    currentToolEffortLevels = null;
    currentToolReasoningKind = "none";
    currentToolReasoningLabel = "Thinking";
    currentToolReasoningDefault = null;
    selectedModel = null;
    selectedEffort = null;
    inlineModelSelect.innerHTML = "";
    inlineModelSelect.style.display = "none";
    thinkingToggle.style.display = "none";
    effortSelect.style.display = "none";
    updateModelQuickSwitchUi();
    return;
  }
  try {
    const sessionPreferences = getAttachedSessionToolPreferences(toolId);
    const data = await fetchModelResponse(toolId, { refresh });
    if (selectedTool !== toolId) return;
    currentToolModels = data.models || [];
    currentToolReasoningKind =
      data.reasoning?.kind || (data.effortLevels ? "enum" : "toggle");
    currentToolReasoningLabel = data.reasoning?.label || "Thinking";
    currentToolReasoningDefault = data.reasoning?.default || null;
    currentToolEffortLevels =
      currentToolReasoningKind === "enum"
        ? data.reasoning?.levels || data.effortLevels || []
        : null;
    thinkingToggle.textContent = currentToolReasoningLabel;

    // Populate model dropdown
    inlineModelSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "default";
    inlineModelSelect.appendChild(defaultOpt);
    for (const m of currentToolModels) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      inlineModelSelect.appendChild(opt);
    }
    // Restore saved model for this tool
    const savedModel = localStorage.getItem(`selectedModel_${toolId}`) || "";
    const defaultModel = data.defaultModel || "";
    const pinnedDefaultModel = getPinnedDefaultModelId(toolId, currentToolModels);
    selectedModel = sessionPreferences?.hasModel ? sessionPreferences.model : savedModel;
    if (selectedModel && currentToolModels.some((m) => m.id === selectedModel)) {
      inlineModelSelect.value = selectedModel;
    } else if (pinnedDefaultModel && currentToolModels.some((m) => m.id === pinnedDefaultModel)) {
      inlineModelSelect.value = pinnedDefaultModel;
      selectedModel = pinnedDefaultModel;
      localStorage.setItem(`selectedModel_${toolId}`, selectedModel);
    } else if (defaultModel && currentToolModels.some((m) => m.id === defaultModel)) {
      inlineModelSelect.value = defaultModel;
      selectedModel = defaultModel;
    } else {
      inlineModelSelect.value = "";
      selectedModel = "";
    }
    inlineModelSelect.style.display = currentToolModels.length > 0 ? "" : "none";

    if (currentToolReasoningKind === "enum") {
      thinkingToggle.style.display = "none";
      effortSelect.style.display = "";
      effortSelect.innerHTML = "";
      for (const level of currentToolEffortLevels) {
        const opt = document.createElement("option");
        opt.value = level;
        opt.textContent = level;
        effortSelect.appendChild(opt);
      }

      selectedEffort = sessionPreferences?.hasEffort
        ? sessionPreferences.effort
        : (localStorage.getItem(`selectedEffort_${toolId}`) || "");
      const currentModelData = currentToolModels.find((m) => m.id === selectedModel);
      if (selectedEffort && currentToolEffortLevels.includes(selectedEffort)) {
        effortSelect.value = selectedEffort;
      } else if (currentModelData?.defaultEffort) {
        effortSelect.value = currentModelData.defaultEffort;
        selectedEffort = currentModelData.defaultEffort;
      } else if (
        currentToolReasoningDefault
        && currentToolEffortLevels.includes(currentToolReasoningDefault)
      ) {
        effortSelect.value = currentToolReasoningDefault;
        selectedEffort = currentToolReasoningDefault;
      } else if (currentToolModels[0]?.defaultEffort) {
        effortSelect.value = currentToolModels[0].defaultEffort;
        selectedEffort = currentToolModels[0].defaultEffort;
      } else if (currentToolEffortLevels[0]) {
        effortSelect.value = currentToolEffortLevels[0];
        selectedEffort = currentToolEffortLevels[0];
      }
    } else if (currentToolReasoningKind === "toggle") {
      thinkingToggle.style.display = "";
      effortSelect.style.display = "none";
      selectedEffort = null;
      if (sessionPreferences?.hasThinking) {
        thinkingEnabled = sessionPreferences.thinking;
      }
      updateThinkingUI();
    } else {
      thinkingToggle.style.display = "none";
      effortSelect.style.display = "none";
      selectedEffort = null;
    }
    updateModelQuickSwitchUi();
    queueRuntimeSelectionSync();
  } catch {
    currentToolModels = [];
    currentToolEffortLevels = null;
    currentToolReasoningKind = "none";
    inlineModelSelect.style.display = "none";
    thinkingToggle.style.display = "none";
    effortSelect.style.display = "none";
    updateModelQuickSwitchUi();
  }
}

inlineModelSelect.addEventListener("change", () => {
  selectedModel = inlineModelSelect.value;
  if (selectedTool) localStorage.setItem(`selectedModel_${selectedTool}`, selectedModel);
  // Update default effort when model changes (enum reasoning tools)
  if (currentToolReasoningKind === "enum" && selectedModel) {
    const modelData = currentToolModels.find((m) => m.id === selectedModel);
    if (modelData?.defaultEffort && !localStorage.getItem(`selectedEffort_${selectedTool}`)) {
      effortSelect.value = modelData.defaultEffort;
      selectedEffort = modelData.defaultEffort;
    }
  }
  updateModelQuickSwitchUi();
  queueRuntimeSelectionSync();
  persistCurrentSessionToolPreferences();
});


addToolNameInput.addEventListener("input", () => {
  syncAddToolModal();
});

addToolCommandInput.addEventListener("input", () => {
  syncAddToolModal();
});

addToolRuntimeFamilySelect.addEventListener("change", () => {
  syncAddToolModal();
});

addToolModelsInput.addEventListener("input", () => {
  syncAddToolModal();
});

addToolReasoningKindSelect.addEventListener("change", () => {
  syncAddToolModal();
});

addToolReasoningLevelsInput.addEventListener("input", () => {
  syncAddToolModal();
});

closeAddToolModalBtn.addEventListener("click", closeAddToolModal);
closeAddToolModalFooterBtn.addEventListener("click", closeAddToolModal);
addToolModal.addEventListener("click", (e) => {
  if (e.target === addToolModal) closeAddToolModal();
});

saveToolConfigBtn.addEventListener("click", saveSimpleToolConfig);

copyProviderPromptBtn.addEventListener("click", async () => {
  try {
    await copyText(buildProviderBasePrompt());
    updateCopyButtonLabel(copyProviderPromptBtn, "Copied");
  } catch (err) {
    console.warn("[copy] Failed to copy provider prompt:", err.message);
  }
});

if (shareSnapshotBtn) {
  shareSnapshotBtn.addEventListener("click", shareCurrentSessionSnapshot);
}

if (handoffSessionBtn) {
  handoffSessionBtn.addEventListener("click", handoffCurrentSessionResult);
}

if (forkSessionBtn) {
  forkSessionBtn.addEventListener("click", forkCurrentSession);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && addToolModal && !addToolModal.hidden) {
    closeAddToolModal();
    return;
  }
});
