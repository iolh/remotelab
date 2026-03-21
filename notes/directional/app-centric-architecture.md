# App-Centric Architecture Direction

> 当前 shipped 架构请看 `docs/project-architecture.md`。
> 当前 domain/refactor 基线请看 `notes/current/core-domain-contract.md`。
> 本文档只保留 App-centric 方向中最值得继续指导未来设计的部分。

---

## Core Idea

The long-term direction is simple:

> default owner chat and shared/public Apps should be understood as the same product grammar, expressed through different policy scopes.

In other words:

- “normal chat” is not a separate species
- an App is not only a public template
- a session is still the live conversation thread
- App is the reusable policy/bootstrap layer around that thread

---

## Recommended Mental Model

A clean stack looks like this:

1. **Agent kernel** — the real machine-owning worker
2. **Principal** — who is acting
3. **App policy** — capability, bootstrap, and presentation policy
4. **Session** — one durable thread of work under that policy
5. **Environment** — optional execution/isolation choice

Short form:

```text
session = thread(agent, principal, app policy, environment)
```

This keeps four questions separate:

- who is acting? → principal
- what kind of identity/policy is being expressed? → app
- what thread is live right now? → session
- where does execution happen? → environment

---

## Current vs Target

### Current shipped model

Today, App is still mostly:

- a shareable template
- a welcome/system-prompt package
- a scoped entry point for non-owner use

That is useful, but narrower than the intended abstraction.

### Target direction

Longer term, App becomes the universal policy layer that can define:

- bootstrap instructions
- defaults for tools/providers/models
- capability boundaries
- visibility/memory scope
- presentation hints
- share/onboarding behavior
- environment class requests

The default owner experience would then also be expressed through a built-in App.

---

## What Must Stay True

### Session should remain explicit

App is reusable policy.
Session is live work.

Do not collapse them into one object.

### Share should remain separate

A share snapshot is publication over a frozen slice of work.
It should not become the same thing as an App.

### Permissions stay server-enforced

App may shape policy, but the server remains the final authority for access.
The model should not become the permission system.

### Environment remains platform-defined

The App can request a class of execution environment, but the platform enforces what classes exist.

---

## Practical Consequences

If this direction continues, it suggests:

- every session should conceptually belong to one App, including owner-default chat
- owner vs visitor should gradually become a compatibility layer over deeper capability/app semantics
- App bootstrap should become more structured than “system prompt + optional welcome message”
- frontend variation should remain downstream of App policy rather than becoming a second product taxonomy

---

## Questions Worth Deferring

These are real questions, but they should be handled deliberately rather than piecemeal:

- what is the minimal durable App schema?
- how much capability policy belongs in App vs Principal?
- when should the owner-default App become explicit in storage and UI?
- how far should App-defined presentation go before it becomes a separate UI platform?

---

## Related Docs

- `notes/current/core-domain-contract.md` — current canonical object boundaries
- `notes/directional/product-vision.md` — broader product bets
- `docs/creating-apps.md` — current user-facing App guide
