# Remove Board + Rewrite Main Flow

Status: current decision record as of 2026-03-18

Related notes:

- `notes/current/capability-first-shipping-plan.md`
- `notes/current/session-main-flow-next-push.md`
- `notes/current/session-first-workflow-surfaces.md`

## Decision

- Remove the shipped `Board` surface completely from the active owner flow.
- Stop using `Board` as the planning anchor for product discussion or implementation slicing.
- Rewrite the owner main flow from the session-first core instead of continuing to iterate inside board constraints.
- If a board-like surface ever returns, it must come back later as an earned derived view, not as a carried-forward assumption.

## Why this decision is necessary

- The current board keeps pulling discussion toward columns, cards, and local UI tweaks instead of the interaction we actually want.
- The shipped board is not mature enough to deserve product-center status.
- Keeping it half-alive creates design gravity: people keep asking how to improve `Board` instead of whether `Board` should exist at all.
- What Cue actually wants to become is a coherent multi-session AI collaboration environment, not a kanban wrapper around chat threads.

## What this decision does not change

- `Session` remains the canonical durable work object.
- We still do **not** introduce a separate durable `Task` object.
- Multi-session fan-out remains a core capability.
- Cross-session context freshness becomes more important, not less.
- Context carry must stay bounded, inspectable, and cheap enough to trust.

## Immediate product consequences

- Remove board-first language from active product notes and priorities.
- Do not keep board-specific affordances around as hidden dependencies in the main flow.
- Re-evaluate the owner landing surface from scratch: current session, session list, dispatcher/control session, or another session-first entry.
- Re-evaluate how attention management works without relying on board columns.
- Treat any future board-like view as follow-on visualization work, not as the main-line rewrite target.

## Core design questions for the rewrite

1. After board removal, what should the owner actually land in by default?
2. How should a manager/control session surface parallel work without a board?
3. How should recent relevant context move across sibling or newly opened sessions?
4. What visibility layer replaces board-style attention management?
5. Which existing UI and API pieces can be deleted immediately, and which should remain as reusable infrastructure?

## Cross-session context implication

Removing `Board` does not remove the need for orchestration visibility.

It increases the importance of a better contract for cross-session context freshness:

- the user should not need to restate recent conclusions in every session
- a new session should be able to inherit recent relevant context from adjacent work
- the inherited packet must stay bounded and explainable
- the system must avoid turning many small sessions into one hidden giant transcript

This is now a high-priority design topic for the next dedicated session.

## Guidance for the next dedicated discussion session

Start from this assumption:

> There is no `Board`. The product still needs to feel coherent, navigable, and powerful.

Then discuss from first principles:

- owner default landing and navigation
- manager/control session behavior
- multi-session visibility and aggregation
- cross-session recent-context carry
- deletion list for the current board-driven UI assumptions

## Suggested seed prompt

Use this in the next session as the opening frame:

"Please read `notes/current/remove-board-and-rewrite-main-flow.md` and continue the design from that premise. Assume the shipped `Board` is gone. Help redesign the owner main flow from a session-first baseline, with special focus on manager-style orchestration, multi-session visibility without a board, and bounded cross-session context freshness."
