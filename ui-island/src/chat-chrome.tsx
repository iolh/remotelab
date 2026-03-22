import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  GitBranch,
  GitFork,
  Play,
  SendHorizontal,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import "./chat-chrome.css";

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
  } | null;
};

type ChromeState = {
  title?: string;
  statusLabel?: string;
  currentSessionId?: string;
  visitorMode?: boolean;
  summary?: {
    currentTask?: string;
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

type WorkflowModeKey =
  | "quick_execute"
  | "standard_delivery"
  | "careful_deliberation"
  | "parallel_split";

type WorkflowModeConfig = {
  key: WorkflowModeKey;
  label: string;
  title: string;
  reason: string;
  flow: string[];
  plan: string[];
  successToast: string;
  appRole: "execute" | "deliberate";
};

type WorkflowOpenDetail = {
  revealManual?: boolean;
} | null;

declare global {
  interface Window {
    remotelabChromeBridge?: {
      getState: () => ChromeState;
      subscribe: (listener: (state: ChromeState) => void) => () => void;
      actions: {
        fork: () => Promise<void> | void;
        share: () => Promise<void> | void;
        handoff: () => Promise<void> | void;
      };
    };
    remotelabToastBridge?: {
      show: (message: string, tone?: "success" | "error" | "neutral") => void;
    };
    remotelabWorkflowBridge?: {
      getSeedInput?: () => Partial<WorkflowTaskInput>;
      ensureAppsLoaded?: () => Promise<unknown>;
      getAppAliases?: () => {
        execute?: string[];
        verify?: string[];
        deliberate?: string[];
      };
      startTask?: (options: {
        appNames: string[];
        input: WorkflowTaskInput;
        kickoffMessage: string;
        successToast: string;
      }) => Promise<unknown>;
    };
    openWorkflowTaskIntakeModal?: (options?: { revealManual?: boolean }) => boolean;
    openWorkflowTaskIntakeManualMode?: () => boolean;
  }
}

const WORKFLOW_OPEN_EVENT = "remotelab:workflow-intake-open";
const EMPTY_WORKFLOW_INPUT: WorkflowTaskInput = {
  goal: "",
  project: "",
  constraints: "",
  progress: "",
  concern: "",
  preference: "",
};

const APP_ALIAS_FALLBACK = {
  execute: ["执行", "主交付", "功能交付"],
  verify: ["验收", "执行验收", "风险复核"],
  deliberate: ["再议", "深度裁决", "PR把关", "合并", "发布把关", "推敲"],
};

const WORKFLOW_MODES: Record<WorkflowModeKey, WorkflowModeConfig> = {
  quick_execute: {
    key: "quick_execute",
    label: "快速执行",
    title: "直接进入执行，尽快把低风险任务做完。",
    reason: "这次任务边界清楚、改动范围小，先直接做更高效。",
    flow: ["执行"],
    plan: [
      "创建 1 条执行主线",
      "自动带上任务背景并直接开工",
      "完成后由主线自行收口",
    ],
    successToast: "已按快速执行开始",
    appRole: "execute",
  },
  standard_delivery: {
    key: "standard_delivery",
    label: "标准交付",
    title: "先创建执行主线，做完首轮后再建议进入验收。",
    reason: "这是最稳的默认路径，适合大多数日常需求和常规 bug 修复。",
    flow: ["执行", "验收", "执行收口"],
    plan: [
      "先创建执行主线并自动带上任务背景",
      "这轮实现完成后，系统会在主线里建议你开启验收",
      "验收结果会通过既有 typed handoff 转回主线",
    ],
    successToast: "已按标准交付开始",
    appRole: "execute",
  },
  careful_deliberation: {
    key: "careful_deliberation",
    label: "审慎模式",
    title: "先创建再议主线，把方向和取舍判清，再进入执行。",
    reason: "这次任务存在明显的不确定性或代价较高的判断，先把方向收敛会更稳。",
    flow: ["再议", "执行", "验收"],
    plan: [
      "先创建再议会话，自动带上当前问题、约束和倾向",
      "由再议给出推荐路径、放弃路径和需要你拍板的点",
      "你拍板后，再进入执行和后续验收",
    ],
    successToast: "已按审慎模式开始",
    appRole: "deliberate",
  },
  parallel_split: {
    key: "parallel_split",
    label: "并行推进",
    title: "先创建再议主线，判断是否值得拆成支线并行。",
    reason: "你已经给出了明显的并行线索，这次更适合先做拆分判断，再决定支线和 worktree 边界。",
    flow: ["再议", "执行主线", "执行支线", "验收"],
    plan: [
      "先创建再议会话，判断是否值得并行",
      "如果值得，再由主线决定支线边界和并行方式",
      "避免一上来就把任务拆乱",
    ],
    successToast: "已按并行推进开始",
    appRole: "deliberate",
  },
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getAppAliases(role: keyof typeof APP_ALIAS_FALLBACK) {
  const bridgeAliases = window.remotelabWorkflowBridge?.getAppAliases?.();
  const names = bridgeAliases?.[role];
  return Array.isArray(names) && names.length > 0 ? names : APP_ALIAS_FALLBACK[role];
}

function buildTaskSignalText(input: WorkflowTaskInput) {
  return [
    input.goal,
    input.constraints,
    input.progress,
    input.concern,
    input.preference,
  ]
    .filter(Boolean)
    .join(" ");
}

function recommendWorkflowMode(input: WorkflowTaskInput) {
  const joined = buildTaskSignalText(input);
  const hasConcern = !!input.concern;
  const hasPreference = !!input.preference;
  const hasProgress = !!input.progress;
  const deliberationHint = /(重构|迁移|架构|方案|冲突|取舍|跨模块|不确定|心里没底|争议|兼容|风险|评审|裁决)/iu.test(joined);
  const parallelHint = /(并行|拆分|支线|分支|worktree|多模块|多页面|同时推进|分两块|AB|A\/B)/iu.test(joined);
  const quickCandidate =
    !hasConcern &&
    !hasPreference &&
    !hasProgress &&
    !deliberationHint &&
    input.goal.length > 0 &&
    input.goal.length <= 24 &&
    input.constraints.length <= 18;

  if (parallelHint && (hasConcern || hasPreference || !!input.constraints || input.goal.length > 18)) {
    return WORKFLOW_MODES.parallel_split;
  }
  if (hasConcern || hasPreference || deliberationHint) {
    return WORKFLOW_MODES.careful_deliberation;
  }
  if (quickCandidate) {
    return WORKFLOW_MODES.quick_execute;
  }
  return WORKFLOW_MODES.standard_delivery;
}

function buildExecuteKickoffMessage(input: WorkflowTaskInput, mode: WorkflowModeConfig) {
  const sections = [
    `目标：${input.goal}`,
    input.project ? `项目/仓库：${input.project}` : "",
    input.constraints ? `不能动 / 边界：${input.constraints}` : "",
    input.progress ? `当前进展：${input.progress}` : "",
    input.concern ? `我最担心：${input.concern}` : "",
    input.preference ? `我当前倾向：${input.preference}` : "",
  ].filter(Boolean);

  if (mode.key === "quick_execute") {
    sections.push("这次是低风险小改动，优先直接推进实现；如果没有明显风险，可以直接收口。");
  } else {
    sections.push("请先给我一个简洁执行计划，再往下推进实现。完成这一轮后，如果需要独立验收，请明确指出验收范围和当前风险。");
  }
  return sections.join("\n");
}

function buildDeliberationKickoffMessage(input: WorkflowTaskInput, mode: WorkflowModeConfig) {
  const sections = [
    `当前状态：${input.progress || input.goal || "这是一个新任务，尚未开始实现。"}`,
    `核心问题：${input.goal}`,
    input.constraints ? `约束：${input.constraints}` : "",
    input.concern ? `我最担心：${input.concern}` : "",
    input.preference ? `我当前倾向 / 备选：${input.preference}` : "",
    input.project ? `项目/仓库：${input.project}` : "",
  ].filter(Boolean);

  if (mode.key === "parallel_split") {
    sections.push("请先判断这个任务是否值得并行推进；如果值得，请给出主线 + 支线拆法、每条支线的边界，以及哪些部分不应该并行。");
  } else {
    sections.push("请先帮我收敛方向，给出推荐方案、放弃方案、风险与代价，以及需要我拍板的点。");
  }
  return sections.join("\n");
}

function buildVerificationKickoffMessage(input: WorkflowTaskInput) {
  const sections = [
    input.goal ? `验收目标：${input.goal}` : "",
    input.project ? `项目/仓库：${input.project}` : "",
    input.progress ? `当前进展 / 改动摘要：${input.progress}` : "",
    input.constraints ? `边界 / 不能动：${input.constraints}` : "",
    input.concern ? `我最担心：${input.concern}` : "",
    input.preference ? `补充判断：${input.preference}` : "",
    "请围绕这轮改动做独立验收，重点关注：已验证项、未验证项、发现的问题、验证证据，以及是否建议继续。",
  ].filter(Boolean);
  return sections.join("\n");
}

function buildKickoffMessage(
  input: WorkflowTaskInput,
  mode: WorkflowModeConfig,
  role: "execute" | "verify" | "deliberate",
) {
  if (role === "execute") return buildExecuteKickoffMessage(input, mode);
  if (role === "verify") return buildVerificationKickoffMessage(input);
  return buildDeliberationKickoffMessage(input, mode);
}

function emitWorkflowTaskOpen(detail: WorkflowOpenDetail = null) {
  window.dispatchEvent(new CustomEvent(WORKFLOW_OPEN_EVENT, { detail }));
}

window.openWorkflowTaskIntakeModal = (options = {}) => {
  emitWorkflowTaskOpen(options);
  return true;
};

window.openWorkflowTaskIntakeManualMode = () => {
  emitWorkflowTaskOpen({ revealManual: true });
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

function SummarySection({
  title,
  items,
}: {
  title: string;
  items: Conclusion[];
}) {
  if (!items.length) return null;
  return (
    <section className="grid gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-[color:var(--text-secondary)]">
        {title}
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <div
            key={item.id || `${title}-${item.summary}`}
            className="grid gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--text-secondary)]">
              <span className="inline-flex items-center rounded-full bg-[color:var(--bg-secondary)] px-2 py-0.5 font-medium text-[color:var(--text)]">
                {item.label || "结果"}
              </span>
              {item.sourceSessionName ? <span>来自 {item.sourceSessionName}</span> : null}
              {item.payload?.confidence ? <span>置信度 {item.payload.confidence}</span> : null}
            </div>
            <div className="text-[13px] leading-5 text-[color:var(--text)]">
              {item.summary || "暂无摘要"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryPopover({ summary }: { summary: ChromeState["summary"] }) {
  const pending = summary?.pending || [];
  const decisions = summary?.decisions || [];
  const handled = summary?.handled || [];
  const hasNotice = decisions.length > 0 || pending.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="chrome-action-button text-[color:var(--text-secondary)] hover:text-[color:var(--text)]"
          title="摘要通知"
          aria-label="摘要通知"
        >
          <Bell className="size-4" strokeWidth={1.8} />
          {hasNotice ? <span className="chrome-action-dot" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="chrome-summary-scroll overflow-auto p-3">
        <div className="grid gap-4">
          <section className="grid gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-[color:var(--text-secondary)]">
              当前任务
            </div>
            <div className="text-[14px] leading-6 text-[color:var(--text)]">
              {summary?.currentTask || "暂未设置"}
            </div>
          </section>
          {decisions.length > 0 ? (
            <section className="grid gap-2 rounded-2xl border border-[color:color-mix(in_srgb,var(--notice)_18%,var(--border))] bg-[color:color-mix(in_srgb,var(--notice)_7%,var(--bg))] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.02em] text-[color:var(--text-secondary)]">
                待我决策
              </div>
              <div className="text-[13px] leading-5 text-[color:var(--text)]">
                现在有 {decisions.length} 条结论在等你拍板。
              </div>
              <SummarySection title="待决策" items={decisions.slice(0, 3)} />
            </section>
          ) : null}
          <SummarySection title="待处理" items={pending} />
          <SummarySection title="最近已处理" items={handled} />
        </div>
      </PopoverContent>
    </Popover>
  );
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
    <div className="flex items-center gap-1">
      {summary ? <SummaryPopover summary={summary} /> : null}
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

function ModeFlow({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <div key={`${step}-${index}`} className="flex items-center gap-2">
          <Badge variant="outline">{step}</Badge>
          {index < steps.length - 1 ? (
            <span className="text-xs text-[color:var(--text-tertiary)]">→</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WorkflowTaskDialog() {
  const [open, setOpen] = useState(false);
  const [revealManual, setRevealManual] = useState(false);
  const [starting, setStarting] = useState(false);
  const [input, setInput] = useState<WorkflowTaskInput>(EMPTY_WORKFLOW_INPUT);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<WorkflowOpenDetail>).detail || {};
      const seed = window.remotelabWorkflowBridge?.getSeedInput?.() || {};
      setInput({
        goal: normalizeText(seed.goal),
        project: normalizeText(seed.project),
        constraints: "",
        progress: "",
        concern: "",
        preference: "",
      });
      setRevealManual(detail.revealManual === true);
      setStarting(false);
      setOpen(true);
      void window.remotelabWorkflowBridge?.ensureAppsLoaded?.();
    }

    window.addEventListener(WORKFLOW_OPEN_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_OPEN_EVENT, handleOpen as EventListener);
    };
  }, []);

  const recommendedMode = useMemo(() => recommendWorkflowMode(input), [input]);

  function updateField(key: keyof WorkflowTaskInput, value: string) {
    setInput((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleStart(
    mode: WorkflowModeConfig,
    roleOverride?: "execute" | "verify" | "deliberate",
    successToastOverride?: string,
  ) {
    if (!normalizeText(input.goal) && roleOverride !== "verify") {
      return;
    }
    const role = roleOverride || mode.appRole;
    const kickoffMessage = buildKickoffMessage(input, mode, role);
    const appNames = getAppAliases(role);
    if (!window.remotelabWorkflowBridge?.startTask) {
      window.remotelabToastBridge?.show("任务入口尚未就绪", "error");
      return;
    }
    try {
      setStarting(true);
      await window.remotelabWorkflowBridge.startTask({
        appNames,
        input,
        kickoffMessage,
        successToast: successToastOverride || mode.successToast,
      });
      setOpen(false);
      setRevealManual(false);
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
      <DialogContent className="max-w-[min(calc(100vw-20px),720px)] p-0">
        <DialogHeader>
          <DialogTitle>开始任务</DialogTitle>
          <DialogDescription>
            你只需要告诉我任务目标、项目位置、边界和当前进展；系统会先推荐更合适的工作流，再帮你一键拉起合适的主线。
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[min(72dvh,680px)] gap-4 overflow-auto px-5 py-5">
          <Card>
            <CardHeader>
              <CardTitle>任务信息</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="workflow-task-goal">目标</Label>
                <Textarea
                  id="workflow-task-goal"
                  placeholder="一句话说明这次要做什么"
                  value={input.goal}
                  onChange={(event) => updateField("goal", event.target.value)}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="workflow-task-project">项目 / 仓库</Label>
                <Input
                  id="workflow-task-project"
                  placeholder="例如：/path/to/project"
                  value={input.project}
                  onChange={(event) => updateField("project", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workflow-task-constraints">边界 / 不能动</Label>
                <Textarea
                  id="workflow-task-constraints"
                  placeholder="例如：不能动接口；这次不重构；今天内能上线"
                  value={input.constraints}
                  onChange={(event) => updateField("constraints", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workflow-task-progress">当前进展</Label>
                <Textarea
                  id="workflow-task-progress"
                  placeholder="例如：昨天做到搜索页，今天要接着补空态和错误态"
                  value={input.progress}
                  onChange={(event) => updateField("progress", event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>补充判断</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="workflow-task-concern">我最担心</Label>
                <Textarea
                  id="workflow-task-concern"
                  placeholder="例如：担心跨模块回归；评论意见有冲突；移动端交互容易漏"
                  value={input.concern}
                  onChange={(event) => updateField("concern", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workflow-task-preference">我当前倾向 / 备选方案</Label>
                <Textarea
                  id="workflow-task-preference"
                  placeholder="例如：更倾向先小修；候选方案有 A / B 两条"
                  value={input.preference}
                  onChange={(event) => updateField("preference", event.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-[color:color-mix(in_srgb,var(--notice)_18%,var(--border))] bg-[color:color-mix(in_srgb,var(--notice)_6%,var(--bg))]">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle>推荐工作流</CardTitle>
                  <CardDescription>{recommendedMode.title}</CardDescription>
                </div>
                <Badge variant="secondary">{recommendedMode.label}</Badge>
              </div>
              <CardDescription>{recommendedMode.reason}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ModeFlow steps={recommendedMode.flow} />
              <ul className="grid gap-2 text-sm leading-6 text-[color:var(--text-secondary)]">
                {recommendedMode.plan.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-[color:var(--text-tertiary)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {revealManual ? (
            <Card>
              <CardHeader>
                <CardTitle>手动模式</CardTitle>
                <CardDescription>如果你想直接选择底层能力，也可以跳过推荐，手动打开对应会话。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  className="justify-start rounded-2xl px-4 py-5"
                  disabled={starting}
                  onClick={() => void handleStart(WORKFLOW_MODES.quick_execute, "execute", "已打开执行")}
                >
                  <Play className="size-4" strokeWidth={1.8} />
                  执行
                </Button>
                <Button
                  variant="outline"
                  className="justify-start rounded-2xl px-4 py-5"
                  disabled={starting}
                  onClick={() => void handleStart(WORKFLOW_MODES.standard_delivery, "verify", "已打开验收")}
                >
                  <CheckCircle2 className="size-4" strokeWidth={1.8} />
                  验收
                </Button>
                <Button
                  variant="outline"
                  className="justify-start rounded-2xl px-4 py-5"
                  disabled={starting}
                  onClick={() => void handleStart(WORKFLOW_MODES.careful_deliberation, "deliberate", "已打开再议")}
                >
                  <BrainCircuit className="size-4" strokeWidth={1.8} />
                  再议
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={starting}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => setRevealManual((value) => !value)} disabled={starting}>
            {revealManual ? "收起手动模式" : "手动模式"}
          </Button>
          <Button
            variant="default"
            onClick={() => void handleStart(recommendedMode)}
            disabled={starting || !normalizeText(input.goal)}
          >
            {starting ? "正在开始…" : "按推荐模式开始"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskEntryButtons() {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Button variant="default" className="min-w-[128px] rounded-full" onClick={() => window.openWorkflowTaskIntakeModal?.()}>
        <Play className="size-4" strokeWidth={1.8} />
        开始任务
      </Button>
      <Button variant="outline" className="min-w-[128px] rounded-full" onClick={() => window.openWorkflowTaskIntakeManualMode?.()}>
        <CircleDashed className="size-4" strokeWidth={1.8} />
        手动模式
      </Button>
    </div>
  );
}

function SidebarTaskButton() {
  return (
    <Button
      variant="default"
      className="w-full rounded-[22px] py-6 text-sm"
      onClick={() => window.openWorkflowTaskIntakeModal?.()}
    >
      <GitBranch className="size-4" strokeWidth={1.8} />
      开始任务
    </Button>
  );
}

function App() {
  return (
    <>
      <HeaderActions />
      <WorkflowTaskDialog />
      <Toaster />
    </>
  );
}

function mountRoot(id: string, element: JSX.Element) {
  const mount = document.getElementById(id);
  if (!mount) return;
  createRoot(mount).render(element);
}

mountRoot("chatChromeRoot", <App />);
mountRoot("workflowTaskEntryRoot", <TaskEntryButtons />);
mountRoot("workflowTaskSidebarRoot", <SidebarTaskButton />);

window.remotelabToastBridge = {
  show(message, tone = "neutral") {
    if (!message) return;
    if (tone === "success") {
      toast.success(message);
      return;
    }
    if (tone === "error") {
      toast.error(message);
      return;
    }
    toast(message);
  },
};
