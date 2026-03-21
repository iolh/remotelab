# Tests

Scenario-style validation scripts now live in this directory instead of the repo root.

- Run the current smoke suite with `npm test`.
- Pull requests run the same smoke suite automatically via GitHub Actions in `.github/workflows/ci.yml`.
- Run a specific script with `node tests/<name>.mjs`.
- `tests/chat` and `tests/lib` are symlinked import roots so existing relative test imports stay stable after the move.

High-value smoke scripts:

- `tests/test-session-naming.mjs`
- `tests/test-cloudflared-config.mjs`
- `tests/test-history-index-contract.mjs`
- `tests/test-session-route-utils.mjs`
- `tests/test-session-external-trigger-refresh.mjs`
- `tests/test-session-label-prompt-context.mjs`
- `tests/test-agent-mailbox.mjs`
- `tests/test-agent-mail-worker.mjs`
- `tests/test-agent-mail-reply.mjs`
