# Cue Cloudflare Email Worker

Minimal Cloudflare edge for a mailbox such as `agent@example.com`.

Operator flow is model-first and prompt-first: ask an AI agent on the host machine to deploy this package, give it the needed Cloudflare and mailbox context in one early handoff, and only step in for real Cloudflare auth or dashboard changes. Use `docs/cloudflare-email-worker.md` for the human-facing deployment contract.

Flow:

`Internet -> Cloudflare Email Routing -> Email Worker(email) -> local mailbox bridge -> local agent-mail-worker -> Cue -> completion target -> Email Worker(fetch) -> Cloudflare send_email`

## Design goal

- Keep Cloudflare thin: inbound forwarding + outbound send only
- Keep business logic local: allowlist, review, automation, session creation, reply generation
- Avoid SMTP setup and provider-specific workflow lock-in

## Runtime responsibilities

1. receive inbound mail from Cloudflare Email Routing
2. forward the raw message to the local mailbox bridge webhook
3. accept authenticated `POST /api/send-email` requests from Cue completion targets
4. send replies through Cloudflare `send_email`

## Required config

Configured in `wrangler.example.jsonc` and then copied locally to `wrangler.jsonc`:

- `MAILBOX_FROM`
- `MAILBOX_BRIDGE_URL`

Configured as secrets during deploy:

- `OUTBOUND_API_TOKEN`
- `MAILBOX_BRIDGE_TOKEN`

## Deploy

```bash
cd ~/code/remotelab/cloudflare/email-worker
cp wrangler.example.jsonc wrangler.jsonc
./deploy.sh
```

The deploy script reads the local mailbox config, uploads the needed secrets, and deploys the Worker with Wrangler.

## Endpoints

- `GET /healthz` — lightweight health check
- `POST /api/send-email` — authenticated outbound sender used by Cue completion targets
