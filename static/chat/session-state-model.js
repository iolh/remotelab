"use strict";

(function attachRemoteLabSessionStateModel(root) {
  const defaultBoardColumn = {
    key: "open",
    label: "Open",
    title: "Sessions that are ready for more work.",
    emptyText: "No open sessions",
    order: 20,
  };

  const sessionBoardColumnSpecs = [
    {
      key: "active_now",
      label: "Active",
      title: "Running, queued, or compacting sessions.",
      emptyText: "No active sessions",
      order: 0,
    },
    {
      key: "waiting_user",
      label: "Waiting",
      title: "Sessions blocked on your input or approval.",
      emptyText: "Nothing waiting on you",
      order: 10,
    },
    { ...defaultBoardColumn },
    {
      key: "parked",
      label: "Parked",
      title: "Sessions intentionally paused for later.",
      emptyText: "Nothing parked",
      order: 30,
    },
    {
      key: "done",
      label: "Done",
      title: "Completed sessions kept for reference.",
      emptyText: "No completed sessions",
      order: 40,
    },
  ];

  const workflowPrioritySpecs = {
    high: {
      key: "high",
      label: "High",
      rank: 3,
      className: "board-priority-high",
      title: "Needs user attention soon.",
    },
    medium: {
      key: "medium",
      label: "Medium",
      rank: 2,
      className: "board-priority-medium",
      title: "Worth checking soon, but not urgent.",
    },
    low: {
      key: "low",
      label: "Low",
      rank: 1,
      className: "board-priority-low",
      title: "Safe to leave for later.",
    },
  };

  const workflowStatusSpecs = {
    waiting_user: {
      key: "waiting_user",
      label: "waiting",
      className: "status-waiting-user",
      dotClass: "",
      itemClass: "",
      title: "Waiting on user input",
    },
    done: {
      key: "done",
      label: "done",
      className: "status-done",
      dotClass: "",
      itemClass: "",
      title: "Current task complete",
    },
    parked: {
      key: "parked",
      label: "parked",
      className: "status-parked",
      dotClass: "",
      itemClass: "",
      title: "Parked for later",
    },
  };

  function createEmptyStatus() {
    return {
      key: "idle",
      label: "",
      className: "",
      dotClass: "",
      itemClass: "",
      title: "",
    };
  }

  function createStatus(key, label, className = "", dotClass = "", itemClass = "", title = "") {
    return {
      key,
      label,
      className,
      dotClass,
      itemClass,
      title,
    };
  }

  function normalizeSessionWorkflowState(value) {
    const normalized = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!normalized) return "";
    if (["waiting", "waiting_user", "waiting_for_user", "waiting_on_user", "needs_user", "needs_input"].includes(normalized)) {
      return "waiting_user";
    }
    if (["done", "complete", "completed", "finished"].includes(normalized)) {
      return "done";
    }
    if (["parked", "paused", "pause", "backlog", "todo"].includes(normalized)) {
      return "parked";
    }
    return "";
  }

  function normalizeSessionWorkflowPriority(value) {
    const normalized = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!normalized) return "";
    if (["high", "urgent", "asap", "important", "critical", "top", "top_priority", "p1"].includes(normalized)) {
      return "high";
    }
    if (["medium", "normal", "default", "standard", "soon", "next", "p2"].includes(normalized)) {
      return "medium";
    }
    if (["low", "later", "backlog", "deferred", "eventually", "p3"].includes(normalized)) {
      return "low";
    }
    return "";
  }

  function getWorkflowPriorityInfo(value) {
    const normalized = normalizeSessionWorkflowPriority(value);
    if (!normalized || !workflowPrioritySpecs[normalized]) return null;
    return { ...workflowPrioritySpecs[normalized] };
  }

  function getWorkflowStatusInfo(value) {
    const normalized = normalizeSessionWorkflowState(value);
    if (!normalized || !workflowStatusSpecs[normalized]) return null;
    return { ...workflowStatusSpecs[normalized] };
  }

  function parseSessionTime(value) {
    const time = new Date(value || "").getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function getSessionLatestChangeTime(session) {
    const stamp = session?.lastEventAt || session?.updatedAt || session?.created || "";
    return parseSessionTime(stamp);
  }

  function getSessionReviewTime(session) {
    return Math.max(
      parseSessionTime(session?.lastReviewedAt),
      parseSessionTime(session?.localReviewedAt),
      parseSessionTime(session?.reviewBaselineAt),
    );
  }

  function getSessionSortTime(session) {
    const activity = normalizeSessionActivity(session);
    if (activity.run.state === "running" && activity.run.startedAt) {
      const startedAt = parseSessionTime(activity.run.startedAt);
      if (startedAt > 0) return startedAt;
    }
    return getSessionLatestChangeTime(session);
  }

  function cloneBoardColumn(column) {
    return { ...(column || defaultBoardColumn) };
  }

  function getBoardColumnSpec(key) {
    return sessionBoardColumnSpecs.find((column) => column.key === key) || defaultBoardColumn;
  }

  function normalizeSessionActivity(session) {
    const raw = session?.activity || {};
    const rawRunState = raw?.run?.state;
    const runState =
      rawRunState === "running"
        ? rawRunState
        : "idle";
    const queueCount = Number.isInteger(raw?.queue?.count)
      ? raw.queue.count
      : 0;
    const queueState = raw?.queue?.state === "queued" && queueCount > 0
      ? "queued"
      : "idle";
    const renameState = raw?.rename?.state === "pending" || raw?.rename?.state === "failed"
      ? raw.rename.state
      : "idle";
    const compactState = raw?.compact?.state === "pending"
      ? "pending"
      : "idle";

    return {
      run: {
        state: runState,
        phase: typeof raw?.run?.phase === "string" ? raw.run.phase : null,
        startedAt: typeof raw?.run?.startedAt === "string" ? raw.run.startedAt : null,
        runId: typeof raw?.run?.runId === "string" ? raw.run.runId : null,
        cancelRequested: raw?.run?.cancelRequested === true,
      },
      queue: {
        state: queueState,
        count: queueCount,
      },
      rename: {
        state: renameState,
        error: typeof raw?.rename?.error === "string" ? raw.rename.error : "",
      },
      compact: {
        state: compactState,
      },
    };
  }

  function isSessionBusy(session) {
    const activity = normalizeSessionActivity(session);
    return activity.run.state === "running"
      || activity.queue.state === "queued"
      || activity.compact.state === "pending";
  }

  function isSessionPendingIntake(session) {
    return false;
  }

  function deriveSessionBoardColumnKey(session) {
    const activity = normalizeSessionActivity(session);
    if (
      activity.run.state === "running"
      || activity.queue.state === "queued"
      || activity.compact.state === "pending"
    ) {
      return "active_now";
    }

    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    if (workflowState === "waiting_user") return "waiting_user";
    if (workflowState === "done") return "done";
    if (workflowState === "parked") return "parked";
    return defaultBoardColumn.key;
  }

  function getSessionPrimaryStatus(session, options = {}) {
    if (!session) {
      return createEmptyStatus();
    }

    const indicators = getSessionStatusSummary(session, options).indicators;
    return indicators[0] || createStatus("idle", "空闲");
  }

  function getSessionStatusSummary(session, { includeToolFallback = false } = {}) {
    const activity = normalizeSessionActivity(session);
    const indicators = [];

    if (activity.run.state === "running") {
      indicators.push(createStatus("running", "running", "status-running", "running"));
    }

    if (activity.queue.state === "queued") {
      indicators.push(createStatus(
        "queued",
        "queued",
        "status-queued",
        "queued",
        "",
        activity.queue.count > 0
          ? `${activity.queue.count} follow-up${activity.queue.count === 1 ? "" : "s"} queued`
          : "",
      ));
    }

    if (activity.compact.state === "pending") {
      indicators.push(createStatus("compacting", "compacting", "status-compacting", "compacting"));
    }

    if (activity.rename.state === "pending") {
      indicators.push(createStatus("renaming", "renaming", "status-renaming", "renaming"));
    }

    if (activity.rename.state === "failed") {
      indicators.push(createStatus(
        "rename-failed",
        "rename failed",
        "status-rename-failed",
        "rename-failed",
        "",
        activity.rename.error || "Session rename failed",
      ));
    }

    const primary = indicators[0] || (
      session?.tool && includeToolFallback
        ? createStatus("tool", session.tool)
        : createStatus("idle", "空闲")
    );

    return {
      primary,
      indicators: indicators.length > 0 || !primary.label ? indicators : [primary],
    };
  }

  function getSessionVisualStatus(session, options = {}) {
    return getSessionStatusSummary(session, options).primary;
  }

  function getBoardColumns(_layout, sessions = []) {
    const sessionList = Array.isArray(sessions) ? sessions : [];
    const counts = new Map(sessionBoardColumnSpecs.map((column) => [column.key, 0]));
    for (const session of sessionList) {
      const key = deriveSessionBoardColumnKey(session);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const columns = sessionBoardColumnSpecs
      .filter((column) => sessionList.length === 0 ? column.key === defaultBoardColumn.key : (counts.get(column.key) || 0) > 0)
      .map(cloneBoardColumn);

    return columns.length > 0 ? columns : [cloneBoardColumn(defaultBoardColumn)];
  }

  function getSessionBoardColumn(session, layout, sessions = []) {
    const columns = getBoardColumns(layout, sessions);
    const derivedKey = deriveSessionBoardColumnKey(session);
    return columns.find((column) => column.key === derivedKey)
      || cloneBoardColumn(getBoardColumnSpec(derivedKey))
      || columns[0]
      || cloneBoardColumn(defaultBoardColumn);
  }

  function getSessionBoardPriority(session) {
    const explicitPriority = getWorkflowPriorityInfo(session?.workflowPriority);
    if (explicitPriority) return explicitPriority;
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    if (workflowState === "waiting_user") return getWorkflowPriorityInfo("high");
    if (workflowState === "done") return getWorkflowPriorityInfo("low");
    return getWorkflowPriorityInfo("medium");
  }

  function hasSessionUnreadUpdate(session) {
    if (!session) return false;
    if (isSessionBusy(session)) return false;
    return getSessionLatestChangeTime(session) > getSessionReviewTime(session);
  }

  function getSessionReviewStatusInfo(session) {
    if (!hasSessionUnreadUpdate(session)) return null;
    return createStatus(
      "unread",
      "new",
      "status-unread",
      "",
      "",
      "Updated since you last reviewed this session",
    );
  }

  function isSessionCompleteAndReviewed(session) {
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    return workflowState === "done"
      && !isSessionBusy(session)
      && !hasSessionUnreadUpdate(session);
  }

  function hasSessionPendingWorkflowAction(session) {
    if (session?.workflowSuggestion
        && typeof session.workflowSuggestion === "object"
        && session.workflowSuggestion.type) {
      return true;
    }
    if (Array.isArray(session?.conclusions)
        && session.conclusions.some(function(c) { return c && c.status === "needs_decision"; })) {
      return true;
    }
    return false;
  }

  function getSessionAttentionBand(session) {
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    const busy = isSessionBusy(session);
    const unread = hasSessionUnreadUpdate(session);

    if (unread && workflowState === "waiting_user") return 0;
    if (unread) return 1;
    if (workflowState === "waiting_user") return 2;
    if (hasSessionPendingWorkflowAction(session)) return 3;
    if (!busy && workflowState !== "done" && workflowState !== "parked") return 4;
    if (busy) return 5;
    if (workflowState === "parked") return 6;
    if (workflowState === "done") return 7;
    return 4;
  }

  function compareSessionListSessions(a, b) {
    const attentionBandDiff = getSessionAttentionBand(a) - getSessionAttentionBand(b);
    if (attentionBandDiff) return attentionBandDiff;

    const priorityDiff = (getSessionBoardPriority(b)?.rank || 0) - (getSessionBoardPriority(a)?.rank || 0);
    if (priorityDiff) return priorityDiff;

    const pinDiff = (b?.pinned === true ? 1 : 0) - (a?.pinned === true ? 1 : 0);
    if (pinDiff) return pinDiff;

    return getSessionSortTime(b) - getSessionSortTime(a);
  }

  function getSessionBoardOrder(_session) {
    return 0;
  }

  function compareBoardSessions(a, b) {
    const boardOrderDiff = getSessionBoardOrder(a) - getSessionBoardOrder(b);
    if (boardOrderDiff) return boardOrderDiff;

    const priorityDiff = (getSessionBoardPriority(b)?.rank || 0) - (getSessionBoardPriority(a)?.rank || 0);
    if (priorityDiff) return priorityDiff;

    const pinDiff = (b?.pinned === true ? 1 : 0) - (a?.pinned === true ? 1 : 0);
    if (pinDiff) return pinDiff;

    return getSessionSortTime(b) - getSessionSortTime(a);
  }

  root.RemoteLabSessionStateModel = {
    createEmptyStatus,
    normalizeSessionWorkflowPriority,
    normalizeSessionWorkflowState,
    normalizeSessionActivity,
    isSessionBusy,
    getSessionSortTime,
    getWorkflowStatusInfo,
    getSessionPrimaryStatus,
    getSessionStatusSummary,
    getSessionVisualStatus,
    hasSessionUnreadUpdate,
    getSessionReviewStatusInfo,
    isSessionCompleteAndReviewed,
    getBoardColumns,
    getSessionBoardColumn,
    getSessionBoardPriority,
    getSessionBoardOrder,
    compareSessionListSessions,
    compareBoardSessions,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
