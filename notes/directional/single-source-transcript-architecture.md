# Single-Source Transcript Architecture

> Proposed 2026-03-17 as the cleanup direction for duplicate / inconsistent session events during active runs.
> This is a directional design note, not shipped behavior.

---

## Why This Note Exists

RemoteLab currently has a real consistency failure mode during active runs:

- one raw runtime record can be normalized more than once
- the same assistant message can therefore be appended to durable session history more than once
- the root problem is architectural, not just a missing dedupe guard

The failure comes from letting ordinary read paths help ingest live run output while also tracking incremental ingest cursors.

That shape is too clever for the value it returns.

This note records a simpler rule:

> prefer one trusted source per phase of a run, recompute aggressively if needed, and make reads side-effect free.

---

## Design Principles

1. **Consistency over performance**
   - Local CPU, disk, and small repeated reads are cheaper than debugging dirty state machines.
   - If a whole-turn replay is simpler than partial incremental mutation, replay the whole turn.

2. **One trusted source at a time**
   - Completed transcript truth should come from one durable source.
   - In-flight turn truth should come from one durable source.
   - Do not keep two mutable representations of the same live turn and try to reconcile them incrementally.

3. **Reads should not mutate durable transcript state**
   - `GET` paths should answer questions.
   - They should not opportunistically ingest, finalize, or repair transcript data.

4. **Whole-block replacement beats local patch cleverness**
   - For an active turn, replacing the full projected block list is acceptable.
   - Avoid if/else-heavy append heuristics whose purpose is to hide uncertainty about the underlying state.

5. **Derived caches are optional, disposable, and never canonical**
   - If a cache exists later, it must be rebuildable from canonical durable data.
   - Correctness must never depend on a cache staying in sync.

---

## Target Model

RemoteLab should treat transcript state as two different phases with different canonical sources.

### 1. Committed history

Canonical source:

- `chat-history/<sessionId>/events/*.json`

Rules:

- Contains only committed transcript events.
- Once written, it is append-only and immutable.
- It is the only source for completed turns.

### 2. Active run output

Canonical source:

- `chat-runs/<runId>/spool.jsonl`
- `chat-runs/<runId>/status.json`
- `chat-runs/<runId>/result.json`

Rules:

- While a run is active, the live turn is not incrementally appended into committed history.
- The spool is the single trusted source for in-flight content.
- Every read that needs the active turn should project it from the spool, not depend on a partially-normalized mirror.

### 3. Finalization

Canonical transition:

- when the run becomes terminal, the control plane materializes the final turn exactly once from the full spool
- the resulting committed transcript is appended atomically into session history
- the run is then marked finalized

This keeps the live phase and committed phase distinct instead of trying to blur them together.

---

## The Core Simplification

The current problematic shape is conceptually:

```text
raw spool
  -> incremental normalized events
  -> append into durable history during reads / watchers
  -> advance ingest cursor
```

The cleaner target shape is:

```text
active run:
  raw spool -> deterministic projection for reads

run completion:
  raw spool -> one final materialization -> durable history append
```

That removes the need for live transcript correctness to depend on:

- incremental ingest cursors being perfectly current
- overlapping readers not racing each other
- frontend append heuristics guessing whether two updates represent the same logical block

---

## Server Contract Direction

### Session reads

Session reads should become pure composition:

- committed history
- plus an optional projected active turn if `activeRunId` exists and is not finalized

The server may still expose one combined transcript response, but it should build that response from those two sources without mutating either one.

### Active-turn projection

The active turn should be projected from the full current spool on demand.

Important characteristics:

- deterministic
- idempotent
- rebuildable from scratch
- independent of previous projections

If the spool has not changed, the projection should be identical.
If the spool has changed, recompute the active turn again from scratch.

### Finalization

Finalization should be the only place that commits active-run transcript content into session history.

That code path should:

1. read the final spool
2. derive the final normalized turn
3. append it once into history
4. mark the run finalized

No ordinary read endpoint should perform step 3.

---

## Block Identity Rule

To keep projection and rendering simple, the system should preserve source identity while normalizing active-turn blocks.

Examples:

- provider item id like `item_217`
- a stable synthetic block id derived from source item type + source item id

Why this still matters even with whole-block replacement:

- it keeps the projected turn deterministic
- it lets the UI replace blocks cleanly without guessing
- it gives a future idempotency anchor if replay or materialized caches are ever introduced

Current normalized events often throw that identity away too early. The cleanup direction should preserve it until final materialization.

---

## Frontend Rendering Rule

The frontend should stop trying to be clever about active-run event appends.

Instead:

- committed history can still use append-friendly rendering because it is immutable and sequenced
- the active turn should be rendered as one replaceable region
- when the server says the active turn changed, the client can replace that whole region from the latest projected block list

This is intentionally less optimized and more honest.

The browser should not try to infer whether two nearby active-turn payloads are “really the same update.”
That judgment belongs in the server’s deterministic projection step.

---

## What To Avoid

The cleanup should explicitly avoid these directions:

### 1. Frontend dedupe as the primary fix

That would hide the symptom while leaving duplicated durable history underneath.

### 2. More conditional cursor repair

Adding more `if already normalized then skip` logic on top of the current live-ingest shape will make the code harder to trust.

### 3. Two live truths for the same turn

Do not maintain both:

- a partially committed live event log
- and a separate raw spool view

and then attempt to keep them synchronized incrementally.

### 4. Read-time mutation in list/detail routes

Listing sessions, reading one session, or fetching visible events should not be responsible for ingesting new transcript data.

---

## Minimal Migration Plan

### Phase A — stop using reads as ingestors

- remove transcript-affecting ingest work from ordinary read paths
- keep one explicit reconciliation/finalization path for runs
- keep WS as an invalidation hint only

This alone should already remove the duplicate-history race surface.

### Phase B — add deterministic active-turn projection

- project active-turn blocks directly from the full spool
- return them through one explicit API shape
- keep the projection stateless and rebuildable

### Phase C — commit only on finalization

- append final transcript events to history only once, at run finalization
- mark the run finalized only after the append succeeds

### Phase D — simplify the client

- keep immutable-history append logic
- replace active-turn region wholesale on refresh
- delete append heuristics that only exist to manage uncertainty

---

## Why This Is A Better Fit For RemoteLab

This direction matches the broader RemoteLab philosophy:

- thin WS invalidation
- HTTP as canonical read surface
- filesystem-first durability
- restart-safe recovery
- correctness and recoverability over transport theatrics

Most importantly, it gives the system a more honest contract:

> committed transcript is immutable history, active transcript is a projection of raw spool, and the boundary between them is explicit.

That is a much simpler mental model than incremental live ingestion spread across watchers, reads, and cursors.

---

## Related Notes

- `notes/message-transport-architecture.md`
- `notes/archive/http-runtime-phase1.md`
- `notes/current/session-state-audit.md`
- `docs/project-architecture.md`
