# Capability-First Shipping Plan

Status: active working direction as of 2026-03-18

Concrete execution companion: `notes/current/session-main-flow-next-push.md`

Historical board-first hypothesis: `notes/archive/board-fanout-next-push.md`

## Decision

- Remove the shipped `Board` surface from the active product path so it stops constraining how the main flow is designed.
- Prioritize finding the right owner interaction and main flow before hardening any board-shaped UI as the product center.
- Accept some local architectural roughness during discovery as long as the system stays session-first, restart-safe, and easy to recover.
- Limit refactor work to the slices directly required by the next product capabilities or by regressions those slices expose.

## Target product shape

- The next product win is a strong session-first main flow after removing `Board` from the active owner experience, not a requirement that the owner land on `Board`.
- One high-trust manager/control surface can accept a user request and fan it out into multiple focused parallel sessions when useful.
- Cross-session collaboration should feel like talking to the same capable friend across many chats: a new or sibling session can pick up recent relevant context without forcing the user to restate everything.
- Context carry must stay explicit, bounded, and inspectable; summaries, refs, and continuation packets should be preferred over blind transcript replay.
- Sessions remain the canonical durable object; board/list/inbox-like surfaces stay derived and optional.

## Why the current system can bend into this shape

- The owner UI already ships session-first surfaces, so `Board` can be deleted without losing the core workflow foundation.
- Session metadata already includes useful presentation and workflow signals such as `name`, `group`, `description`, `workflowState`, `workflowPriority`, and `lastReviewedAt`.
- Single-session delegation already exists through `POST /api/sessions/:sessionId/delegate` and `remotelab session-spawn`.
- Context compaction, continuation summaries, summary refs, and prepared fork-context reuse already exist as infrastructure primitives.

## Product judgment

### 1. Main flow before board

- Do not introduce a separate durable `Task` object.
- Remove the current `Board` implementation instead of keeping it around as a half-live planning anchor.
- If a board-like view ever returns later, it must be re-earned as a derived surface rather than inherited from the current implementation.
- Judge the next push by whether the owner can operate Cue cleanly through session-first surfaces after the current board is gone.

### 2. Multi-session fan-out remains important

- The product win is not only "forking"; it is one user turn intentionally spawning several bounded worker sessions.
- Keep the source/dispatch session lightweight and orchestration-focused, not a heavy parent container.
- Treat spawned sessions as normal independent sessions with concise aggregation back into the source session when useful.

### 3. Cross-session context freshness is now core

- Multiple sessions only feel natural if recent relevant updates can follow the user across sessions.
- Optimize for the "I already told you elsewhere" case without forcing the user to replay prior chats.
- Use bounded summaries, refs, recent-decision packets, or explicit handoff blocks instead of eager shared-transcript loading.

## Immediate gaps to close

### Main-flow gaps

- Decide what the owner should land in after `Board` is removed: current session, session list, inbox-like dispatcher, or a lightweight hybrid.
- Remove product language that treats `Board` as the success criterion for the next push.
- Remove board-specific affordances that keep pulling design discussion back into card/column thinking.

### Multi-session gaps

- Promote the existing delegation primitive into an intentional many-session workflow contract.
- Confirm one turn can fan out into several independent sessions without requiring heavy parent-side handoff UI.
- Decide whether the first shipped fan-out surface is agent-internal only, owner-visible UI, or both.

### Context-freshness gaps

- Define the minimal contract for how one session can benefit from recent relevant context learned in another session.
- Decide when context should be pulled automatically, suggested, or explicitly requested.
- Confirm imported context stays bounded and observable instead of becoming a hidden giant shared memory layer.
- Reuse the shipped compaction, summary/refs, and prepared fork-context paths where possible instead of inventing a new memory stack from scratch.

## Suggested near-term execution order

1. Remove `Board` and clarify the owner main flow without it.
2. Define and prototype the cross-session context-freshness contract.
3. Turn single-child delegation into a deliberate multi-session orchestration pattern with light aggregation.
4. Add context-source observability and tune the bounded continuation paths that the new workflow depends on.
5. Re-evaluate later whether any board-like derived surface deserves to return after the main flow feels right.

## Shipping candidate for the next push

- The owner can operate Cue cleanly after the shipped `Board` surface is removed.
- A manager/control session can fan one user turn out into several focused independent sessions and report back with a light summary when useful.
- A new or sibling session can receive recent relevant context from adjacent work without the user manually replaying everything.
- Context carry remains bounded and observable so continued or spawned sessions are not silently replaying too much history.

## The next four slices

### Slice 1 — session-first main flow without board lock-in

- Keep the current session-first architecture; do not add a new durable task object.
- Make the next push evaluable after `Board` is removed entirely from the active owner flow.
- Keep everyday operation possible through the session list, active session surface, or a lightweight dispatcher-like entry rather than a board requirement.

### Slice 2 — cross-session context freshness contract

- Define a minimal reusable unit for recent-context carry: summary, refs, recent decisions, or a bounded continuation packet.
- Keep imports conservative and explainable; prefer explicit or high-confidence linkage before automatic carry.
- Treat source and freshness metadata as part of the operator trust contract.

### Slice 3 — one-turn multi-session fan-out

- Promote the current single-session delegation primitive into a deliberate multi-session orchestration pattern.
- Prefer lightweight source-session summaries and normal session-level navigation over one heavy parent-side handoff object.
- Keep spawned sessions operationally independent; avoid over-modeling persistent hierarchy before lived use proves we need it.
- Use the existing failing recursive fan-out validation as the first concrete regression to fix rather than inventing a new orchestration abstraction.

### Slice 4 — continuation observability and bounded carry validation

- Verify the paths that matter for the new product shape: compaction handoff, summary/refs reuse, prepared fork-context reuse, and any new cross-session import packet.
- Add lightweight observability for which continuation path a run actually used and what recent context it inherited.
- Keep this scoped to enabling the session-first + fan-out workflow; do not turn it into a speculative memory architecture rewrite.

## Push gate

- The main owner flow feels coherent after `Board` is removed from the active owner experience.
- Cross-session context freshness is demoable in a bounded, inspectable way.
- One-turn multi-session fan-out is demoable end to end with independent spawned sessions and a light aggregation path.
- The known recursive fan-out regression is fixed.
- The known fork-context regression is either fixed or explicitly judged non-blocking for this push.
- We can tell, at least in debug/operator surfaces, whether continuation came from history, summary handoff, prepared context, or a cross-session import packet.

## What not to optimize yet

- Do not restart a broad core-domain cleanup just because the old refactor map exists.
- Do not rebuild another board/project/task hierarchy before the main flow proves it is needed.
- Do not turn context freshness into a giant always-on global memory system before a minimal bounded contract is validated.
- Do not let provider-registry or broader app-model cleanup outrank the session-first + fan-out validation pass unless they directly block it.

## Current validation snapshot

- Single delegate/session-spawn flow is already validated by `tests/test-http-runtime-phase1.mjs`.
- Session-state workflow classification is validated by `tests/test-chat-session-state-model.mjs`.
- Auto-compaction and summary/refs cache contracts are validated by `tests/test-auto-compaction.mjs` and `tests/test-http-session-summary-refs.mjs`.
- Recursive fan-out and fork-context validation still need focused follow-up because current dedicated tests expose regressions before the full happy path is green.
- A dedicated validation pass for cross-session context freshness still needs to be defined once the contract settles.
