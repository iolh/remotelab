# Feishu Bot Setup Lessons

> Purpose: capture the practical setup lessons from a real Cue + Feishu bot rollout so future operators do not repeat the same mistakes.

---

## Short version

- For V0, use a **Feishu self-built app bot**.
- Use **persistent connection** instead of webhook mode.
- Subscribe **only** `im.message.receive_v1` first.
- The local connector only needs `App ID`, `App Secret`, and `region`; it can exchange access tokens by itself.
- A **personal-only / self-use tenant** is fine for validation, but a **team tenant** is the practical choice for sharing the bot with coworkers.
- A **self-built app** is effectively a **same-tenant** solution. If you want users in other tenants to install it, you need a **marketplace / distributable app** path.

---

## What blocked us in practice

### 1. Searchability and add-to-group are controlled by app availability

If other users cannot search the bot or cannot add it into a group, the first thing to check is not the code.

Check these first:

- the app's **availability scope**
- whether the current version has been **published / applied**
- whether those users are in the **test scope** if you are still on a test version
- whether tenant policy allows members to add apps/bots into groups

For the official version, availability changes typically flow through a new release / approval step.
For the test version, availability changes are usually faster to validate.

---

### 2. A self-built app is not a universal public bot

This is the main product / rollout distinction.

- For users in the **same Feishu tenant**, a self-built app bot can work well.
- For users in a **different tenant**, they usually cannot just search for and install your self-built app.

So the practical rule is:

- **same tenant** → expand availability scope and publish
- **different tenant** → move to a marketplace / distributable app flow

If the goal is "let coworkers use the bot", start with a real team tenant instead of treating a personal self-test setup as the final rollout environment.

---

### 3. Persistent connection must be alive before the console will accept it

When using Feishu's persistent connection mode, the developer console may show a warning like "No connection detected".

That is expected until the SDK client is already online.

The working order is:

1. start the local connector
2. establish the persistent connection successfully
3. go back to the Feishu console
4. save the persistent-connection subscription mode

If you try to save the mode before the connector is online, the console can look like the setup is broken even though the credentials are correct.

---

### 4. Minimal event configuration is enough for V0

For the first end-to-end bot validation, start with only this event:

- category: `Messenger`
- subscription type: `Tenant Token-Based Subscription`
- event label: `Receive message v2.0`
- event key: `im.message.receive_v1`

Do not begin by enabling a large set of events.

This keeps troubleshooting simple:

- no inbound message → first inspect the single message event
- inbound works but no reply → inspect permissions / send scopes

---

### 5. Inbound can work while outbound is still broken

One of the easiest traps is assuming that successful inbound events mean the bot is fully configured.

They do not.

In our rollout, inbound message receipt worked before outbound send permissions were complete.

The tell is Feishu API error `99991672` on `im.v1.message.create`.

If that happens, explicitly enable one of the outbound IM scopes Feishu names in the error, such as:

- `im:message:send`
- `im:message`
- `im:message:send_as_bot`

Once that scope is granted, the same connector code can start replying immediately.

---

### 6. The operator should hand over app credentials, not a manually minted tenant token

The simplest operator handoff is:

- `App ID`
- `App Secret`
- region (`Feishu CN` or `Lark Global`)
- confirmation that `im.message.receive_v1` is subscribed

The connector can exchange the tenant access token by itself.

So the important developer-platform artifacts are the **app credentials** and the **event / permission configuration**, not a manually copied long-lived token.

---

### 7. Event handlers must ack fast and process in the background

Feishu expects event handling to return quickly.

So the connector should:

- accept the event immediately
- log / normalize it
- decide whether the sender is allowed
- do the Cue run in the background
- send the final reply later

This matters because Cue / Codex response generation naturally takes longer than Feishu's event callback budget.

---

## Recommended rollout path

### Phase 1 — personal validation

- create one self-built app bot
- verify p2p chat with the operator account
- verify outbound reply works
- verify persistent connection works reliably

### Phase 2 — same-tenant testers

- expand app availability to a small tester set inside the same tenant
- verify they can search the bot
- verify they can add it into a normal group
- keep non-whitelisted senders in **log-only** mode until trusted

### Phase 3 — broader internal rollout

- widen app availability to more departments or the whole tenant
- decide whether to keep connector-level whitelist / allowlist controls
- add group-only policy such as "reply only when @mentioned"

### Phase 4 — cross-tenant distribution

- convert or recreate the bot as a marketplace / distributable app
- pass the review / publish flow
- let each external tenant install it explicitly

---

## Cue-specific behavior to remember

In our setup:

- one Feishu bot identity maps to one Cue connector
- p2p chat behaves like a direct session
- group chat behaves like a shared session surface
- sender whitelist is enforced **in our connector**, not in Feishu itself
- the current temporary whitelist model is a tiny local JSON file re-read on each inbound event, so small allowlist edits do not require a connector restart
- blocked senders are still **logged**, but they do **not** enter the model layer and do **not** trigger replies

This is useful for staged rollout:

- widen Feishu availability first
- observe who is sending messages
- then selectively add those senders into the connector whitelist

---

## Minimal operator checklist

- Create a self-built app
- Enable bot capability
- Capture `App ID`, `App Secret`, and region
- Enable the minimum read / send permissions
- If outbound send fails, grant the exact IM send scope named in Feishu's error
- Use persistent connection mode
- Subscribe `im.message.receive_v1`
- Start the local connector before saving the event mode
- Publish / apply the version and expand availability for the intended users
- Validate p2p first, then group usage

---

## Related notes

- `notes/feishu-bot-operator-checklist.md`
- `notes/feishu-bot-connector.md`
