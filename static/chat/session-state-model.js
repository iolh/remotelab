"use strict";

(function attachRemoteLabSessionStateModel(root) {
  const workflowPrioritySpecs = {
    high: {
      key: "high",
      label: "High",
      rank: 3,
      className: "priority-high",
      title: "Needs user attention soon.",
    },
    medium: {
      key: "medium",
      label: "Medium",
      rank: 2,
      className: "priority-medium",
      title: "Worth checking soon, but not urgent.",
    },
    low: {
      key: "low",
      label: "Low",
      rank: 1,
      className: "priority-low",
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

  const attentionStateRanks = Object.freeze({
    needs_you_now: 0,
    blocked: 1,
    done: 2,
    still_running: 3,
    idle: 4,
  });

  const attentionPriorityRanks = Object.freeze({
    high: 3,
    medium: 2,
    low: 1,
  });

  const attentionTypeLabels = Object.freeze({
    needs_approval: "待批准",
    needs_decision: "需要决策",
    blocked_by_env: "环境阻塞",
    needs_credentials: "缺少凭证",
    needs_input: "需要输入",
    fyi: "运行中",
    completed: "已完成",
    failed_needs_review: "需要复核",
  });

  const attentionStateClassNames = Object.freeze({
    needs_you_now: "status-attention-action",
    blocked: "status-attention-blocked",
    still_running: "status-attention-running",
    done: "status-attention-complete",
    idle: "status-attention-idle",
  });

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

  function normalizeAttentionState(value) {
    const normalized = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!normalized || !Object.prototype.hasOwnProperty.call(attentionStateRanks, normalized)) {
      return "";
    }
    return normalized;
  }

  function normalizeAttentionPriority(value) {
    const normalized = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!normalized || !Object.prototype.hasOwnProperty.call(attentionPriorityRanks, normalized)) {
      return "";
    }
    return normalized;
  }

  function normalizeAttentionType(value) {
    const normalized = typeof value === "string"
      ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    if (!normalized || !Object.prototype.hasOwnProperty.call(attentionTypeLabels, normalized)) {
      return "";
    }
    return normalized;
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

  function getEffectiveSessionReviewedAt(session) {
    const candidates = [
      typeof session?.lastReviewedAt === "string" ? session.lastReviewedAt : "",
      typeof session?.localReviewedAt === "string" ? session.localReviewedAt : "",
      typeof session?.reviewBaselineAt === "string" ? session.reviewBaselineAt : "",
    ];
    let best = "";
    let bestTime = 0;
    for (const candidate of candidates) {
      const time = parseSessionTime(candidate);
      if (time > bestTime) {
        best = candidate;
        bestTime = time;
      }
    }
    return best;
  }

  function getEffectiveSessionReviewedTime(session) {
    return parseSessionTime(getEffectiveSessionReviewedAt(session));
  }

  function getSessionSortTime(session) {
    const activity = normalizeSessionActivity(session);
    if (activity.run.state === "running" && activity.run.startedAt) {
      const startedAt = parseSessionTime(activity.run.startedAt);
      if (startedAt > 0) return startedAt;
    }
    return getSessionLatestChangeTime(session);
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

  function getSessionWorkflowPriority(session) {
    const explicitPriority = getWorkflowPriorityInfo(session?.workflowPriority);
    if (explicitPriority) return explicitPriority;
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    if (workflowState === "waiting_user") return getWorkflowPriorityInfo("high");
    if (workflowState === "done") return getWorkflowPriorityInfo("low");
    return getWorkflowPriorityInfo("medium");
  }

  function isSessionCompleted(session) {
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    return workflowState === "done" && !isSessionBusy(session);
  }

  function hasSessionUnreadUpdate(session) {
    if (!session) return false;
    if (isSessionBusy(session)) return false;
    return getSessionLatestChangeTime(session) > getEffectiveSessionReviewedTime(session);
  }

  function hasSessionUnreadCompletion(session) {
    return isSessionCompleted(session) && hasSessionUnreadUpdate(session);
  }

  function shouldSurfaceCompletedAttention(session) {
    if (!hasSessionUnreadCompletion(session)) return false;
    const raw = session?.attention;
    if (raw && typeof raw === "object" && raw.reason === "completion_tool_only") {
      return false;
    }
    return true;
  }

  function getSessionReviewStatusInfo(session) {
    if (!shouldSurfaceCompletedAttention(session)) return null;
    return createStatus(
      "unread",
      "new",
      "status-unread",
      "",
      "",
      "Updated since you last reviewed this session",
    );
  }

  function isSessionCompletedAndReviewed(session) {
    return isSessionCompleted(session) && !hasSessionUnreadCompletion(session);
  }

  function isSessionCompleteAndReviewed(session) {
    return isSessionCompletedAndReviewed(session);
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

  function getAttentionTypeLabel(value, fallback = "") {
    const normalized = normalizeAttentionType(value);
    return normalized ? (attentionTypeLabels[normalized] || fallback) : fallback;
  }

  function getAttentionStateRank(value) {
    const normalized = normalizeAttentionState(value);
    return normalized ? attentionStateRanks[normalized] : Number.MAX_SAFE_INTEGER;
  }

  function getAttentionPriorityRank(value) {
    const normalized = normalizeAttentionPriority(value);
    return normalized ? attentionPriorityRanks[normalized] : 0;
  }

  function isWaitingUserReviewDismissible(session) {
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    if (workflowState !== "waiting_user") return false;
    if (hasSessionUnreadUpdate(session)) return false;
    if (hasSessionPendingWorkflowAction(session)) return false;
    return true;
  }

  function getSessionAttentionBand(session) {
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    const busy = isSessionBusy(session);
    const unread = hasSessionUnreadUpdate(session);
    const completedUnread = shouldSurfaceCompletedAttention(session);

    if (unread && workflowState === "waiting_user") return 0;
    if (completedUnread) return 1;
    if (hasSessionPendingWorkflowAction(session)) return 2;
    if (!busy && workflowState !== "done" && workflowState !== "parked") return 4;
    if (busy) return 5;
    if (workflowState === "parked") return 6;
    if (workflowState === "done") return 7;
    return 4;
  }

  function buildLegacySessionAttention(session) {
    const workflowState = normalizeSessionWorkflowState(session?.workflowState || "");
    const busy = isSessionBusy(session);
    const unread = hasSessionUnreadUpdate(session);
    const completedUnread = hasSessionUnreadCompletion(session);
    const completedReviewed = isSessionCompletedAndReviewed(session);
    const pendingWorkflowAction = hasSessionPendingWorkflowAction(session);
    const legacyBand = getSessionAttentionBand(session);

    let state = "idle";
    let type = "fyi";
    let priority = "medium";
    let reason = "";
    let reasonLabel = "";
    let title = "";

    if (unread && workflowState === "waiting_user") {
      state = "needs_you_now";
      type = "needs_input";
      priority = "high";
      reason = "waiting_for_input";
      reasonLabel = "需要你的输入";
      title = "待处理";
    } else if (completedUnread) {
      state = "done";
      type = "completed";
      priority = "high";
      reason = "completion_with_conclusion";
      reasonLabel = "查看结果";
      title = "已完成";
    } else if (pendingWorkflowAction) {
      state = "needs_you_now";
      type = "needs_decision";
      priority = "high";
      reason = "needs_decision";
      reasonLabel = "需要你的确认";
      title = "待处理";
    } else if (workflowState === "waiting_user") {
      state = "idle";
      type = "needs_input";
      priority = "low";
      reason = "waiting_reviewed";
      reasonLabel = "";
      title = "";
    } else if (busy) {
      state = "still_running";
      type = "fyi";
      priority = "medium";
      reason = "run_in_progress";
      reasonLabel = "仍在运行";
      title = "运行中";
    } else if (completedReviewed) {
      state = "idle";
      type = "completed";
      priority = "low";
      reason = "completed_viewed";
      reasonLabel = "";
      title = "已完成";
    } else if (unread) {
      state = "idle";
      type = "fyi";
      priority = "low";
      reason = "unread_update";
      reasonLabel = "有更新";
      title = workflowState === "parked" ? "已暂停" : "有更新";
    } else if (workflowState === "parked") {
      state = "idle";
      type = "fyi";
      priority = "low";
      reasonLabel = "已暂停";
      title = "已暂停";
    }

    return {
      state,
      type,
      priority,
      reason,
      reasonLabel,
      title,
      summary: "",
      actionKind: "",
      actionLabel: "",
      observedAt: "",
      source: {},
      typeLabel: getAttentionTypeLabel(type, ""),
      className: attentionStateClassNames[state] || "",
      fallback: true,
      legacyBand,
    };
  }

  function getSessionAttention(session) {
    const raw = session?.attention;
    if (raw && typeof raw === "object") {
      const state = normalizeAttentionState(raw.state);
      const type = normalizeAttentionType(raw.type);
      if (state && type) {
        const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
        if (state === "done" && type === "completed" && !shouldSurfaceCompletedAttention(session)) {
          const passiveCompleted = buildLegacySessionAttention(session);
          passiveCompleted.state = "idle";
          passiveCompleted.priority = "low";
          passiveCompleted.reason = reason || passiveCompleted.reason;
          passiveCompleted.reasonLabel = "";
          passiveCompleted.className = attentionStateClassNames.idle || "";
          passiveCompleted.legacyBand = getSessionAttentionBand(session);
          return passiveCompleted;
        }
        if (isWaitingUserReviewDismissible(session) && (state === "needs_you_now" || state === "blocked")) {
          return buildLegacySessionAttention(session);
        }
        return {
          ...raw,
          state,
          type,
          priority: normalizeAttentionPriority(raw.priority) || "medium",
          reason,
          reasonLabel: typeof raw.reasonLabel === "string" ? raw.reasonLabel.trim() : "",
          title: typeof raw.title === "string" ? raw.title.trim() : "",
          summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
          actionKind: typeof raw.actionKind === "string" ? raw.actionKind.trim() : "",
          actionLabel: typeof raw.actionLabel === "string" ? raw.actionLabel.trim() : "",
          observedAt: typeof raw.observedAt === "string" ? raw.observedAt : "",
          source: raw.source && typeof raw.source === "object" ? { ...raw.source } : {},
          typeLabel: getAttentionTypeLabel(type, ""),
          className: attentionStateClassNames[state] || "",
          fallback: false,
          legacyBand: null,
        };
      }
    }
    return buildLegacySessionAttention(session);
  }

  function compareSessionAttention(a, b) {
    const aAttention = getSessionAttention(a);
    const bAttention = getSessionAttention(b);

    if (aAttention?.fallback && bAttention?.fallback) {
      return (aAttention.legacyBand || 0) - (bAttention.legacyBand || 0);
    }

    const stateDiff = getAttentionStateRank(aAttention?.state) - getAttentionStateRank(bAttention?.state);
    if (stateDiff) return stateDiff;

    const priorityDiff = getAttentionPriorityRank(bAttention?.priority) - getAttentionPriorityRank(aAttention?.priority);
    if (priorityDiff) return priorityDiff;

    if (aAttention?.fallback || bAttention?.fallback) {
      const aBand = Number.isInteger(aAttention?.legacyBand) ? aAttention.legacyBand : getSessionAttentionBand(a);
      const bBand = Number.isInteger(bAttention?.legacyBand) ? bAttention.legacyBand : getSessionAttentionBand(b);
      const bandDiff = aBand - bBand;
      if (bandDiff) return bandDiff;
    }

    return 0;
  }

  function compareSessionListSessions(a, b) {
    const attentionDiff = compareSessionAttention(a, b);
    if (attentionDiff) return attentionDiff;

    const priorityDiff = (getSessionWorkflowPriority(b)?.rank || 0) - (getSessionWorkflowPriority(a)?.rank || 0);
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
    getEffectiveSessionReviewedAt,
    hasSessionUnreadUpdate,
    hasSessionUnreadCompletion,
    getSessionReviewStatusInfo,
    isSessionCompleted,
    isSessionCompletedAndReviewed,
    isSessionCompleteAndReviewed,
    shouldSurfaceCompletedAttention,
    isWaitingUserReviewDismissible,
    getSessionAttention,
    getAttentionTypeLabel,
    getSessionWorkflowPriority,
    compareSessionListSessions,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
