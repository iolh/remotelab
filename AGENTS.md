# AGENTS.md — Cue Project Context

> Canonical repo-local AI context lives here. Keep tool-specific files like `CLAUDE.md` only as thin compatibility shims that point back to this file.

> **Read this file first.** It gives you everything you need to work on this project without exploring blindly.
> For deep-dive topics, reference docs are linked at the bottom.

---

## What Is Cue

Cue is not a product that makes AI work better. It is a product that makes the human show up less often, more precisely, and more at ease.

One person runs many AI work threads on a real machine. AI executors run autonomously; the system continuously persists state, maintains context, and manages cross-thread attention. The human is absent by default and present only at moments that genuinely need judgment — from phone or desktop.

**Not** a terminal emulator, an editor-first IDE, a chatbot, an agent framework, or an engagement machine. Cue is a **human attention interface** — it does not sell execution, it sells judgment timing, context recovery, and interruption economy.

- Single owner, not multi-user
- Node.js, no external frameworks (only `ws` for WebSocket)
- Vanilla JS frontend, no build tools

## Product Design Center (Non-Negotiable)

Cue’s ideal shape is not “a smarter AI product” but “an AI work control plane that disturbs the human as little as possible.” At its best it should feel like a nearly invisible dispatch surface. AI threads run autonomously on the real machine for extended periods; the system continuously persists state, organizes context, and maintains cross-thread visibility. The human is absent by default and surfaces only at the rare moments that genuinely require value judgment, direction choice, risk approval, or delivery acceptance. Every surfacing should be high-signal, low-friction, decidable in seconds — not a drag back into logs, dashboards, and process.

### Core Philosophy: 依乎天理，因其固然

The analogy is the Cook Ding parable (庖丁解牛). Cook Ding’s blade stayed sharp for nineteen years — not because it was a better blade, but because it never touched bone. It moved only through the natural seams of the ox. The blade’s wear approached zero because it never appeared where it shouldn’t.

Human attention is that blade. Most AI products try to sharpen the blade — better dashboards, richer logs, more configuration panels, making you “more efficient at watching.” But watching itself is the wear. The real solution is not helping the human watch more efficiently; it is making the human not need to watch at all.

This also explains a counterintuitive throughput result: **maximum reduction of human intervention yields maximum AI output.** When the human is absent, AI runs at full speed. Every unnecessary interruption — even two minutes — compounds into massive AI productivity loss. When the system only calls the human at genuine decision points, AI’s continuous execution window is longest, each human intervention carries highest value, and total system throughput is maximized.

### Ideal Use Case

One single owner pushes many long tasks in the real world at the same time. Several AI threads write code, verify, research, run scripts, fix environments, organize docs — all on the owner’s real machine. The owner walks away — meeting, commuting, eating — and occasionally glances at their phone: which thread is stuck, where is a call needed, which delivery is ready to accept, which direction needs changing. The phone is not a mobile IDE; it is a pocket judgment and approval surface. The desktop is not for manual re-operation; it is for the rare moments that need deeper engagement and then leaving again.

Later, when a particular workflow has been repeatedly validated by the owner, Cue may allow it to be packaged as an App or exposed through a thin external adapter — as distribution of an already-validated collaboration protocol, not as an initial platform play.

### Product Grammar

The core grammar is deliberately simple: `Session` is the durable work thread, `App` is reusable policy/package, the browser is a control surface, and the machine plus its persistent state is the true continuity. Cue’s value is not in how smart any single turn is — it is in letting the owner hold more concurrent AI work threads without needing to carry more state in their head. It does not sell execution. It sells judgment timing, context recovery, and interruption economy.

### Hard Boundaries

Cue must not become a terminal emulator, a heavy editor, a heavy dashboard, a generic chat SaaS, a multi-tenant bot platform, or yet another closed agent runtime. It must not default to creating new attention sources: reaching out proactively “to be more helpful,” silently making decisions “to be more automated,” or sprawling into a collection of external connector product lines “to have more entry points.”

External entry surfaces may exist, but only as thin adapters around the same session grammar. They must not reverse-define the product’s center. Automation may exist, but only to extend AI’s autonomous runtime and reduce human appearance frequency — never to push the system toward an engagement machine. Any feature that gives the owner a new system to monitor has already crossed the boundary.

### The One-Sentence Test

When evaluating any feature, ask one question: **is this reducing how often and how expensively the owner needs to appear, or is it creating a new world the owner must continuously manage?** The former is Cue. The latter is not.

### Decision Rules

**What Cue optimizes**: the timing, quality, and economy of human attention. The system’s core output is not “better AI output” — it is “better human decision moments.” When the system surfaces the human, the information must be sufficient, the required action must be clear, and the interruption must be worth the context-switch cost.

**What Cue does NOT compete on**: model routing sophistication, skill/MCP chaining, prompt engineering quality, or dashboard richness. These are machine-side concerns. Users cannot perceive and do not care whether the system cleverly switched models behind the scenes. Users perceive whether they were interrupted at the right moment with the right information.

**Competitive frame**: Cue’s competitors are not AI infrastructure tools (LangChain, CrewAI, AutoGen) but human attention interfaces (Linear, Slack, email). The question is not “who orchestrates agents better” but “who wastes less human attention while achieving more.”

### Design Validation Gate

Every product, UX, workflow, connector, and automation change must pass these questions before it is treated as core Cue direction:

1. Does this reduce how often the owner needs to appear, or does it create another thing the owner must monitor?
2. Does this make each human interruption shorter, clearer, and more self-contained?
3. Does this preserve `session + app + principal` as the core grammar, or does it invent another product species?
4. If this is a connector or automation, is it staying a thin adapter around Cue’s session grammar, or is it becoming its own product line?
5. If we removed this, would Cue become more true to its design center? If yes, the default bias should be to cut, demote, or keep it experimental.

## Engineering Principles (Non-Negotiable)

These principles govern every feature, refactor, and architectural decision. They are not aspirational — they are enforceable constraints with the same weight as Hard Constraints below.

1. **Proven benefit only in defaults** — only ship behavior with demonstrated, concrete value as a product default. Weak hypotheses, speculative optimizations, and "sounds smart" abstractions stay out of the default path until real usage data justifies them. When in doubt, leave it out.
2. **Cut, don't add (游刃有余)** — when the system feels complex, the first response is to remove unnecessary layers, not to add a cleverer one. Each cut reduces resistance; the goal is a system that moves through seams, not one that powers through bone. Every layer of indirection must justify its existence against the cost of the complexity it introduces. Prefer fewer moving parts over more "flexible" architecture.
3. **Human-side over machine-side** — prioritize work that visibly improves the human's experience (fewer unnecessary interruptions, better decision context, faster comprehension) over work that only improves machine-side efficiency (smarter model routing, cheaper inference, faster tool execution). Machine-side optimization is acceptable only when it produces a clear human-perceptible benefit such as reduced latency or reduced cost passed through to the user.
4. **Overhead self-awareness** — the system must not waste expensive resources on cheap tasks. Auxiliary operations (labeling, classification, state inference) should use the cheapest adequate model/configuration. The mainline user-chosen runtime is never silently overridden by heuristics.
5. **App/user explicit config always wins** — when the user or an App has explicitly configured tool, model, effort, or thinking, no heuristic or automatic policy may override that choice. Automatic policies only fill gaps where the user has not expressed a preference.
6. **Validate with observation, not speculation** — new orchestration behaviors must be validated with logs, metrics, or user feedback before being promoted from experimental to default. "It should theoretically be better" is not sufficient justification for shipping.

## Documentation Rule

For setup, deployment, integration, and feature-activation docs, use a model-first, prompt-first shape:

- assume the operator is a human delegating to their own AI coding agent
- have the AI collect all required context in one early handoff whenever possible, instead of drip-feeding questions across many turns
- prefer one structured input packet from the human, then autonomous execution by the AI until completion or a true `[HUMAN]` checkpoint
- lead with a copyable prompt, one-round input requirements, target state, and explicit `[HUMAN]` checkpoints
- keep automatable command-by-command flow inside the AI conversation or scripts, not as a long manual cookbook
- minimize human interruption so the operator can hand off the task and come back only for approvals, browser-only actions, validation, or final handoff

---

## Architecture

```
Browser / app surface ──HTTPS──→ Cloudflare Tunnel ──→ chat-server.mjs (:7690)
                                                    │
                                      HTTP control plane + WS hints
                                                    │
                                      durable history + run state
                                            │
                                 detached runners normalize back to HTTP
```

### Chat Architecture

| Service | Port | Domain | Role |
|---------|------|--------|------|
| `chat-server.mjs` | **7690** | production chat domain | **Primary** — the shipped owner chat/control plane |

**Dev workflow**: use the normal `7690` service as the single chat/control plane. Cue now relies on clean restart recovery rather than a separate permanent validation plane.

**Self-hosting rule**: restarting the active chat server is acceptable when needed because runs reconcile back from durable state. Treat restart as a transport interruption with logical recovery, not as a reason to maintain a second permanent chat plane. Manual extra instances remain optional ad-hoc debugging tools only. See `notes/current/self-hosting-dev-restarts.md`.

---

## File Structure

```
remotelab/
├── chat-server.mjs          # PRIMARY entry point (HTTP server, port 7690)
├── cli.js                   # CLI entry: `remotelab start|stop|restart|setup|...`
├── generate-token.mjs       # Generate 256-bit access tokens
├── set-password.mjs         # Set password-based auth
│
├── chat/                    # ── Chat service modules ──
│   ├── router.mjs           # All HTTP routes & API endpoints (538 lines)
│   ├── session-manager.mjs  # Session/run orchestration shell + module wiring
│   ├── workflow-engine.mjs  # Event-driven workflow suggestions, handoffs, and auxiliary session flow
│   ├── prompt-builder.mjs   # Prompt assembly, turn activation, and fork-context preparation
│   ├── context-compaction.mjs # Context compaction queue + worker orchestration
│   ├── follow-up-queue.mjs  # Queued follow-up buffering and dispatch
│   ├── run-completion-suggestions.mjs # Post-run verification / decision suggestion logic
│   ├── process-runner.mjs   # Tool invocation helpers + runtime adapters
│   ├── runs.mjs             # Durable run metadata/result/spool storage
│   ├── runner-supervisor.mjs # Detached runner launcher
│   ├── runner-sidecar.mjs   # Thin detached executor writing raw spool/status/result
│   ├── ws.mjs               # WebSocket invalidation channel only
│   ├── summarizer.mjs       # AI-driven session label suggestions (title/group/description)
│   ├── apps.mjs             # App (template) CRUD & persistence (89 lines)
│   ├── system-prompt.mjs    # Build system context injected into AI sessions (83 lines)
│   ├── normalizer.mjs       # Convert tool output → standard event format (45 lines)
│   ├── middleware.mjs        # Auth checks, rate limiting, IP detection (80 lines)
│   ├── push.mjs             # Web push notifications (83 lines)
│   ├── models.mjs           # Available LLM models per tool (46 lines)
│   ├── history.mjs          # Canonical append-only per-event history + externalized bodies
│   └── adapters/
│       ├── claude.mjs       # Claude Code CLI output parser (201 lines)
│       ├── codex.mjs        # Codex CLI output parser (207 lines)
│       └── cursor.mjs       # Cursor Agent CLI output parser
│
├── lib/                     # ── Shared modules (used by both services) ──
│   ├── auth.mjs             # Token/password verification, session cookies
│   ├── config.mjs           # Environment variables, paths, defaults
│   ├── tools.mjs            # CLI tool discovery (which), custom tool registration
│   ├── utils.mjs            # Utilities (read body, path handling)
│   └── cloudflared-config.mjs # Access-domain selection from cloudflared ingress
│
├── static/                  # ── Frontend assets ──
│   ├── chat.js              # Backward-compatible loader for split chat frontend assets
│   ├── chat/                # Chat frontend split by concern (bootstrap / data / realtime / UI)
│   ├── marked.min.js        # Markdown renderer
│   ├── sw.js                # Service Worker (PWA)
│   └── manifest.json        # PWA metadata
│
├── templates/               # ── HTML templates ──
│   ├── chat.html            # Chat UI (primary, 765 lines)
│   ├── login.html           # Login page (194 lines)
│   └── share.html           # Read-only shared snapshot view
│
├── docs/                    # User-facing documentation
├── notes/                   # Internal design & product thinking
├── tests/                   # Scenario-style validation scripts
└── memory/system.md         # System-level memory (shared, in repo)
```

### Data Storage

By default, runtime data lives in `~/.config/remotelab/`.
Additional instances can override this with `REMOTELAB_INSTANCE_ROOT`, `REMOTELAB_CONFIG_DIR`, and `REMOTELAB_MEMORY_DIR`.

| File | Content |
|------|---------|
| `auth.json` | Access token + password hash |
| `chat-sessions.json` | All session metadata |
| `chat-history/` | Per-session event store (`meta.json`, `context.json`, `events/*.json`, `bodies/*.txt`) |
| `apps.json` | App definitions (templates) |

---

## API Endpoints (chat-server)

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/login` | Login page |
| POST | `/login` | Authenticate (token or password) |
| GET | `/logout` | Clear session |
| GET | `/api/auth/me` | Current user info (role: owner\|visitor) |

### Sessions
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions` | List all sessions (active + archived) |
| POST | `/api/sessions` | Create new session |
| PATCH | `/api/sessions/{id}` | Update session metadata (`name`, `archived`) |

### Apps (Owner only)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/apps` | List all apps |
| POST | `/api/apps` | Create app |
| PATCH | `/api/apps/{id}` | Update app |
| DELETE | `/api/apps/{id}` | Delete app |
| GET | `/app/{shareToken}` | Visitor entry (public, no auth) |

### Tools & Models
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tools` | Available AI tools |
| GET | `/api/models` | Models per tool |

### Other
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/browse?path=` | Browse directories |
| GET | `/api/autocomplete?q=` | Path autocomplete |
| GET | `/api/push/vapid-public-key` | Web push public key |
| POST | `/api/push/subscribe` | Register push subscription |
| WebSocket | `/ws` | Invalidation-only hints |

---

## Key Product Concepts

### Sessions
Unit of work = one chat conversation with one AI tool. Persisted across disconnects. Resume IDs (`claudeSessionId`, `codexThreadId`) stored in metadata so AI context survives server restarts.

### Workflow Metadata
Sessions carry lightweight workflow signals — `currentTask`, `workflowState`, `workflowPriority` — that help the owner see what each thread is doing and how important it is. These are presentation metadata, not a workflow state machine.

Multi-session fan-out is supported: a control session can spawn focused parallel sessions. But the system does not automatically route work between sessions, auto-absorb conclusions, or decide on behalf of the owner whether a result is acceptable. Those are human judgment calls.

### Apps (Templates)
Reusable AI workflows shareable via link. Each App defines: name, systemPrompt, skills, tool. When a Visitor clicks the share link → auto-creates a scoped Session with the App's system prompt injected.

### Owner / Visitor Model
- **Owner**: Full access. Logs in with token or password.
- **Visitor**: Accesses only a specific App via share link. Sees chat-only UI (no sidebar). Each Visitor gets an independent Session. This is NOT multi-user — Visitors are scoped guests.

### Session Labeling
`summarizer.mjs` suggests canonical session presentation metadata — `title`, `group`, and hidden `description` — to help the owner quickly reorient when returning to a session.

### Memory System (Pointer-First)
- **Storage tiers** still matter:
  - System-level (`memory/system.md` in repo): universal learnings shared across deployments
  - User-level (`~/.remotelab/memory/`): machine-specific knowledge, private
- **Activation layers** matter just as much:
  - `bootstrap.md`: tiny startup index
  - `projects.md`: project pointer catalog
  - `tasks/` and deeper docs: load only after task scope is clear
- Goal: large total memory on disk, small relevant context in-session

---

## Security

- **Token**: 256-bit random hex, timing-safe comparison
- **Password**: scrypt-hashed alternative
- **Cookies**: HttpOnly + Secure + SameSite=Strict, 24h expiry
- **Rate limiting**: Exponential backoff on login failures (max 15min)
- **Network**: Services listen on 127.0.0.1 only; external access via Cloudflare Tunnel
- **CSP**: Nonce-based script allowlist
- **Input validation**: Tool commands reject shell metacharacters

---

## Hard Constraints (Non-Negotiable)

1. **Single shipped chat plane** — keep the shipped architecture centered on the primary `7690` chat-server unless a new operator surface is explicitly reintroduced
2. **No external frameworks** — Node.js built-ins + `ws` only
3. **Restart-safe recovery** — prefer durable restart/reload recovery over maintaining a permanent second chat plane
4. **Vanilla JS frontend** — no build tools, no framework
5. **Every change = new commit** — never use `--amend`, only new commits
6. **Single Owner** — no multi-user auth infrastructure
7. **Agent-driven first** — new features prefer conversation/Skill over dedicated UI
8. **ES Modules** — `"type": "module"`, all `.mjs` files
9. **Template style** — `{{PLACEHOLDER}}` substitution, nonce-injected scripts
10. **Mainline does not generate external demand flows** — the shipped default does not run external connectors, inbound automation, or proactive outreach. External entry surfaces exist only as opt-in thin adapters, not as default product behavior
11. **No hidden machine-side judgment replacement** — the system must not silently decide on behalf of the owner whether a conclusion is acceptable, whether a workflow should close out, or whether the human is needed. Automatic policies may extend AI autonomy but must not replace human judgment calls

---

## Visual Design Specification (Non-Negotiable)

Every UI change — in `static/chat/`, `static/chat-island/`, `ui-island/src/`, or `templates/` — **must** follow this specification. Violating these rules produces visual regressions that are expensive to detect after the fact.

### Design Token Layer

All colors flow through semantic CSS custom properties defined in `static/chat/chat-base.css`. **Never hardcode hex/rgb values in component CSS or inline styles.** The canonical tokens are:

| Token | Purpose |
|-------|---------|
| `--bg`, `--bg-secondary`, `--bg-tertiary` | Background surfaces |
| `--border`, `--border-strong` | Border hierarchy |
| `--text`, `--text-secondary`, `--text-muted` | Text hierarchy |
| `--accent`, `--accent-dim` | Accent elements |
| `--success`, `--success-bg` | Positive outcomes |
| `--notice` | Informational / workflow status |
| `--error`, `--error-bg` | Errors |
| `--warning`, `--issue` | Warnings and issues |
| `--surface-hover`, `--user-bubble`, `--tool-bg` | Specialized surfaces |
| `--modal-shadow`, `--modal-backdrop`, `--overlay-backdrop` | Elevation |
| `--focus-border` | Focus rings |
| `--safe-top`, `--safe-bottom`, `--chat-gutter` | Layout / safe areas |

For tinted borders and backgrounds, use `color-mix(in srgb, var(--token) N%, var(--base))` — this is the established pattern throughout the codebase.

Light/dark mode is handled via `prefers-color-scheme` media query and explicit `data-theme` attribute. Both sets are defined in `chat-base.css`. Never add one without the other.

### Font

- **System font stack**: `-apple-system, system-ui, 'Segoe UI', sans-serif` on `body`
- **Island layer** inherits via `font-family: inherit` — do not set explicit font-family in island components
- **Mono**: Use the system monospace stack when needed (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`)

### Font Size Scale (strict)

| Size | Usage |
|------|-------|
| 10px | Micro labels: footer, managed pill, stage chip icon |
| 11px | Badges, timeline status/time, meta text, stage chips |
| 12px | Body text, inputs, descriptions, buttons, sidebar tabs, labels, card body text |
| 13px | Card titles, popover titles, zone titles, toast text, workflow labels |
| 14px | Sidebar header |
| 15px | Header title, main textarea |
| 18px | Dialog titles |

Do not introduce new sizes outside this scale.

### Border Radius Scale (strict)

| Radius | Usage |
|--------|-------|
| 6px | Header buttons |
| 8px | Popover/card buttons, input fields |
| 10px | System notes, status cards, parallel items, dialog buttons |
| 14px | Input wrapper, toast |
| 16px | Popovers, status dialogs |
| 22px | Codex import dialog |
| 24px | Task dialog, task surface, mobile modal |
| 999px | Pills, badges, dots, full-round elements |

Do not introduce new radius values outside this scale.

### Spacing Patterns

- **Button padding**: `7px 10px` (standard), `1px 7px` (pills/badges)
- **Card/zone padding**: `16px` desktop, `14px` mobile
- **Dialog padding**: `24px` desktop, `16px` mobile
- **Gap**: `4px` (tight), `8px` (standard), `10px` (zone), `12px`–`14px` (form fields)
- **Mobile breakpoint**: `640px` for component adjustments, `768px` for layout (sidebar inline)

### Two-Layer Frontend Architecture

| Layer | Location | Tech | Build |
|-------|----------|------|-------|
| Static vanilla | `static/chat/` | Pure CSS + vanilla JS | None (served raw) |
| Island | `ui-island/src/` → `static/chat-island/` | React + shadcn/ui + Tailwind | Vite build |

Both layers **must** share the same CSS custom property tokens from `chat-base.css`. The island layer must never introduce its own color palette or shadow/elevation values.

### Icon System

- **Static layer**: VS Code Codicons subset via `static/chat/icons.js` + `.rl-icon` class
- **Island layer**: Lucide React — keep the icon set minimal, import only what is used
- Do not mix icon systems within a single UI surface

### Enforcement Checklist (for every UI PR)

1. Zero hardcoded hex/rgb/hsl color values in new CSS or TSX
2. All new sizes exist in the font-size or border-radius scale above
3. Dark mode works — both `prefers-color-scheme` and `data-theme` paths
4. Mobile viewport (≤ 640px) does not overflow or truncate critical content
5. `safe-area-inset-*` respected for iOS PWA
6. No new `font-family` declarations — inherit from body
7. Island CSS uses `var(--token)` references, not Tailwind's built-in color palette

---

## Current Priorities

Operating rule: prefer capability-first shipping slices that validate "less human attention, more AI throughput" before any broad refactor. Every item must pass the one-sentence test: is it reducing how often and how expensively the owner needs to appear?

### Done (recent)
- [x] Owner/Visitor dual-role identity
- [x] App system (CRUD API, share tokens, visitor flow)
- [x] Resume ID persistence (survives server restarts)
- [x] Web push notifications
- [x] Board removal — session-first main flow is now the only owner surface
- [x] Typed attention contract — event-sourced state, checkpoint-based resume, typed attention with state/type/reason/action
- [x] Triage inbox as primary surface — session list consumes backend attention for sorting, badges, and action strips
- [x] Completed attention lifecycle — "completed alerts once, action alerts continuously"; unified `shouldSurfaceCompletedAttention` predicate; `completed_read` drops to passive
- [x] Tool-only completed turn visibility — `isTurnTerminal` + `fileChanges` summary on thinking blocks so completed turns always have a minimal visible result
- [x] Product boundary audit — confirmed mainline product center as single-owner attention interface; demoted external connectors, workflow auto-routing, and machine-side judgment replacement from the default product path

### P0 — Product Boundary Enforcement
- [ ] Mainline reduction — remove proactive observer, workflow auto-absorb/closeout/magic-name routing, session-routing regex, Progress Tab shell; downgrade request-log and release-tooling from product defaults
- [ ] Connector separation — move Agent Mailbox, Feishu connector, GitHub auto-triage/CI-auto-repair, wake-word voice connector, Doubao fast agent, remote capability monitor out of mainline into `contrib/` or separate packages
- [ ] Workflow engine simplification — retain lightweight session metadata (`currentTask`, `workflowState`, `workflowPriority`) and fan-out primitives; remove auto-absorb, typed-conclusion lifecycle, magic app-name routing, and final closeout automation

### P1 — Next Up (human-side, attention-reducing)
- [ ] Attention reason granularity — split `completed` into `completion_with_conclusion` (surfaces once) and `completion_tool_only` (passive, no attention); inbox only shows completions with decision value
- [ ] Signal-driven attention accuracy — use acted/skipped signals to iteratively tighten `deriveSessionAttention` rules; only promote validated improvements to defaults
- [ ] Multi-session fan-out — let a control session spawn focused parallel sessions with light hierarchy and concise aggregation; the human sees one inbox, not N session details
- [ ] Cross-session context freshness — let sibling sessions pick up recent relevant context without requiring the user to restate; keep imports bounded and inspectable
- [ ] Context carry/cache confirmation — validate compaction, fork context, summary/refs reuse so multi-session flows stay fast and bounded
- [ ] Deferred triggers — AI-initiated scheduled follow-ups so the human doesn’t need to remember to check back

### P2 — Future (only when P1 validates the need)
- [ ] Skills framework (file storage + loading mechanism)
- [ ] First-run onboarding App/session — seed a built-in guide so new owners see capabilities instead of an empty session list
- [ ] Queued follow-up composer buffer — stage another message while a session is still streaming; auto-submit as next turn after the active response finishes
- [ ] Post-LLM output processing (layered output: decision / summary / details)
- [ ] Session fork follow-ups — extend hard-clone head-fork with optional lineage navigation
---

## Reference Docs (for deep dives)

| Doc | Path | When to read |
|-----|------|-------------|
| Documentation Map | `docs/README.md` | Repo doc taxonomy: what lives in `docs/` vs `notes/` |
| Notes Map | `notes/README.md` | Note taxonomy: `current` vs `directional` vs `archive` vs `local` |
| Project Architecture | `docs/project-architecture.md` | Top-down map of the shipped system, code locations, runtime flows, and current-vs-direction split |
| Remove Board + Rewrite Main Flow | `notes/current/remove-board-and-rewrite-main-flow.md` | Historical decision record — board removal is complete; session-first main flow is now the shipped baseline |
| Capability-First Shipping Plan | `notes/current/capability-first-shipping-plan.md` | Current near-term product-shape note for session-first main flow, multi-session fan-out, and bounded context freshness |
| Session Main Flow + Context Freshness Next Push | `notes/current/session-main-flow-next-push.md` | Concrete execution pack for the current post-board product slice |
| Core Domain Contract | `notes/current/core-domain-contract.md` | Current domain/refactor baseline when deciding which product objects are canonical |
| Product Surface Lifecycle | `notes/current/product-surface-lifecycle.md` | Current rule for keep/iterate/retire decisions on shipped feature surfaces |
| External Message Protocol | `docs/external-message-protocol.md` | Opt-in integration contract for thin external adapters; not part of the mainline default |
| Core Philosophy | `notes/directional/core-philosophy.md` | Historical philosophy note; use it for framing, not as the current implementation checklist |
| App-Centric Architecture | `notes/directional/app-centric-architecture.md` | Historical/consolidated direction note for treating default chat and shared Apps as one policy model |
| Provider Architecture | `notes/directional/provider-architecture.md` | Open provider/model abstraction, local JS/JSON extension path, migration plan |
| Product Vision | `notes/directional/product-vision.md` | Product rationale and open questions; not the canonical shipped-status tracker |
| Super-Individual Workbench | `notes/directional/super-individual-workbench.md` | Sharpened product-definition memo: control plane vs IDE, orchestration-first sequencing, packaging-before-distribution |
| AI-Driven Interaction | `notes/directional/ai-driven-interaction.md` | Deferred triggers design, session metadata schema, future phases |
| Autonomous Execution | `notes/directional/autonomous-execution.md` | P2 background execution vision |
| Message Transport Architecture | `notes/message-transport-architecture.md` | Historical transport/runtime rationale after the HTTP-first architecture landed |
| HTTP Runtime Phase 1 | `notes/archive/http-runtime-phase1.md` | Concrete implementation spec for the coordinated HTTP/control-plane + runner refactor |
| Memory Activation Architecture | `notes/current/memory-activation-architecture.md` | Pointer-first memory loading, routing layers, pruning rules |
| Creating Apps | `docs/creating-apps.md` | User-facing guide for App creation |
| Setup Guide | `docs/setup.md` | Installation, service setup (LaunchAgent/systemd) |
| System Memory | `memory/system.md` | Cross-deployment learnings (context continuity, testing strategy) |
