import { createRoot } from "react-dom/client";
import { Fragment, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  GitFork,
  Play,
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

type WorkflowStage = {
  label: string;
  state: "completed" | "current" | "upcoming";
};

type WorkflowTimelineEntry = {
  id: string;
  kind: "stage" | "decision" | "reconcile" | "event";
  title: string;
  detail?: string;
  statusLabel?: string;
  tone?: "neutral" | "notice" | "success" | "warning" | "error" | "muted";
  at?: string;
};

type ChromeState = {
  title?: string;
  statusLabel?: string;
  currentSessionId?: string;
  visitorMode?: boolean;
  workflowAutoTrigger?: {
    visible?: boolean;
    disabled?: boolean;
    activeWorkflow?: boolean;
  } | null;
  summary?: {
    currentTask?: string;
    suggestion?: WorkflowSuggestion;
    workflowStatus?: string;
    workflowStages?: WorkflowStage[];
    workflowTimeline?: WorkflowTimelineEntry[];
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

type WorkflowRoutePreview = {
  label: string;
  title: string;
  flow: string[];
  plan: string[];
};

type WorkflowClassificationResult = {
  mode?: WorkflowModeKey;
  confidence?: string;
  reason?: string;
} | null;

type WorkflowOpenDetail = {
  input?: Partial<WorkflowTaskInput>;
  preferredMode?: WorkflowModeKey | null;
} | null;
type WorkflowLaunchResult = {
  handled: boolean;
  opened?: boolean;
  started?: boolean;
};
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
        setWorkflowAutoTriggerDisabled?: (disabled: boolean) => Promise<void> | void;
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
      getAppAliases?: () => {
        execute?: string[];
        verify?: string[];
        deliberate?: string[];
      };
      classifyTask?: (options: { text: string; folder?: string }) => Promise<WorkflowClassificationResult>;
      launchFromText?: (options: { text: string }) => Promise<WorkflowLaunchResult>;
      startTask?: (options: {
        appNames: string[];
        input: WorkflowTaskInput;
        kickoffMessage: string;
        successToast: string;
        workflowMode?: WorkflowModeKey;
        gatePolicy?: string;
      }) => Promise<unknown>;
    };
    RemoteLabTheme?: {
      getTheme?: () => string;
      subscribe?: (listener: (detail: { preference?: string; theme?: string }) => void) => () => void;
    };
    openWorkflowTaskIntakeModal?: (detail?: WorkflowOpenDetail) => boolean;
  }
}

const WORKFLOW_OPEN_EVENT = "remotelab:workflow-intake-open";
const WORKFLOW_START_SUCCESS_TOAST = "任务已开始";
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
    title: "先再议定方向，执行一轮后再议关键风险，再进入最后执行和验收。",
    reason: "这次任务不适合一把做到底，先判方向，再在首轮实现后复盘取舍，会比直接冲到验收更稳。",
    flow: ["再议", "执行", "再议", "执行", "验收"],
    plan: [
      "先创建再议会话，自动带上当前问题、约束和倾向",
      "由首轮再议给出推荐路径、放弃路径和需要你拍板的点",
      "首轮执行完成后，再开一轮再议，专门复盘残余风险、取舍和是否需要补做",
      "确认后进入最后一轮执行收口，再做独立验收",
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

const WORKFLOW_ROUTE_PREVIEWS: Record<WorkflowModeKey, WorkflowRoutePreview> = {
  quick_execute: {
    label: "直接推进",
    title: "系统预估这次可以先直接实现，必要时再补收口。",
    flow: ["直接实现"],
    plan: [
      "优先按当前目标直接推进改动",
      "如果过程中出现范围扩张或明显风险，系统会自动暂停",
    ],
  },
  standard_delivery: {
    label: "标准链路",
    title: "系统预估先实现，再做独立验收，最后按结果收口会更稳。",
    flow: ["先实现", "再验收", "最后收口"],
    plan: [
      "先推进首轮实现",
      "完成后触发独立验收，再决定是否需要补做",
    ],
  },
  careful_deliberation: {
    label: "先定方向",
    title: "系统预估这次先收敛方向，再推进实现和验收会更可靠。",
    flow: ["先定方向", "推进实现", "复盘风险", "最后验收"],
    plan: [
      "先判断路径、取舍和风险",
      "再进入实现，必要时中途复盘一次",
      "最后做独立验收",
    ],
  },
  parallel_split: {
    label: "拆分推进",
    title: "系统预估这次适合先判断是否拆分，再决定主线和支线如何并行。",
    flow: ["先拆分", "主线推进", "支线推进", "最后验收"],
    plan: [
      "先识别能否安全拆成并行子任务",
      "冲突高的部分会保守处理，不会强行自动合流",
    ],
  },
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

function resolveWorkflowModeKeyFromText(value: string): WorkflowModeKey | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/快速执行/u.test(normalized)) return "quick_execute";
  if (/标准交付/u.test(normalized)) return "standard_delivery";
  if (/审慎模式/u.test(normalized)) return "careful_deliberation";
  if (/并行推进/u.test(normalized)) return "parallel_split";
  return null;
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

function normalizeWorkflowModeKey(value: string | null | undefined): WorkflowModeKey | null {
  if (value === "quick_execute" || value === "standard_delivery" || value === "careful_deliberation" || value === "parallel_split") {
    return value;
  }
  return null;
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

function getWorkflowRoutePreview(mode: WorkflowModeConfig): WorkflowRoutePreview {
  return WORKFLOW_ROUTE_PREVIEWS[mode.key];
}

const WORKFLOW_LAUNCH_PREFIX_PATTERN = /^(?:请|帮我|麻烦|想|要|我要|我想|用|按|直接|继续|现在|先|给我|替我|让我|就)?(?:(?:按)?(?:快速执行|标准交付|审慎模式|并行推进))?(?:模式)?(?:来|继续|直接)?(?:启动|开始|开启|进入|走)(?:一下|吧)?(?:(?:我的?|这个)?(?:工作流|任务))?(?<rest>.*)$/u;
const WORKFLOW_INPUT_FIELD_MATCHERS: Array<{ key: keyof WorkflowTaskInput; pattern: RegExp }> = [
  { key: "goal", pattern: /^(?:目标|任务|需求|goal)\s*[：:]\s*(.+)$/iu },
  { key: "project", pattern: /^(?:项目(?:\/仓库)?|项目\/仓库|仓库|repo|project)\s*[：:]\s*(.+)$/iu },
  { key: "constraints", pattern: /^(?:边界|约束|限制|不能动|不做|constraints?)\s*[：:]\s*(.+)$/iu },
  { key: "progress", pattern: /^(?:进展|当前进展|现状|progress)\s*[：:]\s*(.+)$/iu },
  { key: "concern", pattern: /^(?:我最担心|担心|风险|concern)\s*[：:]\s*(.+)$/iu },
  { key: "preference", pattern: /^(?:我当前倾向|倾向|偏好|方案倾向|preference)\s*[：:]\s*(.+)$/iu },
];

function parseWorkflowInputBody(text: string): Partial<WorkflowTaskInput> {
  const result: Partial<WorkflowTaskInput> = {};
  const remainingLines: string[] = [];

  for (const rawLine of text.split(/\n+/u)) {
    const line = normalizeText(rawLine);
    if (!line) continue;
    let matched = false;
    for (const { key, pattern } of WORKFLOW_INPUT_FIELD_MATCHERS) {
      const match = line.match(pattern);
      if (!match) continue;
      const value = normalizeText(match[1]);
      if (value && !result[key]) {
        result[key] = value;
      }
      matched = true;
      break;
    }
    if (!matched) {
      remainingLines.push(line);
    }
  }

  if (remainingLines.length > 0 && !result.goal) {
    result.goal = remainingLines.join("\n");
  }

  return result;
}

function parseWorkflowLaunchText(rawText: string) {
  const trimmed = normalizeText(rawText);
  if (!trimmed) return null;
  const lines = trimmed.split(/\n/u);
  const firstLine = normalizeText(lines[0]);
  const match = firstLine.match(WORKFLOW_LAUNCH_PREFIX_PATTERN);
  if (!match) return null;

  const preferredMode = resolveWorkflowModeKeyFromText(firstLine);
  const firstLineRemainder = normalizeText((match.groups?.rest || "").replace(/^[\s:：-]+/u, ""));
  const body = [firstLineRemainder, ...lines.slice(1)]
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n");

  return {
    preferredMode,
    input: body ? parseWorkflowInputBody(body) : {},
  };
}

async function launchWorkflowFromText(text: string): Promise<WorkflowLaunchResult> {
  const parsed = parseWorkflowLaunchText(text);
  if (!parsed) {
    return { handled: false };
  }

  const seedInput = window.remotelabWorkflowBridge?.getSeedInput?.() || {};
  const input = buildWorkflowTaskInput(seedInput, parsed.input);
  const explicitGoal = normalizeText(parsed.input.goal);

  if (!explicitGoal) {
    emitWorkflowTaskOpen({
      input,
      preferredMode: parsed.preferredMode,
    });
    return { handled: true, opened: true };
  }

  const kickoffMessage = buildWorkflowKickoffMessage(input);
  const starter = window.remotelabWorkflowBridge?.startTask;

  if (!starter) {
    emitWorkflowTaskOpen({
      input,
      preferredMode: parsed.preferredMode,
    });
    return { handled: true, opened: true };
  }

  await starter({
    input,
    kickoffMessage,
    successToast: WORKFLOW_START_SUCCESS_TOAST,
  });
  return { handled: true, started: true };
}

function emitWorkflowTaskOpen(detail: WorkflowOpenDetail = null) {
  window.dispatchEvent(new CustomEvent(WORKFLOW_OPEN_EVENT, { detail }));
}

const workflowBridge = window.remotelabWorkflowBridge || {};
workflowBridge.launchFromText = async ({ text }) => launchWorkflowFromText(text);
window.remotelabWorkflowBridge = workflowBridge;

window.openWorkflowTaskIntakeModal = (detail = null) => {
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

const workflowTimelineTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function WorkflowStageTimeline({ summary }: { summary: ChromeState["summary"] }) {
  const stages = Array.isArray(summary?.workflowStages)
    ? summary.workflowStages.filter((stage) => stage && typeof stage.label === "string")
    : [];
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stageKey = stages.map((stage) => `${stage.state}:${stage.label}`).join("|");

  useEffect(() => {
    const scroller = scrollRef.current;
    const current = scroller?.querySelector<HTMLElement>("[data-current-stage='true']");
    if (!scroller || !current) return;
    const targetLeft = Math.max(0, current.offsetLeft - ((scroller.clientWidth - current.offsetWidth) / 2));
    scroller.scrollTo({ left: targetLeft });
  }, [stageKey]);

  if (stages.length === 0) return null;

  return (
    <div className="chrome-stage-timeline" aria-label="当前 workflow 阶段">
      <div ref={scrollRef} className="chrome-stage-timeline-scroll">
        {stages.map((stage, index) => (
          <Fragment key={`${stage.state}:${stage.label}:${index}`}>
            {index > 0 ? <span className="chrome-stage-connector" aria-hidden="true">→</span> : null}
            <span
              className={`chrome-stage-chip chrome-stage-chip-${stage.state}`}
              data-current-stage={stage.state === "current" ? "true" : undefined}
            >
              <span className="chrome-stage-chip-icon" aria-hidden="true">
                {stage.state === "completed" ? "✓" : (stage.state === "current" ? "●" : "○")}
              </span>
              <span className="chrome-stage-chip-label">{stage.label}</span>
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function getConclusionLabel(conclusion: Conclusion) {
  return normalizeText(conclusion.label) || "结果转交";
}

function getWorkflowTimelineKindLabel(kind: WorkflowTimelineEntry["kind"]) {
  if (kind === "stage") return "阶段";
  if (kind === "decision") return "决策";
  if (kind === "event") return "反馈";
  return "回流";
}

function getWorkflowTimelineTone(tone?: WorkflowTimelineEntry["tone"]) {
  if (tone === "success" || tone === "notice" || tone === "warning" || tone === "error" || tone === "muted") {
    return tone;
  }
  return "neutral";
}

function formatWorkflowTimelineTime(stamp?: string) {
  const parsed = new Date(stamp || "").getTime();
  if (!Number.isFinite(parsed)) return "";
  return workflowTimelineTimeFormatter.format(parsed);
}

function WorkflowTimelineSummary({ summary }: { summary: ChromeState["summary"] }) {
  const timeline = Array.isArray(summary?.workflowTimeline)
    ? summary.workflowTimeline.filter((entry): entry is WorkflowTimelineEntry => !!entry && typeof entry.id === "string")
    : [];

  if (timeline.length === 0) return null;

  return (
    <section className="chrome-status-zone">
      <div className="chrome-status-zone-title">阶段时间线</div>
      <div className="chrome-status-timeline">
        {timeline.map((entry) => {
          const tone = getWorkflowTimelineTone(entry.tone);
          const timestamp = formatWorkflowTimelineTime(entry.at);
          const detail = normalizeText(entry.detail);
          const statusLabel = normalizeText(entry.statusLabel);
          return (
            <div key={entry.id} className="chrome-status-timeline-item">
              <span
                className={`chrome-status-timeline-dot chrome-status-timeline-dot-${tone}`}
                aria-hidden="true"
              />
              <div className="chrome-status-timeline-body">
                <div className="chrome-status-timeline-header">
                  <div className="chrome-status-timeline-title-row">
                    <Badge variant="outline" className={`chrome-status-badge chrome-status-badge-${tone}`}>
                      {getWorkflowTimelineKindLabel(entry.kind)}
                    </Badge>
                    <div className="chrome-status-timeline-title">
                      {normalizeText(entry.title) || "阶段事件"}
                    </div>
                  </div>
                  {timestamp ? (
                    <div className="chrome-status-timeline-time">{timestamp}</div>
                  ) : null}
                </div>
                {detail ? (
                  <div className="chrome-status-timeline-detail">{detail}</div>
                ) : null}
                {statusLabel ? (
                  <div className="chrome-status-timeline-meta">
                    <span className={`chrome-status-timeline-status chrome-status-timeline-status-${tone}`}>
                      {statusLabel}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
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

function WorkflowStatusButton({ summary }: { summary: ChromeState["summary"] }) {
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
              <div className="chrome-status-task-row">
                <div className="chrome-status-task">
                  {summary.activeVerification.name}
                  {" · "}
                  <span className={
                    summary.activeVerification.runState === "running"
                      ? "chrome-status-badge-success"
                      : "chrome-status-badge-neutral"
                  }>
                    {summary.activeVerification.runState === "running"
                      ? "运行中"
                      : summary.activeVerification.runState === "completed"
                        ? "已完成"
                        : summary.activeVerification.runState === "failed"
                          ? "失败"
                          : "等待中"}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          <WorkflowTimelineSummary summary={summary} />

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

function WorkflowAutoTriggerToggle({ state }: { state: ChromeState }) {
  const workflowAutoTrigger = state.workflowAutoTrigger || null;
  const [busy, setBusy] = useState(false);

  if (!workflowAutoTrigger?.visible) {
    return null;
  }

  const disabled = workflowAutoTrigger.disabled === true;
  const title = workflowAutoTrigger.activeWorkflow
    ? "当前会话已在工作流中；这个开关影响后续普通消息是否会自动提升。"
    : (disabled
      ? "当前会话已关闭复杂任务自动提升为工作流。"
      : "当前会话会在高置信复杂任务时自动提升为工作流。");

  async function handleToggle() {
    const run = window.remotelabChromeBridge?.actions?.setWorkflowAutoTriggerDisabled;
    if (!run || busy) return;
    try {
      setBusy(true);
      await run(!disabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`chrome-auto-trigger-toggle ${disabled ? "is-disabled" : "is-enabled"}`}
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={() => void handleToggle()}
    >
      {busy ? "切换中…" : (disabled ? "自动提升关" : "自动提升开")}
    </Button>
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
    <div className="flex min-w-0 items-center gap-1">
      <WorkflowAutoTriggerToggle state={state} />
      {summary ? <WorkflowStageTimeline summary={summary} /> : null}
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

function ModeFlow({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <div key={`${step}-${index}`} className="flex items-center gap-2">
          <span className="workflow-task-flow-step">{step}</span>
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
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [showRecommendationDetails, setShowRecommendationDetails] = useState(false);
  const [starting, setStarting] = useState(false);
  const [input, setInput] = useState<WorkflowTaskInput>(EMPTY_WORKFLOW_INPUT);
  const [preferredMode, setPreferredMode] = useState<WorkflowModeKey | null>(null);
  const [classifiedRoute, setClassifiedRoute] = useState<WorkflowClassificationResult>(null);
  const [classifying, setClassifying] = useState(false);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail = (event as CustomEvent<WorkflowOpenDetail>).detail || null;
      const seedInput = window.remotelabWorkflowBridge?.getSeedInput?.() || {};
      setInput(buildWorkflowTaskInput(seedInput, detail?.input || {}));
      setPreferredMode(detail?.preferredMode || null);
      setShowOptionalFields(false);
      setShowRecommendationDetails(false);
      setStarting(false);
      setClassifiedRoute(null);
      setClassifying(false);
      setOpen(true);
      void window.remotelabWorkflowBridge?.ensureAppsLoaded?.();
    }

    window.addEventListener(WORKFLOW_OPEN_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_OPEN_EVENT, handleOpen as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (preferredMode) {
      setClassifiedRoute({
        mode: preferredMode,
        confidence: "high",
        reason: "",
      });
      setClassifying(false);
      return;
    }

    const classifier = window.remotelabWorkflowBridge?.classifyTask;
    const signalText = buildTaskSignalText(input);
    if (!classifier || !normalizeText(signalText)) {
      setClassifiedRoute(null);
      setClassifying(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setClassifying(true);
      void classifier({
        text: signalText,
        folder: normalizeText(input.project),
      }).then((result) => {
        if (cancelled) return;
        const mode = normalizeWorkflowModeKey(result?.mode);
        setClassifiedRoute(mode
          ? {
              mode,
              confidence: normalizeText(result?.confidence),
              reason: normalizeText(result?.reason),
            }
          : null);
      }).catch(() => {
        if (cancelled) return;
        setClassifiedRoute(null);
      }).finally(() => {
        if (cancelled) return;
        setClassifying(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, open, preferredMode]);

  const recommendedMode = useMemo(() => {
    const modeKey = preferredMode || normalizeWorkflowModeKey(classifiedRoute?.mode) || "standard_delivery";
    return WORKFLOW_MODES[modeKey];
  }, [classifiedRoute, preferredMode]);
  const routePreview = useMemo(
    () => getWorkflowRoutePreview(recommendedMode),
    [recommendedMode],
  );
  const routeReason = useMemo(() => {
    if (preferredMode) {
      return WORKFLOW_MODES[preferredMode].reason;
    }
    if (normalizeText(classifiedRoute?.reason)) {
      return normalizeText(classifiedRoute?.reason);
    }
    if (classifying) {
      return "正在根据任务描述向服务端估计最合适的工作流路径。";
    }
    return routePreview.title;
  }, [classifiedRoute, classifying, preferredMode, routePreview.title]);

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
    const kickoffMessage = buildWorkflowKickoffMessage(input);
    if (!window.remotelabWorkflowBridge?.startTask) {
      window.remotelabToastBridge?.show("任务入口尚未就绪", "error");
      return;
    }
    try {
      setStarting(true);
      await window.remotelabWorkflowBridge.startTask({
        input,
        kickoffMessage,
        successToast: WORKFLOW_START_SUCCESS_TOAST,
      });
      setOpen(false);
      setShowOptionalFields(false);
      setShowRecommendationDetails(false);
      setInput(EMPTY_WORKFLOW_INPUT);
      setPreferredMode(null);
      setClassifiedRoute(null);
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
          <div className="workflow-task-dialog-layout">
            <div className="workflow-task-main-column">
              <Card className="workflow-task-surface">
                <CardHeader className="workflow-task-card-header">
                  <CardTitle>任务信息</CardTitle>
                </CardHeader>
                <CardContent className="workflow-task-card-content">
                  <div className="workflow-task-form">
                    <div className="workflow-task-field">
                      <Label className="workflow-task-label" htmlFor="workflow-task-goal">目标</Label>
                      <Textarea
                        id="workflow-task-goal"
                        className="workflow-task-textarea-main"
                        rows={3}
                        placeholder="例如：修复移动端登录按钮无响应，并补上回归验证"
                        value={input.goal}
                        onChange={(event) => updateField("goal", event.target.value)}
                      />
                    </div>
                    <div className="workflow-task-field">
                      <Label className="workflow-task-label" htmlFor="workflow-task-project">项目</Label>
                      <Input
                        id="workflow-task-project"
                        placeholder="例如：/path/to/remotelab"
                        value={input.project}
                        onChange={(event) => updateField("project", event.target.value)}
                      />
                    </div>
                    <div className="workflow-task-field">
                      <Label className="workflow-task-label" htmlFor="workflow-task-constraints">边界</Label>
                      <Textarea
                        id="workflow-task-constraints"
                        className="workflow-task-textarea-compact"
                        rows={3}
                        placeholder="例如：不改接口、不改数据库结构，这次先不做重构"
                        value={input.constraints}
                        onChange={(event) => updateField("constraints", event.target.value)}
                      />
                    </div>
                    <div className="workflow-task-field">
                      <Label className="workflow-task-label" htmlFor="workflow-task-progress">进展</Label>
                      <Textarea
                        id="workflow-task-progress"
                        className="workflow-task-textarea-compact"
                        rows={3}
                        placeholder="例如：已经定位到问题，还没开始改；或第一版已经提测"
                        value={input.progress}
                        onChange={(event) => updateField("progress", event.target.value)}
                      />
                    </div>
                    <Collapsible open={showOptionalFields} onOpenChange={setShowOptionalFields} className="workflow-task-collapsible">
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
                          <Label className="workflow-task-label" htmlFor="workflow-task-concern">我最担心</Label>
                          <Textarea
                            id="workflow-task-concern"
                            className="workflow-task-textarea-compact"
                            rows={3}
                            placeholder="例如：担心影响现有会话流程、移动端布局或已有接口兼容"
                            value={input.concern}
                            onChange={(event) => updateField("concern", event.target.value)}
                          />
                        </div>
                        <div className="workflow-task-field">
                          <Label className="workflow-task-label" htmlFor="workflow-task-preference">我当前倾向</Label>
                          <Textarea
                            id="workflow-task-preference"
                            className="workflow-task-textarea-compact"
                            rows={3}
                            placeholder="例如：先做最小改动修复，确认稳定后再考虑扩展"
                            value={input.preference}
                            onChange={(event) => updateField("preference", event.target.value)}
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                    <div className="workflow-task-field">
                      <Label className="workflow-task-label">系统默认行为</Label>
                      <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--accent)] px-3 py-2 text-sm text-[color:var(--text-secondary)]">
                        系统会自动推进确定性高的步骤；遇到关键取舍、范围扩张或低置信度结果时，才会停下来让你拍板。
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="workflow-task-side-column">
              <Card className="workflow-task-surface workflow-task-recommendation-surface">
                <CardHeader className="workflow-task-card-header">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>系统预估路径</CardTitle>
                    <Badge className="workflow-task-recommendation-badge" variant="secondary">
                      {classifying && !preferredMode ? "分析中…" : routePreview.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="workflow-task-card-content">
                  <p className="workflow-task-recommendation-reason">{routeReason}</p>
                  <Collapsible
                    open={showRecommendationDetails}
                    onOpenChange={setShowRecommendationDetails}
                    className="workflow-task-collapsible"
                  >
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="workflow-task-collapsible-trigger">
                        <span>{showRecommendationDetails ? "收起说明" : "查看说明"}</span>
                        <ChevronDown
                          className={`workflow-task-collapsible-icon${showRecommendationDetails ? " is-open" : ""}`}
                          strokeWidth={1.8}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="workflow-task-collapsible-content">
                      <div className="workflow-task-recommendation-details">
                        <ModeFlow steps={routePreview.flow} />
                        <ul className="workflow-task-recommendation-list">
                          {routePreview.plan.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-[color:var(--text-tertiary)]" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            </div>
          </div>
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

function TaskEntryButtons() {
  return (
    <div className="workflow-task-entry-buttons">
      <Button variant="default" className="workflow-task-entry-button workflow-task-entry-button-primary" onClick={() => window.openWorkflowTaskIntakeModal?.()}>
        <Play className="size-4" strokeWidth={1.8} />
        开始任务
      </Button>
    </div>
  );
}

function SidebarTaskButton() {
  return null;
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
mountRoot("workflowTaskEntryRoot", <TaskEntryButtons />);
mountRoot("workflowTaskSidebarRoot", <SidebarTaskButton />);

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
