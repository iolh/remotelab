# Doubao Fast Agent

## What it is

`Doubao Fast Agent` is a low-latency local tool runner for Cue.

It deliberately does **not** try to be a full coding agent like Claude Code or Aider. Instead, it keeps the hot path thin:

1. accept a compact user prompt
2. call a domestic OpenAI-compatible model (`Ark / Doubao`)
3. allow a small set of local tools via function calling
4. stop after a short loop and return a concise answer

That makes it a better fit for voice and quick local actions, where tool support still matters but the heavy coding-agent shell is the main latency tax.

## Architecture

```text
Cue session / voice connector
  -> custom tool entry (`doubao-fast`)
    -> `scripts/doubao-fast-agent.mjs`
      -> Ark OpenAI-compatible `/chat/completions`
      -> local tool executor (`bash`, file read, clipboard, app open, notification)
      -> Claude-compatible JSON event stream back to Cue
```

Key design choices:

- `promptMode: bare-user`
- `flattenPrompt: true`
- compact internal system prompt owned by the agent script itself
- max tool loop default: `2`
- small, explicit local tool surface

This keeps Cue compatible with the existing `claude-stream-json` runtime without requiring a full provider refactor first.

## Why this shape

Heavy coding agents add substantial overhead even before they execute real local work:

- large system prompt shells
- repo-edit protocol instructions
- multi-turn edit planning defaults
- tool wrappers optimized for code tasks, not quick local actions

For low-latency operator flows, the right split is:

- **provider/model layer**: Doubao through Ark
- **thin orchestrator**: this script
- **local tool runtime**: explicit tools on the machine
- **heavy coding agents**: optional fallback for bigger repo tasks

## Built-in tools

- `bash` — short shell commands in the current working directory
- `list_dir` — directory listing
- `read_file` — small text file reads
- `clipboard_read`
- `clipboard_write`
- `open_app`
- `notify`

The first version intentionally stays small. If a task turns into a broad code-editing workflow, it should hand off to a heavier agent instead of gradually re-implementing one here.

## Install

```bash
node scripts/install-doubao-fast-agent.mjs --api-key <ark-key> --base-url https://ark.cn-beijing.volces.com/api/v3 --model doubao-seed-2-0-pro-260215
```

The installer:

- writes config to `~/.config/remotelab/doubao-fast-agent.json`
- registers a Cue custom tool in `~/.config/remotelab/tools.json`

If `~/.config/aider/doubao.env` already exists, the installer can reuse it.

## Use in Cue

After installation, choose tool `doubao-fast` when creating a session.

For voice flows, point the voice connector's `sessionTool` to `doubao-fast` and set the model to the real Ark model id or endpoint id, not a stale OpenAI model alias.

## Current limits

- stateless across turns by default (`bare-user` prompt mode)
- no repo map / broad coding workflow protocol
- no long-running detached job management
- no write-file primitive yet; use `bash` for small local mutations or hand off to a heavier agent

This is intentional for version one: keep the hot path thin, then expand only the pieces that earn their cost.
