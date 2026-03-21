# AI-Driven Interaction: Core Philosophy

_Started: 2026-03-04_

> Status: directional note for post-request-response interaction design.
> For the current shipped chat/runtime baseline, use `docs/project-architecture.md`.
> For the current domain baseline, use `notes/current/core-domain-contract.md`.

---

## The Shift

Today, the default model is still:

```text
human sends message -> AI responds -> session waits
```

The directional extension is:

```text
human and AI can both create future work inside the same session system
```

That does **not** require inventing a second product universe.
It means letting the model schedule, annotate, and resume work through the same durable session grammar.

---

## Smallest Useful Extension

The minimal new primitive is a **deferred trigger**.

Conceptually:

- the model writes a future message or wake-up condition
- RemoteLab stores it durably
- the system delivers it back into the target session later
- the resulting work still appears as normal session activity

That keeps the core abstraction stable:

> the product remains session-first, even when the AI becomes more proactive.

---

## Session Metadata As The Control Surface

Before full autonomy, the most useful AI-owned surface is lighter:

- title / name
- group
- description
- later: status, priority, tags, blocker, next action

These fields should be treated as:

- model-writable operational metadata
- derived control-surface state
- never the permission system

The browser then becomes less of a “chat window only” product and more of a lightweight board of ongoing AI work.

---

## Browser Role

The browser should remain:

- HTTP-canonical for truth
- lightweight in orchestration
- optimized for status, intervention, approval, and quick redirects into the right session

The important shift is not “make the frontend heavier.”
The important shift is “make the current work state more visible and actionable.”

---

## Practical Phases

### Phase 1 — better session-owned metadata

Keep improving the session surface so the model can reliably maintain:

- title/name
- group
- description
- later richer status fields

### Phase 2 — explicit session-management surface

Expose a consistent public API for model-written presentation/status updates so the behavior is not split across ad hoc internals.

### Phase 3 — deferred triggers and background continuation

Once the metadata/control surface is stable, add:

- scheduled follow-ups
- event-driven wake-ups
- AI-initiated check-ins
- more autonomous long-running workflows

---

## What This Note Is Not Trying To Solve Yet

This note is intentionally not the place to lock down:

- scheduler implementation details
- daemon topology
- exact trigger storage schema
- full autonomy safety policy
- external connector protocol details

Those should remain separate architecture/execution decisions.

---

## Open Questions

- which session fields deserve first-class public mutation APIs?
- when is a session “waiting for human” vs merely “still working”?
- what minimal trigger model gives value before the system becomes overly scheduler-heavy?
- how should notifications and summaries relate to AI-initiated work?

---

## Related Docs

- `notes/directional/autonomous-execution.md` — longer-horizon autonomy direction
- `notes/directional/product-vision.md` — higher-level product motivation
- `notes/message-transport-architecture.md` — historical runtime rationale
