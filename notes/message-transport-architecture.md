# Message Transport Architecture

> Created 2026-03-09 as the historical rationale behind Cue's HTTP-first, detached-runner direction.
> This is not the current architecture spec.
> For shipped behavior, use `docs/project-architecture.md`.
> For the concrete landed implementation contract, use `notes/archive/http-runtime-phase1.md`.

---

## What This Note Preserves

This file now exists for one reason:

> to preserve the key reasoning behind the move from stream-centric chat transport to durable HTTP-canonical session semantics.

The old version had a lot of overlapping architecture discussion. The durable part of that discussion is much smaller.

---

## Product Promise

The important promise is **logical continuity**, not transport continuity.

Cue should optimize for:

- durable session state
- replayable completed work
- explicit run status
- restart-safe recovery when possible
- thin realtime hints over canonical HTTP reads

Cue should **not** optimize for pretending that:

- WebSocket continuity is the product
- child process identity is the same thing as session identity
- a restarted control plane should look magically uninterrupted

---

## Preferred Split

The preferred architecture is:

```text
HTTP control plane + detached runtime plane + durable local store + thin invalidation channel
```

In practice that means:

- the control plane owns auth, policy, routes, sessions, runs, and canonical API shape
- execution should stay comparatively thin and disposable
- normalized output and status should be written quickly to durable storage
- WebSocket should mostly say “something changed”; HTTP should answer “what changed”

---

## Why HTTP-First Was The Right Simplification

The design pressure was not “how do we stream more beautifully?”

It was:

- mobile networks are unstable
- the control plane should be cheap to restart
- the browser is not the system of record
- asynchronous multi-session work matters more than token-by-token spectacle

Once those assumptions are accepted, HTTP-first becomes the cleaner center of gravity.

---

## Durable Boundary

The deepest boundary is:

```text
durable session semantics vs ephemeral execution
```

That is more useful than framing the system as merely “stateful manager vs stateless server.”

Why:

- `Session` survives transport interruptions
- `Run` survives control-plane restarts as durable metadata/spool even if the original process relationship changes
- the browser can always converge back to canonical state by re-reading HTTP resources

---

## Connector Implication

This architecture also implies a clean rule for external channels:

> email, GitHub, bots, Feishu, and other external sources should act as clients of the same durable session protocol.

Cue should not learn every upstream thread/reply model.
It should accept normalized session/message/run operations and expose the same canonical state back out.

That is why this note still matters even after the runtime refactor landed: it explains the architectural stance behind the connector model.

---

## Simplification Rules Worth Keeping

These rules still feel durable:

1. prefer filesystem-first persistence until proven otherwise
2. prefer thin realtime over clever realtime
3. keep the runtime thinner than the control plane
4. avoid fake compatibility that hides provider/runtime differences
5. optimize for recoverability over transport theater

---

## What Remains Open

This note intentionally leaves open:

- how far autonomy/deferred triggers should go
- how broad the provider/runtime family model should become
- whether some connector flows deserve extra convenience APIs
- what the long-term background execution topology should be

Those are real future questions, but they do not change the historical conclusion recorded here.

---

## Related Docs

- `docs/project-architecture.md` — current shipped architecture
- `notes/archive/http-runtime-phase1.md` — concrete landed phase-1 contract
- `notes/current/self-hosting-dev-restarts.md` — honest restart workflow for self-hosting development
- `notes/directional/ai-driven-interaction.md` — future-facing AI-initiated work
