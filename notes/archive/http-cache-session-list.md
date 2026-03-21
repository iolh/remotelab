# HTTP Cache Plan for Session List Bootstrap

## Why this note exists

The current HTTP runtime already uses WebSocket as a push-only invalidation channel and HTTP as the source of truth. That direction is good: it keeps the realtime layer thin and lets the browser reuse normal HTTP cache semantics.

The remaining problem is that a fresh chat page still performs a full `GET /api/sessions` during bootstrap, even when the page only needs to open one already-known session. On the current branch, the same page load also immediately performs a second revalidation pass after the WebSocket connects.

## Measured trace on an isolated test plane

Validation environment:

- Separate local chat-server on `127.0.0.1:7792`
- Disposable `HOME` so no live user chat state was touched
- One blank session with no messages
- Headless Chrome page load against the local server

Observed API sequence for a blank session page load:

1. `GET /api/auth/me` → `200`
2. `GET /api/settings` → `200`
3. `GET /api/tools` → `200`
4. `GET /api/models?tool=claude` → `200`
5. `GET /api/sessions` → `200`
6. `GET /api/sessions/:sessionId` → `200`
7. `GET /api/models?tool=codex` → `200`
8. `GET /api/sessions/:sessionId/events?afterSeq=0&limit=500` → `200`
9. `GET /api/sessions` → `304`
10. `GET /api/sessions/:sessionId` → `304`
11. `GET /api/sessions/:sessionId/events?afterSeq=0&limit=500` → `304`

## What this tells us

### 1. The waste is primarily bootstrap duplication, not idle polling

For a totally blank session, the isolated reproduction does **not** show an endless polling loop. The main waste is:

- one full session-list fetch on cold bootstrap
- one immediate revalidation pass after WebSocket connect

The second pass is cheap in bytes because ETag already works, but it is still an extra request burst.

### 2. Session-list freshness is still coupled to the full list endpoint

Today the client has only one way to answer “is my list still current?”:

- request `GET /api/sessions`
- let the server compute an ETag from the full JSON body
- accept either `200` with the full body or `304`

That means the **validator check** and the **full collection fetch** are still tied to the same route and the same server work.

### 3. Current-session bootstrap is mixed with sidebar bootstrap

If the page already knows the target session ID, opening that session does not logically require a full collection fetch first. We only need the collection so the sidebar is accurate.

That suggests we should separate:

- **current-session bootstrap**
- **session-list revalidation**

## Recommended redesign

## A. Add a lightweight collection validator endpoint

Use one of these two shapes:

- `HEAD /api/sessions`
- or `GET /api/sessions/meta`

Recommended response headers / fields:

- `ETag`: collection validator
- `Last-Modified`: latest collection change timestamp
- optional session count metadata

Important detail: the validator should be based on **cheap collection state**, not on serializing the full enriched list body.

Good inputs for the validator:

- `chat-sessions.json` mtime / size / revision
- session count
- latest `updatedAt` in session metadata

This is sufficient for the sidebar list because list membership, archive state, rename state, and ordering-relevant timestamps are all driven from session metadata.

## B. Persist the session-list snapshot across page reloads

Store a small owner-only snapshot in `localStorage`:

- last session-list payload
- its `ETag`
- the time it was written

On a fresh page load:

1. render the cached sidebar snapshot immediately
2. bootstrap the current session directly if the target session is already known
3. revalidate the session list via `HEAD /api/sessions` or `/api/sessions/meta`
4. only call full `GET /api/sessions` when the validator changed or no snapshot exists

This removes the cold-start need for a full collection fetch in the common case.

## C. Stop doing a full `refreshRealtimeViews()` immediately after WS connect

Right now the page does an HTTP bootstrap and then immediately revalidates again after the WebSocket opens.

That should be split into smaller rules:

- if bootstrap already completed, do **not** immediately refetch the session list
- if the current session was already loaded, do **not** immediately refetch it unless the connection was recovering from a disconnect
- if the progress tab is not active, do **not** touch `/api/sidebar`

The WebSocket connect path should establish invalidation delivery, not trigger a second blanket refresh.

## D. Keep invalidations resource-scoped

The current direction is mostly correct:

- `session_invalidated` should refresh only that session and its event delta
- `sessions_invalidated` should be reserved for collection-shape changes such as create / archive / unarchive / delete

The missing optimization is that `sessions_invalidated` should first do a **cheap validator check**, not an immediate full collection fetch.

## E. Optional next step: include validators in WS invalidations

After the HTTP-side split exists, the WebSocket payload can carry the new collection validator too:

- `sessions_invalidated { etag, lastModified }`
- `session_invalidated { sessionId, latestSeq, etag }`

This lets the client skip even the lightweight `HEAD` in many cases because it can compare the pushed validator against what it already has.

HTTP remains the source of truth; WebSocket only delivers the invalidation hint plus a validator.

## Suggested request flow after the change

For a known session ID on a fresh page load:

1. read cached session-list snapshot from `localStorage`
2. render sidebar from cache immediately
3. `GET /api/sessions/:sessionId`
4. `GET /api/sessions/:sessionId/events?afterSeq=0`
5. `HEAD /api/sessions` (or `GET /api/sessions/meta`)
6. only if validator changed: `GET /api/sessions`
7. open WebSocket without an immediate full HTTP refresh pass

For `sessions_invalidated` while connected:

1. `HEAD /api/sessions`
2. only if validator changed: `GET /api/sessions`

For `session_invalidated` while connected:

1. `GET /api/sessions/:sessionId`
2. `GET /api/sessions/:sessionId/events?afterSeq=<known cursor>`

## Recommended cache headers

For owner-scoped JSON responses:

- `Cache-Control: private, max-age=0, must-revalidate`
- `ETag: ...`
- `Last-Modified: ...` when practical
- `Vary: Cookie`

This keeps responses private while still allowing normal browser revalidation semantics.

## Minimal implementation order

1. expose cheap session-list collection version metadata from the session layer
2. add `HEAD /api/sessions` or `GET /api/sessions/meta`
3. persist session-list snapshot + ETag in the frontend
4. split current-session bootstrap from session-list bootstrap
5. remove unconditional `refreshRealtimeViews()` on the first successful WebSocket connect
6. add a regression test for the blank-session page-load sequence

## Expected outcome

If we do only the steps above, we should get most of the benefit with low risk:

- no mandatory full `GET /api/sessions` on every fresh session page load
- no immediate duplicate revalidation burst after WebSocket connect
- unchanged correctness model: WebSocket hints, HTTP truth, browser cache for reuse
- much lower cost for the “open a session just to look at it” path
