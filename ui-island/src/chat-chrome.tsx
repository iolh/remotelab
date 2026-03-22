import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { Bell, GitFork, SendHorizontal, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  }
}

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
      <div className="text-[11px] font-semibold tracking-[0.02em] text-[color:var(--text-secondary)] uppercase">
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
            <div className="text-[11px] font-semibold tracking-[0.02em] text-[color:var(--text-secondary)] uppercase">
              当前任务
            </div>
            <div className="text-[14px] leading-6 text-[color:var(--text)]">
              {summary?.currentTask || "暂未设置"}
            </div>
          </section>
          {decisions.length > 0 ? (
            <section className="grid gap-2 rounded-2xl border border-[color:color-mix(in_srgb,var(--notice)_18%,var(--border))] bg-[color:color-mix(in_srgb,var(--notice)_7%,var(--bg))] p-3">
              <div className="text-[11px] font-semibold tracking-[0.02em] text-[color:var(--text-secondary)] uppercase">
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

function App() {
  return (
    <>
      <HeaderActions />
      <Toaster />
    </>
  );
}

function mountChrome() {
  const mount = document.getElementById("chatChromeRoot");
  if (!mount) return;
  createRoot(mount).render(<App />);
}

mountChrome();

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
