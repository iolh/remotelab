// ---- Session list ----
function getSafeSessionDisplayName(session) {
  if (typeof getSessionDisplayName === "function") {
    return getSessionDisplayName(session);
  }
  return session?.name || session?.description || session?.tool || "会话";
}

function getSafeSessionGroupInfo(session) {
  if (typeof getSessionGroupInfo === "function") {
    return getSessionGroupInfo(session);
  }
  const group = typeof session?.group === "string" ? session.group.trim() : "";
  const folder = typeof session?.folder === "string" ? session.folder.trim() : "";
  const label = group || folder.split("/").filter(Boolean).pop() || "未分组";
  return {
    key: `group:${label}`,
    label,
    title: label,
  };
}

function getSafeFilteredSessionEmptyText(options = {}) {
  if (typeof getFilteredSessionEmptyText === "function") {
    return getFilteredSessionEmptyText(options);
  }
  return options?.archived ? "No archived sessions" : "No open sessions";
}

function getSafeShortFolder(folder) {
  if (typeof getShortFolder === "function") {
    return getShortFolder(folder || "");
  }
  const normalized = typeof folder === "string" ? folder.trim() : "";
  return normalized.split("/").filter(Boolean).pop() || "";
}

function renderSessionList() {
  sessionList.innerHTML = "";
  const pinnedSessions = getVisiblePinnedSessions();
  const visibleSessions = getVisibleActiveSessions();

  if (pinnedSessions.length > 0) {
    const section = document.createElement("div");
    section.className = "pinned-section";

    const header = document.createElement("div");
    header.className = "pinned-section-header";
    header.innerHTML = `<span class="pinned-label">置顶</span><span class="folder-count">${pinnedSessions.length}</span>`;

    const items = document.createElement("div");
    items.className = "pinned-items";
    for (const session of pinnedSessions) {
      items.appendChild(createActiveSessionItem(session));
    }

    section.appendChild(header);
    section.appendChild(items);
    sessionList.appendChild(section);
  }

  const groups = new Map();
  for (const s of visibleSessions) {
    const groupInfo = getSafeSessionGroupInfo(s);
    if (!groups.has(groupInfo.key)) {
      groups.set(groupInfo.key, { ...groupInfo, sessions: [] });
    }
    groups.get(groupInfo.key).sessions.push(s);
  }

  for (const [groupKey, groupEntry] of groups) {
    const folderSessions = groupEntry.sessions;
    const group = document.createElement("div");
    group.className = "folder-group";

    const header = document.createElement("div");
    header.className =
      "folder-group-header" +
      (collapsedFolders[groupKey] ? " collapsed" : "");
    header.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span>
      <span class="folder-name" title="${esc(groupEntry.title)}">${esc(groupEntry.label)}</span>
      <span class="folder-count">${folderSessions.length}</span>`;
    header.addEventListener("click", (e) => {
      header.classList.toggle("collapsed");
      collapsedFolders[groupKey] = header.classList.contains("collapsed");
      localStorage.setItem(
        COLLAPSED_GROUPS_STORAGE_KEY,
        JSON.stringify(collapsedFolders),
      );
    });

    const items = document.createElement("div");
    items.className = "folder-group-items";

    for (const s of folderSessions) {
      items.appendChild(createActiveSessionItem(s));
    }

    group.appendChild(header);
    group.appendChild(items);
    sessionList.appendChild(group);
  }

  if (pinnedSessions.length === 0 && visibleSessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "session-filter-empty";
    empty.textContent = getSafeFilteredSessionEmptyText();
    sessionList.appendChild(empty);
  }

  renderArchivedSection();
}

function renderArchivedSection() {
  const archivedSessions = getVisibleArchivedSessions();
  const existing = document.getElementById("archivedSection");
  if (existing) existing.remove();

  const section = document.createElement("div");
  section.id = "archivedSection";
  section.className = "archived-section";

  const header = document.createElement("div");
  header.className = "archived-section-header";
  const isCollapsed = localStorage.getItem("archivedCollapsed") !== "false";
  if (isCollapsed) header.classList.add("collapsed");
  const archivedCount = archivedSessionsLoaded ? archivedSessions.length : archivedSessionCount;
  header.innerHTML = `<span class="folder-chevron">${renderUiIcon("chevron-down")}</span><span class="archived-label">归档</span><span class="folder-count">${archivedCount}</span>`;
  header.addEventListener("click", () => {
    header.classList.toggle("collapsed");
    localStorage.setItem("archivedCollapsed", header.classList.contains("collapsed") ? "true" : "false");
    if (!header.classList.contains("collapsed") && !archivedSessionsLoaded && !archivedSessionsLoading && archivedSessionCount > 0) {
      Promise.resolve(fetchArchivedSessions()).catch((error) => {
        console.warn("[sessions] Failed to load archived sessions:", error.message);
      });
    }
  });

  const items = document.createElement("div");
  items.className = "archived-items";

  if (!isCollapsed && !archivedSessionsLoaded && archivedSessionCount > 0) {
    if (!archivedSessionsLoading) {
      Promise.resolve(fetchArchivedSessions()).catch((error) => {
        console.warn("[sessions] Failed to load archived sessions:", error.message);
      });
    }
    const loading = document.createElement("div");
    loading.className = "archived-empty";
    loading.textContent = archivedSessionsLoading
      ? "正在加载归档会话…"
      : "加载归档会话…";
    items.appendChild(loading);
  } else if (archivedSessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "archived-empty";
    empty.textContent = getSafeFilteredSessionEmptyText({ archived: true });
    items.appendChild(empty);
  } else {
    for (const s of archivedSessions) {
      const div = document.createElement("div");
      div.className =
        "session-item archived-item" + (s.id === currentSessionId ? " active" : "");
      const displayName = getSafeSessionDisplayName(s);
      const groupInfo = getSafeSessionGroupInfo(s);
      const shortFolder = getSafeShortFolder(s.folder || "");
      const date = s.archivedAt ? new Date(s.archivedAt).toLocaleDateString() : "";
      div.innerHTML = `
        <div class="session-item-info">
          <div class="session-item-name">${esc(displayName)}</div>
          <div class="session-item-meta"><span title="${esc(shortFolder || groupInfo.title)}">${esc(groupInfo.label)}</span>${date ? ` · ${date}` : ""}</div>
        </div>
        <div class="session-item-actions">
          <button class="session-action-btn restore" type="button" title="恢复" aria-label="恢复" data-id="${s.id}">${renderUiIcon("unarchive")}</button>
        </div>`;
      div.addEventListener("click", (e) => {
        if (e.target.closest(".session-action-btn")) return;
        attachSession(s.id, s);
        if (!isDesktop) closeSidebarFn();
      });
      div.querySelector(".restore").addEventListener("click", (e) => {
        e.stopPropagation();
        dispatchAction({ action: "unarchive", sessionId: s.id });
      });
      items.appendChild(div);
    }
  }

  section.appendChild(header);
  section.appendChild(items);
  sessionList.appendChild(section);
}

function startRename(itemEl, session) {
  const nameEl = itemEl.querySelector(".session-item-name");
  const current = session.name || session.tool || "";
  const input = document.createElement("input");
  input.className = "session-rename-input";
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim();
    if (newName && newName !== current) {
      dispatchAction({ action: "rename", sessionId: session.id, name: newName });
    } else {
      renderSessionList(); // revert
    }
  }

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      renderSessionList();
    }
  });
}

function attachSession(id, session) {
  const shouldReattach = !hasAttachedSession || currentSessionId !== id;
  if (shouldReattach) {
    clearMessages();
    dispatchAction({ action: "attach", sessionId: id });
  }
  applyAttachedSessionState(id, session, { renderList: false });
  if (typeof markSessionReviewed === "function") {
    Promise.resolve(markSessionReviewed(session, { sync: shouldReattach, render: false })).catch(() => {});
  }
  renderSessionList();
  if (typeof focusComposer === "function") {
    focusComposer({ preventScroll: true });
  } else {
    msgInput.focus();
  }
}
