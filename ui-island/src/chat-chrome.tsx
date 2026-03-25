import { createRoot } from "react-dom/client";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  GitFork,
  SendHorizontal,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import "./chat-chrome.css";

type ParallelTask = {
  title?: string;
  task?: string;
  boundary?: string;
  repo?: string;
};

type Conclusion = {
  id: string;
  label?: string;
  status?: string;
  summary?: string;
  sourceSessionName?: string;
  handledAt?: string;
  payload?: {
    confidence?: string;
    recommendation?: string;
    parallelTasks?: ParallelTask[];
  } | null;
};

type WorkflowSuggestion = {
  type?: string;
  title?: string;
  body?: string;
} | null;

type ChromeState = {
  title?: string;
  statusLabel?: string;
  currentSessionId?: string;
  visitorMode?: boolean;
  summary?: {
    currentTask?: string;
    suggestion?: WorkflowSuggestion;
    workflowStatus?: string;
    activeVerification?: {
      id: string;
      name: string;
      kind?: string;
      runState: string;
    } | null;
    pending?: Conclusion[];
    decisions?: Conclusion[];
    handled?: Conclusion[];
  } | null;
  actions?: {
    fork?: { visible?: boolean; disabled?: boolean };
    share?: { visible?: boolean; disabled?: boolean };
    handoff?: { visible?: boolean; disabled?: boolean };
  };
};

type WorkflowTaskInput = {
  goal: string;
  project: string;
  constraints: string;
  progress: string;
  concern: string;
  preference: string;
};

type WorkflowOpenDetail = {
  input?: Partial<WorkflowTaskInput>;
} | null;

type ResolvedTheme = "light" | "dark";

declare global {
  interface Window {
    remotelabChromeBridge?: {
      getState: () => ChromeState;
      subscribe: (listener: (state: ChromeState) => void) => () => void;
      actions: {
        fork: () => Promise<void> | void;
        share: () => Promise<void> | void;
        handoff: () => Promise<void> | void;
        workflowConclusionStatus?: (conclusionId: string, status: string) => Promise<void> | void;
        acceptWorkflowSuggestion?: () => Promise<void> | void;
        dismissWorkflowSuggestion?: () => Promise<void> | void;
        createParallelSessionsFromConclusion?: (conclusionId: string) => Promise<void> | void;
      };
    };
    remotelabToastBridge?: {
      show: (
        message: string,
        tone?: "success" | "error" | "neutral",
        options?: {
          position?: "top-center" | "bottom-center";
          className?: string;
        },
      ) => void;
    };
    remotelabCodexImportBridge?: {
      open: (options?: { required?: boolean }) => Promise<string | null>;
    };
    remotelabWorkflowBridge?: {
      getSeedInput?: () => Partial<WorkflowTaskInput>;
      ensureAppsLoaded?: () => Promise<unknown>;
      startTask?: (options: {
        input: WorkflowTaskInput;
        kickoffMessage: string;
        successToast: string;
      }) => Promise<unknown>;
    };
    remotelabComposerBridge?: {
      focusWorkflowEntry?: (options?: { placeholder?: string }) => boolean;
    };
    RemoteLabTheme?: {
      getTheme?: () => string;
      subscribe?: (listener: (detail: { preference?: string; theme?: string }) => void) => () => void;
    };
    openWorkflowTaskDialog?: (detail?: WorkflowOpenDetail) => boolean;
  }
}

const WORKFLOW_OPEN_EVENT = "remotelab:workflow-task-open";
const WORKFLOW_START_SUCCESS_TOAST = "任务已开始";
const EMPTY_WORKFLOW_INPUT: WorkflowTaskInput = {
  goal: "",
  project: "",
  constraints: "",
  progress: "",
  concern: "",
  preference: "",
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildWorkflowTaskInput(
  seed: Partial<WorkflowTaskInput> = {},
  override: Partial<WorkflowTaskInput> = {},
): WorkflowTaskInput {
  return {
    goal: normalizeText(override.goal ?? seed.goal),
    project: normalizeText(override.project ?? seed.project),
    constraints: normalizeText(override.constraints ?? seed.constraints),
    progress: normalizeText(override.progress ?? seed.progress),
    concern: normalizeText(override.concern ?? seed.concern),
    preference: normalizeText(override.preference ?? seed.preference),
  };
}

function buildWorkflowKickoffMessage(input: WorkflowTaskInput) {
  const sections = [
    `目标：${input.goal}`,
    input.project ? `项目/仓库：${input.project}` : "",
    input.constraints ? `边界 / 不能动：${input.constraints}` : "",
    input.progress ? `当前进展：${input.progress}` : "",
    input.concern ? `我最担心：${input.concern}` : "",
    input.preference ? `我当前倾向：${input.preference}` : "",
    "请先判断最合适的推进方式：任务边界清晰就直接推进；如果存在方向取舍、拆分必要性或明显风险，请先收敛再继续。",
  ].filter(Boolean);
  return sections.join("\n");
}

async function startWorkflowTaskFromInput(input: WorkflowTaskInput) {
  const kickoffMessage = buildWorkflowKickoffMessage(input);
  if (!window.remotelabWorkflowBridge?.startTask) {
    window.remotelabToastBridge?.show("任务入口尚未就绪", "error");
    throw new Error("任务入口尚未就绪");
  }
  await window.remotelabWorkflowBridge.startTask({
    input,
    kickoffMessage,
    successToast: WORKFLOW_START_SUCCESS_TOAST,
  });
}

function emitWorkflowTaskOpen(detail: WorkflowOpenDetail = null) {
  window.dispatchEvent(new CustomEvent(WORKFLOW_OPEN_EVENT, { detail }));
}

window.openWorkflowTaskDialog = (detail = null) => {
  emitWorkflowTaskOpen(detail);
  return true;
};

function useChromeState() {
  const [state, setState] = useState<ChromeState>(() => window.remotelabChromeBridge?.getState?.() || {});

  useEffect(() => {
    if (!window.remotelabChromeBridge?.subscribe) return;
    return window.remotelabChromeBridge.subscribe((next) => {
      setState(next || {});
    });
  }, []);

  return state;
}

function getStatusButtonTitle(summary: ChromeState["summary"]) {
  const decisionCount = summary?.decisions?.length || 0;
  const pendingCount = summary?.pending?.length || 0;
  if (decisionCount > 0) return "任务状态：有待决策事项";
  if (pendingCount > 0) return "任务状态：有待处理事项";
  return "任务状态";
}

function getStatusButtonDescription(summary: ChromeState["summary"]) {
  const pending = summary?.pending || [];
  const decisions = summary?.decisions || [];
  const handled = summary?.handled || [];
  const suggestion = summary?.suggestion || null;
  const currentTask = normalizeText(summary?.currentTask);
  const parts: string[] = [];
  if (suggestion) parts.push("有系统建议");
  if (decisions.length > 0) parts.push(`${decisions.length} 条待决策`);
  if (pending.length > 0) parts.push(`${pending.length} 条待处理`);
  if (!parts.length && handled.length > 0) parts.push(`最近已处理 ${handled.length} 条`);
  const lead = normalizeText(decisions[0]?.summary || pending[0]?.summary || handled[0]?.summary);
  const detail = parts.length && lead
    ? `${parts.join("，")}，${lead}`
    : (parts.join("，") || lead || "暂无新的摘要通知");
  if (currentTask) return `${currentTask} · ${detail}`;
  return detail;
}

function getConclusionLabel(conclusion: Conclusion) {
  return normalizeText(conclusion.label) || "结果转交";
}

function getConclusionSource(conclusion: Conclusion) {
  return normalizeText(conclusion.sourceSessionName) || "辅助会话";
}

function getConclusionTone(status?: string) {
  if (status === "accepted") return "success";
  if (status === "ignored") return "muted";
  if (status === "needs_decision") return "notice";
  return "neutral";
}

function getConclusionParallelTasks(conclusion: Conclusion) {
  const tasks = Array.isArray(conclusion?.payload?.parallelTasks) ? conclusion.payload.parallelTasks : [];
  return tasks
    .map((task, index) => {
      if (!task || typeof task !== "object") return null;
      const title = normalizeText(task.title) || `并行子任务 ${index + 1}`;
      const taskText = normalizeText(task.task);
      const boundary = normalizeText(task.boundary);
      const repo = normalizeText(task.repo);
      return {
        title,
        ...(taskText ? { task: taskText } : {}),
        ...(boundary ? { boundary } : {}),
        ...(repo ? { repo } : {}),
      };
    })
    .filter(Boolean) as ParallelTask[];
}

function getRecommendationBadge(conclusion: Conclusion): { text: string; className: string } | null {
  const rec = conclusion?.payload?.recommendation;
  if (!rec || typeof rec !== "string") return null;
  const normalized = rec.trim().toLowerCase();
  if (normalized === "ok") return { text: "验收通过", className: "chrome-status-badge-success" };
  if (normalized === "needs_fix") return { text: "需要修复", className: "chrome-status-badge-warning" };
  if (normalized === "needs_more_validation") return { text: "需要补充验证", className: "chrome-status-badge-error" };
  if (normalized === "accept") return { text: "验收通过", className: "chrome-status-badge-success" };
  if (normalized === "revise") return { text: "需要修复", className: "chrome-status-badge-warning" };
  if (normalized === "reject") return { text: "验收未通过", className: "chrome-status-badge-error" };
  return { text: rec, className: "chrome-status-badge-neutral" };
}

function getRunStateBadgeInfo(runState?: string): { text: string; className: string } {
  const normalized = normalizeText(runState).toLowerCase();
  if (normalized === "running") return { text: "运行中", className: "chrome-status-badge-success" };
  if (normalized === "completed") return { text: "已完成", className: "chrome-status-badge-success" };
  if (normalized === "failed") return { text: "失败", className: "chrome-status-badge-error" };
  return { text: "等待中", className: "chrome-status-badge-notice" };
}

function WorkflowStatusButton({
  summary,
}: {
  summary: ChromeState["summary"];
}) {
  const pending = summary?.pending || [];
  const decisions = summary?.decisions || [];
  const handled = summary?.handled || [];
  const suggestion = summary?.suggestion || null;
  const currentTask = normalizeText(summary?.currentTask) || "当前暂无任务摘要";
  const latestHandled = handled[0] || null;
  const hasNotice = !!suggestion || decisions.length > 0 || pending.length > 0;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);

  useEffect(() => {
    function syncViewportMode() {
      setIsMobile(window.innerWidth <= 640);
    }

    syncViewportMode();
    window.addEventListener("resize", syncViewportMode);
    return () => window.removeEventListener("resize", syncViewportMode);
  }, []);

  async function handleConclusionAction(conclusionId: string, status: string) {
    const run = window.remotelabChromeBridge?.actions?.workflowConclusionStatus;
    if (!run || busyKey) return;
    const nextKey = `conclusion:${conclusionId}:${status}`;
    try {
      setBusyKey(nextKey);
      await run(conclusionId, status);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSuggestionAction(action: "accept" | "dismiss") {
    const run = action === "accept"
      ? window.remotelabChromeBridge?.actions?.acceptWorkflowSuggestion
      : window.remotelabChromeBridge?.actions?.dismissWorkflowSuggestion;
    if (!run || busyKey) return;
    try {
      setBusyKey(`suggestion:${action}`);
      await run();
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateParallelSessions(conclusionId: string) {
    const run = window.remotelabChromeBridge?.actions?.createParallelSessionsFromConclusion;
    if (!run || busyKey) return;
    try {
      setBusyKey(`parallel:${conclusionId}`);
      await run(conclusionId);
    } finally {
      setBusyKey(null);
    }
  }

  const triggerButton = (
    <Button
      variant="ghost"
      size="icon"
      className={`chrome-action-button ${hasNotice ? "chrome-action-button-notice" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text)]"}`}
      title={`${getStatusButtonTitle(summary)} · ${getStatusButtonDescription(summary)}`}
      aria-label={`${getStatusButtonTitle(summary)} · ${getStatusButtonDescription(summary)}`}
      onClick={isMobile ? () => setMobileOpen(true) : undefined}
    >
      <Bell className="size-4" strokeWidth={1.8} />
      {hasNotice ? <span className="chrome-action-dot" /> : null}
    </Button>
  );

  const panelContent = (
        <div className="chrome-status-scroll">
          <section className="chrome-status-zone">
            <div className="chrome-status-zone-title">当前任务</div>
            <div className="chrome-status-task-row">
              <div className="chrome-status-task">{currentTask}</div>
            </div>
            {latestHandled?.summary ? (
              <div className="chrome-status-task-meta">
                最近进展：{normalizeText(latestHandled.summary)}
              </div>
            ) : null}
          </section>

          {summary?.activeVerification ? (
            <section className="chrome-status-zone">
              <div className="chrome-status-zone-title">
                {summary.activeVerification.kind === "deliberation" ? "再议进度" : "验收进度"}
              </div>
              <div className="chrome-status-task-row chrome-status-task-row-compact">
                <div className="chrome-status-task">{summary.activeVerification.name}</div>
                {(() => {
                  const runStateBadge = getRunStateBadgeInfo(summary.activeVerification.runState);
                  return (
                    <Badge variant="outline" className={`chrome-status-badge ${runStateBadge.className}`}>
                      {runStateBadge.text}
                    </Badge>
                  );
                })()}
              </div>
            </section>
          ) : null}

      {(suggestion || decisions.length > 0 || pending.length > 0) ? (
            <section className="chrome-status-zone">
              <div className="chrome-status-zone-title">需要你处理</div>

              {suggestion ? (
                <div className="chrome-status-card chrome-status-suggestion">
                  <div className="chrome-status-card-eyebrow">建议下一步</div>
                  <div className="chrome-status-card-title">
                    {normalizeText(suggestion.title) || "建议继续推进工作流"}
                  </div>
                  <div className="chrome-status-card-text">
                    {normalizeText(suggestion.body) || "系统建议你进入下一步工作流。"}
                  </div>
                  <div className="chrome-status-card-actions">
                    <Button
                      size="sm"
                      className="chrome-status-card-btn chrome-status-primary-btn"
                      disabled={busyKey !== null}
                      onClick={() => void handleSuggestionAction("accept")}
                    >
                      {suggestion.type === "suggest_decision" ? "开启再议（自动开始）" : "开启验收（自动开始）"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="chrome-status-card-btn"
                      disabled={busyKey !== null}
                      onClick={() => void handleSuggestionAction("dismiss")}
                    >
                      暂时跳过
                    </Button>
                  </div>
                </div>
              ) : null}

              {[...decisions, ...pending].slice(0, 2).map((conclusion) => {
                const busyPrefix = `conclusion:${conclusion.id}:`;
                const parallelTasks = getConclusionParallelTasks(conclusion);
                return (
                  <div key={conclusion.id} className="chrome-status-card chrome-status-conclusion">
                    <div className="chrome-status-card-meta">
                      <Badge variant="secondary" className="chrome-status-badge">
                        {getConclusionLabel(conclusion)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`chrome-status-badge chrome-status-badge-${getConclusionTone(conclusion.status)}`}
                      >
                        {normalizeText(conclusion.status === "needs_decision" ? "待决策" : "待处理")}
                      </Badge>
                      <span className="chrome-status-card-source">来自 {getConclusionSource(conclusion)}</span>
                    </div>
                    {(() => {
                      const recBadge = getRecommendationBadge(conclusion);
                      if (!recBadge) return null;
                      return (
                        <Badge variant="outline" className={`chrome-status-badge ${recBadge.className}`}>
                          {recBadge.text}
                        </Badge>
                      );
                    })()}
                    <div className="chrome-status-card-text">
                      {normalizeText(conclusion.summary) || "暂无摘要"}
                    </div>
                    {parallelTasks.length > 0 ? (
                      <div className="chrome-status-parallel-list">
                        {parallelTasks.map((task, index) => (
                          <div key={`${conclusion.id}-parallel-${index}`} className="chrome-status-parallel-item">
                            <div className="chrome-status-parallel-title">{normalizeText(task.title) || `并行子任务 ${index + 1}`}</div>
                            {normalizeText(task.task) ? (
                              <div className="chrome-status-parallel-meta">{normalizeText(task.task)}</div>
                            ) : null}
                            {normalizeText(task.boundary) ? (
                              <div className="chrome-status-parallel-meta">边界：{normalizeText(task.boundary)}</div>
                            ) : null}
                            {normalizeText(task.repo) ? (
                              <div className="chrome-status-parallel-meta">仓库：{normalizeText(task.repo)}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="chrome-status-card-actions">
                      {parallelTasks.length > 0 ? (
                        <Button
                          size="sm"
                          className="chrome-status-card-btn chrome-status-primary-btn"
                          disabled={busyKey !== null}
                          onClick={() => void handleCreateParallelSessions(conclusion.id)}
                        >
                          创建 {parallelTasks.length} 个并行 session
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        className="chrome-status-card-btn"
                        disabled={busyKey !== null}
                        onClick={() => void handleConclusionAction(conclusion.id, "accepted")}
                      >
                        接受
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="chrome-status-card-btn"
                        disabled={busyKey !== null}
                        onClick={() => void handleConclusionAction(conclusion.id, "ignored")}
                      >
                        忽略
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="chrome-status-card-btn"
                        disabled={busyKey !== null || busyKey === `${busyPrefix}pending`}
                        onClick={() => void handleConclusionAction(conclusion.id, "pending")}
                      >
                        稍后
                      </Button>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

        </div>
  );

  if (isMobile) {
    return (
      <>
        {triggerButton}
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogContent className="chrome-status-dialog">
            {panelContent}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {triggerButton}
      </PopoverTrigger>
      <PopoverContent className="chrome-status-popover" align="center" sideOffset={12}>
        {panelContent}
      </PopoverContent>
    </Popover>
  );
}

function resolveCurrentTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  const theme = window.RemoteLabTheme?.getTheme?.() || document.documentElement.dataset.theme || "light";
  return theme === "dark" ? "dark" : "light";
}

function HeaderActions() {
  const state = useChromeState();
  const [busy, setBusy] = useState<null | "fork" | "share" | "handoff">(null);
  const summary = state.summary || null;
  const actions = state.actions || {};

  const actionDefs = useMemo(
    () => [
      {
        key: "handoff" as const,
        visible: actions.handoff?.visible,
        disabled: actions.handoff?.disabled,
        label: "转交",
        icon: SendHorizontal,
        run: () => window.remotelabChromeBridge?.actions?.handoff?.(),
      },
      {
        key: "fork" as const,
        visible: actions.fork?.visible,
        disabled: actions.fork?.disabled,
        label: "Fork",
        icon: GitFork,
        run: () => window.remotelabChromeBridge?.actions?.fork?.(),
      },
      {
        key: "share" as const,
        visible: actions.share?.visible,
        disabled: actions.share?.disabled,
        label: "Share",
        icon: Share2,
        run: () => window.remotelabChromeBridge?.actions?.share?.(),
      },
    ],
    [actions],
  );

  async function handleAction(key: "fork" | "share" | "handoff", run?: () => Promise<void> | void) {
    if (!run || busy) return;
    try {
      setBusy(key);
      await run();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {summary ? <WorkflowStatusButton summary={summary} /> : null}
      {actionDefs
        .filter((entry) => entry.visible)
        .map((entry) => {
          const Icon = entry.icon;
          return (
            <Button
              key={entry.key}
              variant="ghost"
              size="icon"
              className="chrome-action-button text-[color:var(--text-secondary)] hover:text-[color:var(--text)]"
              title={entry.label}
              aria-label={entry.label}
              disabled={busy !== null || entry.disabled}
              onClick={() => void handleAction(entry.key, entry.run)}
            >
              <Icon className="size-4" strokeWidth={1.8} />
            </Button>
          );
        })}
    </div>
  );
}

function CodexImportDialog() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resolverRef = useRef<((value: string | null) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [required, setRequired] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [status, setStatus] = useState("");

  function finish(result: string | null) {
    setOpen(false);
    const resolver = resolverRef.current;
    resolverRef.current = null;
    if (resolver) resolver(result);
  }

  useEffect(() => {
    window.remotelabCodexImportBridge = {
      open(options = {}) {
        if (resolverRef.current) {
          resolverRef.current(null);
          resolverRef.current = null;
        }
        const isRequired = options.required === true;
        setRequired(isRequired);
        setThreadId("");
        setStatus("");
        setOpen(true);
        return new Promise((resolve) => {
          resolverRef.current = resolve;
        });
      },
    };

    return () => {
      if (resolverRef.current) {
        resolverRef.current(null);
        resolverRef.current = null;
      }
      delete window.remotelabCodexImportBridge;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [open]);

  function handleConfirm() {
    const value = normalizeText(threadId);
    if (required && !value) {
      setStatus("请输入要导入的 Codex thread id。");
      inputRef.current?.focus();
      return;
    }
    finish(value);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(null);
      }}
    >
      <DialogContent className="codex-import-dialog">
        <DialogHeader className="codex-import-dialog-header">
          <DialogTitle className="codex-import-dialog-title">{required ? "导入会话" : "连接会话"}</DialogTitle>
        </DialogHeader>
        <div className="codex-import-dialog-body">
          <div className="codex-import-dialog-field">
            <Label className="codex-import-dialog-label" htmlFor="codex-import-thread-id">Codex thread id</Label>
            <Input
              id="codex-import-thread-id"
              ref={inputRef}
              value={threadId}
              onChange={(event) => setThreadId(event.target.value)}
              placeholder="请输入要连接的 Codex thread id，例如 019d1194-31c3-7271-bda6-6f78311b198d"
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                handleConfirm();
              }}
            />
          </div>
          {status ? <div className="codex-import-dialog-note">{status}</div> : null}
        </div>
        <DialogFooter className="codex-import-dialog-footer">
          <Button variant="outline" onClick={() => finish(null)}>
            取消
          </Button>
          <Button variant="default" className="codex-import-dialog-primary" onClick={handleConfirm}>
            {required ? "导入会话" : "继续"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowTaskFormFields({
  input,
  onFieldChange,
  showOptionalFields,
  onShowOptionalFieldsChange,
  idPrefix,
  className,
  placeholders,
  includeSystemDefaultNote = false,
}: {
  input: WorkflowTaskInput;
  onFieldChange: (key: keyof WorkflowTaskInput, value: string) => void;
  showOptionalFields: boolean;
  onShowOptionalFieldsChange: (next: boolean) => void;
  idPrefix: string;
  className?: string;
  placeholders?: Partial<Record<keyof WorkflowTaskInput, string>>;
  includeSystemDefaultNote?: boolean;
}) {
  const resolvedClassName = ["workflow-task-form", className].filter(Boolean).join(" ");
  const fieldId = (key: keyof WorkflowTaskInput) => `${idPrefix}-${key}`;
  const fieldPlaceholder = (key: keyof WorkflowTaskInput, fallback: string) => normalizeText(placeholders?.[key]) || fallback;

  return (
    <div className={resolvedClassName}>
      <div className="workflow-task-field">
        <Label className="workflow-task-label" htmlFor={fieldId("goal")}>目标</Label>
        <Textarea
          id={fieldId("goal")}
          className="workflow-task-textarea-main"
          rows={3}
          placeholder={fieldPlaceholder("goal", "例如：修复移动端登录按钮无响应，并补上回归验证")}
          value={input.goal}
          onChange={(event) => onFieldChange("goal", event.target.value)}
        />
      </div>
      <div className="workflow-task-field">
        <Label className="workflow-task-label" htmlFor={fieldId("project")}>项目</Label>
        <Input
          id={fieldId("project")}
          placeholder={fieldPlaceholder("project", "例如：/path/to/remotelab")}
          value={input.project}
          onChange={(event) => onFieldChange("project", event.target.value)}
        />
      </div>
      <div className="workflow-task-field">
        <Label className="workflow-task-label" htmlFor={fieldId("constraints")}>边界</Label>
        <Textarea
          id={fieldId("constraints")}
          className="workflow-task-textarea-compact"
          rows={3}
          placeholder={fieldPlaceholder("constraints", "例如：不改接口、不改数据库结构，这次先不做重构")}
          value={input.constraints}
          onChange={(event) => onFieldChange("constraints", event.target.value)}
        />
      </div>
      <div className="workflow-task-field">
        <Label className="workflow-task-label" htmlFor={fieldId("progress")}>进展</Label>
        <Textarea
          id={fieldId("progress")}
          className="workflow-task-textarea-compact"
          rows={3}
          placeholder={fieldPlaceholder("progress", "例如：已经定位到问题，还没开始改；或第一版已经提测")}
          value={input.progress}
          onChange={(event) => onFieldChange("progress", event.target.value)}
        />
      </div>
      <Collapsible
        open={showOptionalFields}
        onOpenChange={onShowOptionalFieldsChange}
        className="workflow-task-collapsible"
      >
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="workflow-task-collapsible-trigger">
            <span>补充信息（选填）</span>
            <ChevronDown
              className={`workflow-task-collapsible-icon${showOptionalFields ? " is-open" : ""}`}
              strokeWidth={1.8}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="workflow-task-collapsible-content">
          <div className="workflow-task-field">
            <Label className="workflow-task-label" htmlFor={fieldId("concern")}>我最担心</Label>
            <Textarea
              id={fieldId("concern")}
              className="workflow-task-textarea-compact"
              rows={3}
              placeholder={fieldPlaceholder("concern", "例如：担心影响现有会话流程、移动端布局或已有接口兼容")}
              value={input.concern}
              onChange={(event) => onFieldChange("concern", event.target.value)}
            />
          </div>
          <div className="workflow-task-field">
            <Label className="workflow-task-label" htmlFor={fieldId("preference")}>我当前倾向</Label>
            <Textarea
              id={fieldId("preference")}
              className="workflow-task-textarea-compact"
              rows={3}
              placeholder={fieldPlaceholder("preference", "例如：先做最小改动修复，确认稳定后再考虑扩展")}
              value={input.preference}
              onChange={(event) => onFieldChange("preference", event.target.value)}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {includeSystemDefaultNote ? (
        <div className="workflow-task-field">
          <Label className="workflow-task-label">系统默认行为</Label>
          <div className="workflow-task-system-note">
            系统会自动推进确定性高的步骤；遇到关键取舍、范围扩张或低置信度结果时，才会停下来让你拍板。
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowTaskDialog() {
  const [open, setOpen] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [starting, setStarting] = useState(false);
  const [input, setInput] = useState<WorkflowTaskInput>(EMPTY_WORKFLOW_INPUT);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<WorkflowOpenDetail>).detail || null;
      const seedInput = window.remotelabWorkflowBridge?.getSeedInput?.() || {};
      setInput(buildWorkflowTaskInput(seedInput, detail?.input || {}));
      setShowOptionalFields(false);
      setStarting(false);
      setOpen(true);
      void window.remotelabWorkflowBridge?.ensureAppsLoaded?.();
    }

    window.addEventListener(WORKFLOW_OPEN_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_OPEN_EVENT, handleOpen as EventListener);
    };
  }, []);

  function updateField(key: keyof WorkflowTaskInput, value: string) {
    setInput((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleStart() {
    if (!normalizeText(input.goal)) {
      return;
    }
    try {
      setStarting(true);
      await startWorkflowTaskFromInput(input);
      setOpen(false);
      setShowOptionalFields(false);
      setInput(EMPTY_WORKFLOW_INPUT);
    } catch (error) {
      window.remotelabToastBridge?.show(
        error instanceof Error ? error.message : "开始任务失败",
        "error",
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="workflow-task-dialog">
        <DialogHeader className="workflow-task-dialog-header">
          <DialogTitle className="workflow-task-dialog-title">开始任务</DialogTitle>
        </DialogHeader>
        <div className="workflow-task-dialog-body">
          <Card className="workflow-task-surface">
            <CardHeader className="workflow-task-card-header">
              <CardTitle>任务信息</CardTitle>
            </CardHeader>
            <CardContent className="workflow-task-card-content">
              <WorkflowTaskFormFields
                input={input}
                onFieldChange={updateField}
                showOptionalFields={showOptionalFields}
                onShowOptionalFieldsChange={setShowOptionalFields}
                idPrefix="workflow-task"
                placeholders={{
                  goal: "例如：修复移动端登录按钮无响应，并补上回归验证",
                  project: "例如：/path/to/remotelab",
                  constraints: "例如：不改接口、不改数据库结构，这次先不做重构",
                  progress: "例如：已经定位到问题，还没开始改；或第一版已经提测",
                  concern: "例如：担心影响现有会话流程、移动端布局或已有接口兼容",
                  preference: "例如：先做最小改动修复，确认稳定后再考虑扩展",
                }}
                includeSystemDefaultNote
              />
            </CardContent>
          </Card>
        </div>
        <DialogFooter className="workflow-task-dialog-footer">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={starting}>
            取消
          </Button>
          <Button
            variant="default"
            onClick={() => void handleStart()}
            disabled={starting || !normalizeText(input.goal)}
          >
            {starting ? "正在开始…" : "开始任务"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function App() {
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveCurrentTheme());

  useEffect(() => {
    function handleThemeChange(event: Event) {
      const detail = (event as CustomEvent<{ theme?: string }>).detail;
      setTheme(detail?.theme === "dark" ? "dark" : resolveCurrentTheme());
    }

    const unsubscribe = window.RemoteLabTheme?.subscribe?.((detail) => {
      setTheme(detail?.theme === "dark" ? "dark" : "light");
    });

    document.addEventListener("remotelab:theme-change", handleThemeChange as EventListener);
    setTheme(resolveCurrentTheme());

    return () => {
      unsubscribe?.();
      document.removeEventListener("remotelab:theme-change", handleThemeChange as EventListener);
    };
  }, []);

  return (
    <>
      <HeaderActions />
      <CodexImportDialog />
      <WorkflowTaskDialog />
      <Toaster theme={theme} />
    </>
  );
}

function mountRoot(id: string, element: ReactElement) {
  const mount = document.getElementById(id);
  if (!mount) return;
  createRoot(mount).render(element);
}

mountRoot("chatChromeRoot", <App />);

window.remotelabToastBridge = {
  show(message, tone = "neutral", options = {}) {
    if (!message) return;
    const toastOptions = {
      position: options.position,
      className: options.className,
    };
    if (tone === "success") {
      toast.success(message, toastOptions);
      return;
    }
    if (tone === "error") {
      toast.error(message, toastOptions);
      return;
    }
    toast(message, toastOptions);
  },
};
