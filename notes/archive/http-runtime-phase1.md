# HTTP Control Plane + Detached Runner — Phase 1 Implementation Spec

> Status: implemented baseline for the HTTP-first detached-runtime architecture.
> Purpose: turn the architecture discussion into one concrete refactor target that can be executed and validated as a single coordinated milestone.

---

## Why this should be one coordinated milestone

This refactor touches five strongly coupled surfaces at the same time:

- canonical HTTP contract
- frontend state model
- durable storage layout
- realtime delivery semantics
- runner/control-plane boundary

Shipping only one slice of that stack would leave the app in a partially migrated state that is difficult to validate and easy to misread.

So this work should be developed as **one integrated milestone** even if the code changes are still applied in a dependency-aware order.

The practical rule is:

> build it in a sane sequence, but validate it as one coherent architecture.

---

## Goals

1. **All client-initiated reads and writes go through HTTP.**
2. **Realtime becomes optional invalidation, not the source of truth.**
3. **Token streaming is removed in the first pass.**
4. **The main service is restart-friendly and rehydratable.**
5. **Active runs can outlive a control-plane restart.**
6. **The runner stays tiny, stable, and free of business logic.**
7. **Storage stays local-first and lightweight.**

---

## Non-goals

- No multi-user redesign
- No external database or queue in phase 1
- No token-level streaming UX
- No trigger/autonomy expansion in this phase
- No provider-architecture overhaul beyond what is needed for the new run contract
- No attempt to make transport continuity look perfect during restarts

---

## User-facing promise

The product promise for this phase is:

- session state is durable
- completed output is replayable
- active run status is inspectable
- retries and refreshes converge on the same canonical state
- server restart should not automatically erase the run that was already executing

The product does **not** promise:

- uninterrupted socket continuity
- token-by-token live output
- zero-visible reconnect behavior on mobile networks

---

## Target architecture

### 1. Control plane

The control plane is the main HTTP service.

It owns:

- auth and cookies
- owner / visitor policy
- session CRUD
- app/share semantics
- canonical run and event normalization
- storage reads/writes for durable product state
- cache validators and cursor semantics
- invalidation fanout

The control plane is the **canonical source of truth**.

### 2. Runner plane

The runner is a detached execution sidecar with a deliberately tiny contract.

It owns only:

- start a run from a manifest
- expose heartbeat / liveness
- append raw output to a spool
- record final exit result
- accept cancel requests

It must not own:

- auth
- owner / visitor rules
- app semantics
- canonical event shaping
- session presentation
- cache logic
- cross-session business policy

The runner is allowed to write tiny raw operational files because otherwise a control-plane crash creates a blind spot. But those files are not the final product model; they are recovery inputs for the control plane.

### 3. Realtime channel

Realtime is optional and thin.

Phase 1 keeps `/ws` for the invalidation channel because it already exists, but it is reduced to server-to-client notifications only. A later switch to `SSE` remains acceptable once the refactor is stable.

Core principle:

> correctness comes from HTTP + durable storage; realtime only makes convergence faster.

---

## Canonical data model

### Session

Suggested minimum fields:

```json
{
  "id": "session_123",
  "title": "Fix auth flow",
  "tool": "codex",
  "model": "o3",
  "workdir": "~/code/remotelab",
  "archived": false,
  "latestSeq": 42,
  "activeRunId": "run_456",
  "lastEventAt": "2026-03-10T12:34:56Z",
  "resume": {
    "provider": "codex",
    "providerResumeId": "thread_abc"
  }
}
```

### Run

Suggested minimum fields:

```json
{
  "id": "run_456",
  "sessionId": "session_123",
  "requestId": "client_req_789",
  "state": "running",
  "tool": "codex",
  "model": "o3",
  "createdAt": "2026-03-10T12:34:56Z",
  "startedAt": "2026-03-10T12:34:57Z",
  "updatedAt": "2026-03-10T12:35:10Z",
  "completedAt": null,
  "providerResumeId": "thread_abc",
  "runnerId": "runner_local",
  "cancelRequested": false,
  "result": null
}
```

Recommended `state` values:

- `accepted`
- `running`
- `waiting_input`
- `completed`
- `failed`
- `cancelled`

### Event

Canonical event log is append-only and sequence-based.

Suggested minimum fields:

```json
{
  "seq": 42,
  "sessionId": "session_123",
  "runId": "run_456",
  "ts": "2026-03-10T12:35:10Z",
  "type": "message.assistant_committed",
  "payload": {
    "text": "Done — updated the file.",
    "artifacts": []
  }
}
```

Phase 1 event types should stay coarse:

- `run.accepted`
- `run.started`
- `message.user_committed`
- `message.assistant_committed`
- `tool.step_completed`
- `artifact.created`
- `run.waiting_input`
- `run.completed`
- `run.failed`
- `run.cancelled`
- `status.notice`

---

## Local storage layout

Keep storage lightweight and filesystem-first.

Recommended layout inside `~/.config/remotelab/`:

```text
auth.json
chat-sessions.json
chat-history/
  <sessionId>.jsonl          # canonical normalized event log
chat-runs/
  <runId>/
    status.json             # tiny mutable run status record
    spool.jsonl             # raw runner output for crash recovery
    result.json             # final exit/outcome record
    artifacts/              # files created during the run
sidebar-state.json
apps.json
```

Storage rules:

- small mutable metadata uses atomic JSON rewrite
- event logs and runner spools use append-only JSONL
- canonical replay reads come from `chat-history/`
- runner spool is recovery-oriented, not directly rendered as product truth

If future query or coordination pain becomes real, the next upgrade path is embedded `SQLite`, not an external service.

---

## Canonical HTTP contract

### Session reads

- `GET /api/sessions`
  - list sessions with summary metadata including `latestSeq` and `activeRunId`
- `GET /api/sessions/:id`
  - return canonical session metadata
- `GET /api/sessions/:id/events?afterSeq=<n>`
  - return the full normalized event index after a cursor/sequence
  - keep thinking and tool bodies deferred to `GET /api/sessions/:id/events/:seq/body`

### Run reads

- `GET /api/runs/:id`
  - return canonical run status

### Writes

- `POST /api/sessions/:id/messages`
  - create one new run from a user message
  - request body includes `text`, `images`, optional tool/model overrides, and `requestId`
  - returns `202 Accepted` with `{ runId, requestId, state }`
- `POST /api/runs/:id/cancel`
  - idempotent cancel request
- `POST /api/runs/:id/resume`
  - idempotent resume request for resumable cases

### Idempotency

Every active write should accept a client-generated request ID.

Rules:

- duplicate `requestId` must not create duplicate runs
- retrying a successful request should return the already-created run
- mobile reconnects should be safe by default

### Cache and validation behavior

Use HTTP caching as revalidation, not as magical shared caching.

Recommended defaults:

- private mutable reads: `Cache-Control: private, no-cache`
- static assets: immutable cache policy
- finalized artifacts: immutable or long-lived cache if content-addressed or otherwise stable
- mutable reads should support `ETag` and `If-None-Match`
- event reads should support incremental fetch by `afterSeq`

The main win comes from cheap revalidation and incremental reads, not from trying to cache hot private session data at the edge.

---

## Realtime contract

Phase 1 keeps `/ws`, but the semantics change.

### Client behavior

The client may subscribe to:

- one session
- session list / sidebar level changes

The client does **not** send chat actions over realtime anymore.

### Server payload

Keep payloads minimal, for example:

```json
{
  "type": "session.updated",
  "sessionId": "session_123",
  "runId": "run_456",
  "latestSeq": 42
}
```

Possible event families:

- `session.updated`
- `run.updated`
- `sessions.updated`
- `sidebar.updated`

### Fallback rule

If realtime disconnects:

- manual refresh must still show correct state
- subsequent HTTP reads or user actions must still converge without periodic polling
- no state transition should depend on a socket-only payload

---

## Control-plane ↔ runner contract

The runner boundary should be explicitly frozen before detailed execution work expands.

### Control plane sends to runner

Run manifest fields should include at least:

- `runId`
- `sessionId`
- `tool`
- `model`
- `workdir`
- normalized user input payload
- image/file references
- provider resume info if present

### Runner writes for control plane consumption

- `status.json`
- `spool.jsonl`
- `result.json`

### Runner lifecycle assumptions

- runner may stay alive while the control plane restarts
- control plane must be able to re-scan unconsumed runner output on boot
- runner output is raw and recovery-oriented, not product-authoritative

---

## Implementation order inside this one milestone

Even though this ships as one coordinated phase, the internal coding order should be:

1. **Lock the HTTP contract**
   - define resources, request IDs, cursor semantics, and response shapes
2. **Switch the frontend to HTTP-source-of-truth semantics**
   - submit by HTTP, render by HTTP reads, treat realtime as a hint only
3. **Upgrade local durable storage**
   - ensure append-only canonical event persistence and run directories exist
4. **Freeze the minimal runner contract**
   - no business semantics, only execution + tiny raw persistence
5. **Detach execution from server lifetime**
   - active runs should survive control-plane restart
6. **Thin realtime last**
   - keep `/ws` only for invalidation, or replace with `SSE` if clearly cheaper

This order is important because it prevents the runner from accidentally absorbing product semantics that are still moving.

---

## Expected code areas for the execution session

Likely touch points:

- `chat/router.mjs`
- `chat/session-manager.mjs`
- `chat/history.mjs`
- `chat/ws.mjs`
- `chat/process-runner.mjs` or its extracted successor
- `static/chat.js`

Possible new modules:

- `chat/runs.mjs`
- `chat/events.mjs`
- `chat/runner-client.mjs`
- `chat/runner-supervisor.mjs`

Whether those new files are introduced or not is an implementation detail; the important part is preserving the architecture boundary defined above.

---

## Validation checklist

The milestone is not done until these flows pass:

1. **HTTP is canonical**
   - send a message by HTTP
   - refresh the page
   - session/run state still renders correctly from HTTP reads alone

2. **Realtime is optional**
   - disconnect `/ws`
   - rely on refresh or the next HTTP read/action
   - state still converges correctly

3. **No duplicate run on retry**
   - repeat `POST /api/sessions/:id/messages` with the same `requestId`
   - verify only one run exists

4. **Control-plane restart is survivable**
   - start a run
   - restart the main HTTP service mid-run
   - verify the run can still be inspected and eventual output is recovered

5. **Runner stays thin**
   - verify no auth/policy/presentation logic moved into the runner layer

6. **Streaming is truly gone in phase 1**
   - verify the UI updates on coarse milestones only
   - verify no token-level assumptions remain in frontend or transport code

---

## Intentional deferrals

Leave these for later unless phase-1 execution proves they are unavoidable:

- `SSE` migration
- `SQLite` migration
- deferred triggers / autonomous execution
- richer artifact indexing
- fine-grained progress streaming
- broader provider-registry cleanup beyond the minimum needed for the new run contract

---

## Relationship to existing notes

- `notes/message-transport-architecture.md` remains the discussion merge point
- this document is the execution-oriented phase-1 contract
- `notes/current/self-hosting-dev-restarts.md` explains the restart-safety motivation
- `notes/directional/ai-driven-interaction.md` remains the future-facing autonomy context

When starting the next implementation session, begin from this file and use the broader transport note only when extra rationale is needed.
