function getOrderedSettingsApps() {
  const apps = Array.isArray(availableApps)
    ? availableApps.filter((app) => isTemplateAppScopeId(app?.id))
    : [];
  return apps.sort((a, b) => {
    const rank = (app) => {
      if (app?.id === BASIC_CHAT_TEMPLATE_APP_ID) return 0;
      if (app?.id === CREATE_APP_TEMPLATE_APP_ID) return 1;
      return 2;
    };
    return rank(a) - rank(b) || String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
  });
}

function buildAppShareUrl(app) {
  const shareToken = typeof app?.shareToken === "string" ? app.shareToken.trim() : "";
  if (!shareToken || app?.shareEnabled === false) return "";
  return `${window.location.origin}/app/${encodeURIComponent(shareToken)}`;
}

function summarizeAppDescription(app) {
  if (app?.id === BASIC_CHAT_TEMPLATE_APP_ID) {
    return "默认的日常对话应用，适合普通 RemoteLab 会话。";
  }
  const welcome = typeof app?.welcomeMessage === "string" ? app.welcomeMessage.trim() : "";
  if (welcome) {
    return welcome.split(/\n+/)[0].trim();
  }
  const systemPrompt = typeof app?.systemPrompt === "string" ? app.systemPrompt.trim() : "";
  if (systemPrompt) {
    return `${systemPrompt.slice(0, 120)}${systemPrompt.length > 120 ? "…" : ""}`;
  }
  return app?.shareEnabled === false
    ? "内部起始应用，仅用于所有者会话。"
    : "可分享应用。";
}

function getAppKindLabel(app) {
  const labels = [];
  labels.push(app?.builtin ? "内置" : "自定义");
  labels.push(app?.shareEnabled === false ? "内部" : "可分享");
  return labels.join(" · ");
}

function setTemporaryButtonText(button, nextText, durationMs = 1400) {
  if (!button) return;
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.textContent || "";
  }
  button.textContent = nextText;
  window.clearTimeout(button._resetLabelTimer);
  button._resetLabelTimer = window.setTimeout(() => {
    button.textContent = button.dataset.originalLabel || button.textContent;
  }, durationMs);
}

function setUserFormStatus(message) {
  if (!userFormStatus) return;
  userFormStatus.textContent = message || "";
}

function setAppFormStatus(message) {
  if (!appFormStatus) return;
  appFormStatus.textContent = message || "";
}

function getAdminSessionPrincipal() {
  return {
    kind: "owner",
    id: ADMIN_USER_FILTER_VALUE,
    name: "管理员",
    appIds: [],
    defaultAppId: BASIC_CHAT_TEMPLATE_APP_ID,
  };
}

function getManagedUserById(userId) {
  return Array.isArray(availableUsers)
    ? availableUsers.find((user) => user.id === userId) || null
    : null;
}

function getPrincipalForUser(user) {
  if (!user?.id) return getAdminSessionPrincipal();
  return {
    kind: "user",
    id: user.id,
    name: user.name || "用户",
    appIds: Array.isArray(user.appIds) ? user.appIds.filter(Boolean) : [],
    defaultAppId: typeof user.defaultAppId === "string" ? user.defaultAppId.trim() : "",
  };
}

function resolveSelectedSessionPrincipal() {
  if (activeUserFilter === USER_FILTER_ALL_VALUE) {
    return getAdminSessionPrincipal();
  }
  if (activeUserFilter === ADMIN_USER_FILTER_VALUE) {
    return getAdminSessionPrincipal();
  }
  return getPrincipalForUser(getManagedUserById(activeUserFilter));
}

function buildSessionPrincipalPayload(principal) {
  if (principal?.kind !== "user") return {};
  return {
    userId: principal.id,
    userName: principal.name,
  };
}

function resolveAppIdForPrincipal(principal, requestedAppId = "") {
  const normalizedRequested = normalizeSessionAppFilter(requestedAppId);
  if (principal?.kind !== "user") {
    return normalizedRequested !== FILTER_ALL_VALUE
      ? normalizedRequested
      : BASIC_CHAT_TEMPLATE_APP_ID;
  }
  const allowedAppIds = Array.isArray(principal.appIds) ? principal.appIds.filter(Boolean) : [];
  if (allowedAppIds.length === 0) {
    return BASIC_CHAT_TEMPLATE_APP_ID;
  }
  if (normalizedRequested !== FILTER_ALL_VALUE && allowedAppIds.includes(normalizedRequested)) {
    return normalizedRequested;
  }
  if (principal.defaultAppId && allowedAppIds.includes(principal.defaultAppId)) {
    return principal.defaultAppId;
  }
  return allowedAppIds[0];
}

function getAppRecordById(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return null;
  return getOrderedSettingsApps().find((app) => app.id === normalized) || null;
}

function createSessionForApp(app, { closeSidebar = true, principal = getAdminSessionPrincipal() } = {}) {
  if (!app?.id) return false;
  if (closeSidebar && !isDesktop) closeSidebarFn();
  const tool =
    preferredTool
    || (typeof app?.tool === "string" && app.tool.trim())
    || selectedTool
    || toolsList[0]?.id;
  if (!tool) return false;
  if (typeof switchTab === "function") {
    switchTab("sessions");
  }
  return dispatchAction({
    action: "create",
    folder: "~",
    tool,
    sourceId: DEFAULT_APP_ID,
    sourceName: DEFAULT_APP_NAME,
    appId: app.id,
    ...buildSessionPrincipalPayload(principal),
  });
}

function renderAppToolSelectOptions(selectEl, selectedValue = "") {
  if (!selectEl) return;
  const baseToolOptions = Array.isArray(allToolsList) && allToolsList.length > 0
    ? allToolsList
    : toolsList;
  const toolOptions = prioritizeToolOptions(
    filterPrimaryToolOptions(baseToolOptions, { keepIds: [selectedValue] })
      .filter((tool) => tool?.available),
  );
  const preferredValue = selectedValue || preferredTool || selectedTool || toolOptions[0]?.id || "";
  selectEl.innerHTML = "";
  if (toolOptions.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "没有可用工具";
    selectEl.appendChild(option);
    selectEl.disabled = true;
    return;
  }
  for (const tool of toolOptions) {
    const option = document.createElement("option");
    option.value = tool.id;
    option.textContent = tool.name || tool.id;
    selectEl.appendChild(option);
  }
  selectEl.disabled = false;
  selectEl.value = toolOptions.some((tool) => tool.id === preferredValue)
    ? preferredValue
    : toolOptions[0].id;
}

function getSelectedNewUserAppIds() {
  if (!newUserAppsPicker) return [];
  return [...newUserAppsPicker.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value)
    .filter(Boolean);
}

function syncNewUserDefaultAppOptions(selectedAppIds = getSelectedNewUserAppIds()) {
  if (!newUserDefaultAppSelect) return;
  const selectedApps = getOrderedSettingsApps().filter((app) => selectedAppIds.includes(app.id));
  newUserDefaultAppSelect.innerHTML = "";
  if (selectedApps.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "请至少选择一个应用";
    newUserDefaultAppSelect.appendChild(option);
    newUserDefaultAppSelect.disabled = true;
    if (createUserBtn) createUserBtn.disabled = true;
    return;
  }

  const currentValue = typeof newUserDefaultAppSelect.value === "string" ? newUserDefaultAppSelect.value : "";
  for (const app of selectedApps) {
    const option = document.createElement("option");
    option.value = app.id;
    option.textContent = app.name || app.id;
    newUserDefaultAppSelect.appendChild(option);
  }
  newUserDefaultAppSelect.disabled = false;
  if (createUserBtn) createUserBtn.disabled = false;
  const preferredApp = selectedApps.find((app) => app.id === currentValue)
    || selectedApps.find((app) => app.id === BASIC_CHAT_TEMPLATE_APP_ID)
    || selectedApps[0];
  newUserDefaultAppSelect.value = preferredApp?.id || "";
}

function renderUserAppOptions() {
  if (!newUserAppsPicker) return;
  const apps = getOrderedSettingsApps();
  newUserAppsPicker.innerHTML = "";
  if (apps.length === 0) {
    newUserAppsPicker.innerHTML = '<div class="settings-app-empty">请先创建一个应用。</div>';
    syncNewUserDefaultAppOptions([]);
    setUserFormStatus("添加用户前请至少创建一个应用。");
    return;
  }

  const title = document.createElement("div");
  title.className = "settings-app-kind";
  title.textContent = "允许使用的应用";
  newUserAppsPicker.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "settings-app-picker-grid";
  const selectedIds = getSelectedNewUserAppIds();
  const activeIds = selectedIds.length > 0
    ? selectedIds
    : [BASIC_CHAT_TEMPLATE_APP_ID];

  for (const app of apps) {
    const chip = document.createElement("label");
    chip.className = "settings-app-chip";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = app.id;
    checkbox.checked = activeIds.includes(app.id);
    checkbox.addEventListener("change", () => {
      syncNewUserDefaultAppOptions();
    });

    const text = document.createElement("span");
    text.textContent = app.name || app.id;

    chip.appendChild(checkbox);
    chip.appendChild(text);
    grid.appendChild(chip);
  }

  newUserAppsPicker.appendChild(grid);
  syncNewUserDefaultAppOptions(activeIds);
  setUserFormStatus("管理员仍保留默认视图，新用户会自动获得一个起始会话。");
}

function focusNewUserComposer() {
  if (typeof switchTab === "function") {
    switchTab("settings");
  }
  openSidebar();
  if (typeof fetchAppsList === "function") {
    void fetchAppsList().catch(() => {});
  }
  if (typeof fetchUsersList === "function") {
    void fetchUsersList().catch(() => {});
  }
  window.setTimeout(() => {
    newUserNameInput?.focus();
    newUserNameInput?.select?.();
  }, 0);
  return true;
}

async function handleCreateUser() {
  if (!newUserDefaultAppSelect || newUserDefaultAppSelect.disabled) return false;
  const appIds = getSelectedNewUserAppIds();
  if (appIds.length === 0) {
    setUserFormStatus("请至少选择一个应用。");
    return false;
  }
  const defaultAppId = newUserDefaultAppSelect.value || appIds[0];
  const tool = preferredTool || selectedTool || toolsList[0]?.id || "";
  if (!tool) {
    setUserFormStatus("请先选择一个工具。");
    return false;
  }
  const name = typeof newUserNameInput?.value === "string" ? newUserNameInput.value.trim() : "";
  if (createUserBtn) createUserBtn.disabled = true;
  setUserFormStatus("正在创建用户…");
  try {
    const result = await createUserRecord({
      name: name || "新用户",
      appIds,
      defaultAppId,
      folder: "~",
      tool,
    });
    if (newUserNameInput) {
      newUserNameInput.value = "";
      newUserNameInput.focus();
    }
    renderUserAppOptions();
    const user = result?.user;
    refreshAppCatalog();
    renderSessionList();
    setUserFormStatus(`已创建 ${user?.name || "用户"}。准备好后可在下方复制分享链接。`);
    return true;
  } catch (error) {
    setUserFormStatus(error?.message || "创建用户失败。");
    return false;
  } finally {
    if (createUserBtn) createUserBtn.disabled = false;
  }
}

function copyShareUrl(shareUrl, button) {
  return (async () => {
    try {
      if (typeof copyText === "function") {
        await copyText(shareUrl);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        throw new Error("剪贴板不可用");
      }
      setTemporaryButtonText(button, "已复制");
    } catch {
      setTemporaryButtonText(button, "复制失败");
    }
  })();
}

function buildVisitorShareUrl(visitor) {
  const shareToken = typeof visitor?.shareToken === "string" ? visitor.shareToken.trim() : "";
  if (!shareToken) return "";
  return `${window.location.origin}/visitor/${encodeURIComponent(shareToken)}`;
}

async function ensureUserShareUrl(user) {
  if (!user?.id) {
    throw new Error("未找到用户。");
  }
  const appId = user.defaultAppId || user.appIds?.[0] || "";
  const app = getAppRecordById(appId);
  if (!app || app.shareEnabled === false) {
    throw new Error("请先选择一个可分享的默认应用。");
  }

  const visitorPayload = {
    name: user.name || "新用户",
    appId: app.id,
  };
  const existingVisitorId = typeof user.shareVisitorId === "string" ? user.shareVisitorId.trim() : "";
  let visitor = null;

  if (existingVisitorId) {
    try {
      visitor = await updateVisitorRecord(existingVisitorId, visitorPayload);
    } catch (error) {
      if (!/Visitor not found/i.test(error?.message || "")) {
        throw error;
      }
    }
  }

  if (!visitor) {
    visitor = await createVisitorRecord(visitorPayload);
    if (visitor?.id) {
      await updateUserRecord(user.id, { shareVisitorId: visitor.id });
    }
  }

  const shareUrl = buildVisitorShareUrl(visitor);
  if (!shareUrl) {
    throw new Error("生成分享链接失败。");
  }
  return shareUrl;
}

async function patchManagedUser(user, updates, {
  statusEl = null,
  pendingText = "正在保存…",
  successText = "已保存。",
  onSuccess = null,
} = {}) {
  if (!user?.id) return null;
  if (statusEl) {
    statusEl.textContent = pendingText;
  }
  try {
    const updated = await updateUserRecord(user.id, updates);
    if (statusEl) {
      statusEl.textContent = successText;
    }
    if (typeof onSuccess === "function") {
      onSuccess(updated);
    }
    return updated;
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = error?.message || "保存用户失败。";
    }
    return null;
  }
}

async function handleCreateApp() {
  const name = typeof newAppNameInput?.value === "string" ? newAppNameInput.value.trim() : "";
  const tool = typeof newAppToolSelect?.value === "string" ? newAppToolSelect.value.trim() : "";
  if (!name) {
    setAppFormStatus("名称不能为空。");
    return false;
  }
  if (!tool) {
    setAppFormStatus("请先选择一个工具。");
    return false;
  }
  if (createAppConfigBtn) createAppConfigBtn.disabled = true;
  setAppFormStatus("正在创建应用…");
  try {
    const app = await createAppRecord({
      name,
      tool,
      welcomeMessage: typeof newAppWelcomeInput?.value === "string" ? newAppWelcomeInput.value : "",
      systemPrompt: typeof newAppSystemPromptInput?.value === "string" ? newAppSystemPromptInput.value : "",
    });
    if (newAppNameInput) newAppNameInput.value = "";
    if (newAppWelcomeInput) newAppWelcomeInput.value = "";
    if (newAppSystemPromptInput) newAppSystemPromptInput.value = "";
    renderAppToolSelectOptions(newAppToolSelect);
    refreshAppCatalog();
    const shareUrl = buildAppShareUrl(app);
    setAppFormStatus(
      shareUrl
        ? `已创建 ${app?.name || "应用"}。可使用下方的复制链接按钮分享。`
        : `已创建 ${app?.name || "应用"}。`,
    );
    return true;
  } catch (error) {
    setAppFormStatus(error?.message || "创建应用失败。");
    return false;
  } finally {
    if (createAppConfigBtn) createAppConfigBtn.disabled = false;
  }
}

function focusNewAppComposer() {
  if (typeof switchTab === "function") {
    switchTab("settings");
  }
  openSidebar();
  if (typeof fetchAppsList === "function") {
    void fetchAppsList().catch(() => {});
  }
  window.setTimeout(() => {
    newAppNameInput?.focus();
    newAppNameInput?.select?.();
  }, 0);
  return true;
}

function renderSettingsAppsPanel() {
  if (!settingsAppsList) return;
  if (visitorMode) {
    settingsAppsList.innerHTML = '<div class="settings-app-empty">只有所有者可以管理应用。</div>';
    return;
  }

  renderAppToolSelectOptions(newAppToolSelect);
  const apps = getOrderedSettingsApps();
  settingsAppsList.innerHTML = "";
  if (apps.length === 0) {
    settingsAppsList.innerHTML = '<div class="settings-app-empty">还没有应用。</div>';
    return;
  }

  for (const app of apps) {
    const card = document.createElement("div");
    card.className = "settings-app-card";

    const header = document.createElement("div");
    header.className = "settings-app-card-header";
    const name = document.createElement("div");
    name.className = "settings-app-name";
    name.textContent = app.name || "未命名应用";
    const kind = document.createElement("div");
    kind.className = "settings-app-kind";
    kind.textContent = getAppKindLabel(app);
    header.appendChild(name);
    header.appendChild(kind);
    card.appendChild(header);

    const description = document.createElement("div");
    description.className = "settings-app-description";
    description.textContent = summarizeAppDescription(app);
    card.appendChild(description);

    const meta = document.createElement("div");
    meta.className = "settings-app-meta";
    meta.textContent = `默认工具 · ${(app.tool || preferredTool || selectedTool || "未设置")}`;
    card.appendChild(meta);

    const shareUrl = buildAppShareUrl(app);
    if (shareUrl) {
      const link = document.createElement("div");
      link.className = "settings-app-link";
      link.textContent = shareUrl;
      card.appendChild(link);
    }

    if (!app.builtin) {
      const editor = document.createElement("div");
      editor.className = "settings-app-editor";

      const nameInput = document.createElement("input");
      nameInput.className = "settings-inline-input";
      nameInput.type = "text";
      nameInput.value = app.name || "";
      editor.appendChild(nameInput);

      const toolSelect = document.createElement("select");
      toolSelect.className = "settings-inline-select";
      renderAppToolSelectOptions(toolSelect, app.tool || "");
      editor.appendChild(toolSelect);

      const welcomeInput = document.createElement("textarea");
      welcomeInput.className = "settings-inline-textarea";
      welcomeInput.value = typeof app.welcomeMessage === "string" ? app.welcomeMessage : "";
      welcomeInput.placeholder = "可选的首条助手消息";
      editor.appendChild(welcomeInput);

      const systemPromptInput = document.createElement("textarea");
      systemPromptInput.className = "settings-inline-textarea";
      systemPromptInput.value = typeof app.systemPrompt === "string" ? app.systemPrompt : "";
      systemPromptInput.placeholder = "可选的系统提示词";
      editor.appendChild(systemPromptInput);

      const inlineStatus = document.createElement("div");
      inlineStatus.className = "settings-app-empty inline-status";
      inlineStatus.textContent = "可以在这里编辑自定义应用。";
      editor.appendChild(inlineStatus);
      card.appendChild(editor);

      const actions = document.createElement("div");
      actions.className = "settings-app-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "settings-app-btn";
      saveBtn.textContent = "保存";
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        inlineStatus.textContent = "正在保存…";
        try {
          const updated = await updateAppRecord(app.id, {
            name: nameInput.value,
            tool: toolSelect.value,
            welcomeMessage: welcomeInput.value,
            systemPrompt: systemPromptInput.value,
          });
          inlineStatus.textContent = `已保存 ${updated?.name || "应用"}。`;
        } catch (error) {
          inlineStatus.textContent = error?.message || "保存应用失败。";
        } finally {
          saveBtn.disabled = false;
        }
      });
      actions.appendChild(saveBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "settings-app-btn";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", async () => {
        deleteBtn.disabled = true;
        inlineStatus.textContent = "正在删除…";
        try {
          await deleteAppRecord(app.id);
        } catch (error) {
          deleteBtn.disabled = false;
          inlineStatus.textContent = error?.message || "删除应用失败。";
        }
      });
      actions.appendChild(deleteBtn);

      if (shareUrl) {
        const copyLinkBtn = document.createElement("button");
        copyLinkBtn.type = "button";
        copyLinkBtn.className = "settings-app-btn";
        copyLinkBtn.textContent = "复制链接";
        copyLinkBtn.addEventListener("click", () => {
          void copyShareUrl(shareUrl, copyLinkBtn);
        });
        actions.appendChild(copyLinkBtn);
      }

      card.appendChild(actions);
      settingsAppsList.appendChild(card);
      continue;
    }

    const actions = document.createElement("div");
    actions.className = "settings-app-actions";

    if (shareUrl) {
      const copyLinkBtn = document.createElement("button");
      copyLinkBtn.type = "button";
      copyLinkBtn.className = "settings-app-btn";
      copyLinkBtn.textContent = "复制链接";
      copyLinkBtn.addEventListener("click", () => {
        void copyShareUrl(shareUrl, copyLinkBtn);
      });
      actions.appendChild(copyLinkBtn);
    }

    card.appendChild(actions);
    settingsAppsList.appendChild(card);
  }
}

function renderSettingsUsersPanel() {
  if (!settingsUsersList) return;
  if (visitorMode) {
    settingsUsersList.innerHTML = '<div class="settings-app-empty">只有所有者可以管理用户。</div>';
    return;
  }

  settingsUsersList.innerHTML = "";
  const users = Array.isArray(availableUsers) ? availableUsers : [];
  if (users.length === 0) {
    settingsUsersList.innerHTML = '<div class="settings-app-empty">还没有额外用户，管理员仍保留默认视图。</div>';
    return;
  }

  const allApps = getOrderedSettingsApps();
  for (const user of users) {
    const card = document.createElement("div");
    card.className = "settings-app-card";

    const header = document.createElement("div");
    header.className = "settings-app-card-header";
    const name = document.createElement("div");
    name.className = "settings-app-name";
    name.textContent = user.name || "未命名用户";
    const kind = document.createElement("div");
    kind.className = "settings-app-kind";
    const allowedApps = allApps.filter((app) => Array.isArray(user.appIds) && user.appIds.includes(app.id));
    const defaultApp = allowedApps.find((app) => app.id === user.defaultAppId) || allowedApps[0] || null;
    kind.textContent = `${allowedApps.length} 个应用 · 默认 ${defaultApp?.name || "基础对话"}`;
    header.appendChild(name);
    header.appendChild(kind);
    card.appendChild(header);

    const description = document.createElement("div");
    description.className = "settings-app-description";
    description.textContent = allowedApps.length > 0
      ? `允许使用的应用：${allowedApps.map((app) => app.name || app.id).join(", ")}`
      : "还没有选择任何应用。";
    card.appendChild(description);

    const editor = document.createElement("div");
    editor.className = "settings-app-editor";

    const nameInput = document.createElement("input");
    nameInput.className = "settings-inline-input";
    nameInput.type = "text";
    nameInput.value = user.name || "";
    editor.appendChild(nameInput);

    const pickerLabel = document.createElement("div");
    pickerLabel.className = "settings-app-kind";
    pickerLabel.textContent = "允许使用的应用";
    editor.appendChild(pickerLabel);

    const chipGrid = document.createElement("div");
    chipGrid.className = "settings-app-picker-grid";
    for (const app of allApps) {
      const chip = document.createElement("label");
      chip.className = "settings-app-chip";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = app.id;
      checkbox.checked = Array.isArray(user.appIds) && user.appIds.includes(app.id);
      const text = document.createElement("span");
      text.textContent = app.name || app.id;
      chip.appendChild(checkbox);
      chip.appendChild(text);
      chipGrid.appendChild(chip);
    }
    editor.appendChild(chipGrid);

    const defaultSelect = document.createElement("select");
    defaultSelect.className = "settings-inline-select";
    const syncDefaultOptions = () => {
      const selectedAppIds = [...chipGrid.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
      const selectedApps = allApps.filter((app) => selectedAppIds.includes(app.id));
      defaultSelect.innerHTML = "";
      if (selectedApps.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "请至少选择一个应用";
        defaultSelect.appendChild(option);
        defaultSelect.disabled = true;
        return;
      }
      defaultSelect.disabled = false;
      for (const app of selectedApps) {
        const option = document.createElement("option");
        option.value = app.id;
        option.textContent = app.name || app.id;
        defaultSelect.appendChild(option);
      }
      const fallbackValue = selectedApps.some((app) => app.id === user.defaultAppId)
        ? user.defaultAppId
        : selectedApps[0].id;
      defaultSelect.value = fallbackValue;
    };
    chipGrid.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", syncDefaultOptions);
    });
    syncDefaultOptions();
    editor.appendChild(defaultSelect);

    const inlineStatus = document.createElement("div");
    inlineStatus.className = "settings-app-empty inline-status";
    inlineStatus.textContent = "修改会立即保存，准备分享给该用户时可复制分享链接。";
    editor.appendChild(inlineStatus);
    card.appendChild(editor);

    nameInput.addEventListener("change", async () => {
      const nextName = nameInput.value.trim();
      if (!nextName || nextName === user.name) {
        nameInput.value = user.name || "";
        return;
      }
      const updated = await patchManagedUser(user, { name: nextName }, {
        statusEl: inlineStatus,
        successText: `已保存 ${nextName}。`,
      });
      if (updated?.name) {
        user.name = updated.name;
        nameInput.value = updated.name;
      }
    });

    defaultSelect.addEventListener("change", async () => {
      const nextDefaultAppId = defaultSelect.value || user.defaultAppId || "";
      if (!nextDefaultAppId || nextDefaultAppId === user.defaultAppId) return;
      const updated = await patchManagedUser(user, { defaultAppId: nextDefaultAppId }, {
        statusEl: inlineStatus,
        successText: "默认应用已更新。",
      });
      if (updated?.defaultAppId) {
        user.defaultAppId = updated.defaultAppId;
        defaultSelect.value = updated.defaultAppId;
      }
    });

    chipGrid.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        const appIds = [...chipGrid.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
        if (appIds.length === 0) {
          checkbox.checked = true;
          syncDefaultOptions();
          inlineStatus.textContent = "请至少选择一个应用。";
          return;
        }
        syncDefaultOptions();
        const nextDefaultAppId = defaultSelect.value || appIds[0];
        const updated = await patchManagedUser(user, {
          appIds,
          defaultAppId: nextDefaultAppId,
        }, {
          statusEl: inlineStatus,
          successText: "允许使用的应用已更新。",
        });
        if (updated) {
          user.appIds = Array.isArray(updated.appIds) ? updated.appIds : appIds;
          user.defaultAppId = updated.defaultAppId || nextDefaultAppId;
          syncDefaultOptions();
        }
      });
    });

    const actions = document.createElement("div");
    actions.className = "settings-app-actions";

    const copyLinkBtn = document.createElement("button");
    copyLinkBtn.type = "button";
    copyLinkBtn.className = "settings-app-btn";
    copyLinkBtn.textContent = "复制分享链接";
    copyLinkBtn.addEventListener("click", async () => {
      copyLinkBtn.disabled = true;
      inlineStatus.textContent = "正在准备分享链接…";
      try {
        const shareUrl = await ensureUserShareUrl(user);
        await copyShareUrl(shareUrl, copyLinkBtn);
        inlineStatus.textContent = "分享链接已复制。";
      } catch (error) {
        inlineStatus.textContent = error?.message || "准备分享链接失败。";
      } finally {
        copyLinkBtn.disabled = false;
      }
    });
    actions.appendChild(copyLinkBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "settings-app-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", async () => {
      deleteBtn.disabled = true;
      inlineStatus.textContent = "正在删除…";
      try {
        await deleteUserRecord(user.id);
        if (activeUserFilter === user.id) {
          activeUserFilter = ADMIN_USER_FILTER_VALUE;
          persistActiveUserFilter(activeUserFilter);
          refreshAppCatalog();
          renderSessionList();
        }
      } catch (error) {
        deleteBtn.disabled = false;
        inlineStatus.textContent = error?.message || "删除用户失败。";
      }
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    settingsUsersList.appendChild(card);
  }
}
