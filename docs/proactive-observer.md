# Proactive Observer Prototype

This document describes the first local-service prototype for a proactive, session-first home observer.

## Why this exists

This is **not** another thin passive connector like Feishu or email.

The prototype is a separate local service that:

- watches high-frequency local signals,
- decides when a moment is meaningful enough to escalate,
- creates one RemoteLab session per triggered episode,
- and then lets the normal agent/runtime do the substantive work.

For the first prototype, the target flow is:

1. detect that the user just arrived home,
2. greet them,
3. listen for one immediate spoken request,
4. send that spoken request into the same episode session,
5. let the agent fulfill the request on the Mac when appropriate.

`Pocket 3` should be treated as a **camera provider**, not as the architecture itself.

## Architecture

The implementation lives in `scripts/proactive-observer.mjs` and is intentionally decoupled from the main RemoteLab server process.

Layers:

- `Provider layer` — camera snapshots, speech capture, optional manual HTTP event injection
- `Trigger layer` — detects meaningful transitions such as `arrival`
- `Episode layer` — creates one durable RemoteLab session per trigger firing
- `Agent layer` — uses a normal RemoteLab session/run flow to greet and fulfill requests
- `Actuator layer` — local TTS speaks the assistant reply aloud

## Current prototype contract

The default trigger is `home-arrival`.

When the observer decides that a new arrival happened:

- it creates a new session with a unique `externalTriggerId`
- asks the agent to greet the user warmly and briefly
- optionally listens once for a follow-up spoken request
- submits that transcript into the same session
- speaks the assistant reply

This means the service stays session-first while still being proactive.

## Files

- `scripts/proactive-observer.mjs` — standalone local service + CLI + HTTP control surface
- `scripts/proactive-observer-instance.sh` — start/stop/status/log helper
- `scripts/proactive-observer-human-detect.swift` — local human-presence detector using Apple Vision
- `scripts/proactive-observer-listen-once.swift` — one-shot speech capture/transcription using macOS Speech

## Config

Print a starter config with:

```bash
node scripts/proactive-observer.mjs --print-config
```

Write it to:

- `~/.config/remotelab/proactive-observer/config.json`

Important fields:

- `camera.enabled`
- `camera.avfoundationDevice`
- `vision.detectorCommand`
- `speech.listenCommand`
- `tts.mode`
- `triggers`

## Pocket 3 note

The service expects the camera provider to expose a normal local video input or capture command.

On this machine, `ffmpeg` currently does **not** list a real camera device yet, so `Pocket 3` likely still needs the right webcam/UVC mode or OS permission path before the live vision loop can use it.

Quick check:

```bash
ffmpeg -f avfoundation -list_devices true -i ''
```

If the camera appears there, set `camera.avfoundationDevice` to the video index.

## Manual smoke test

Before trusting the real camera loop, validate the episode flow manually:

```bash
node scripts/proactive-observer.mjs --event arrival --transcript "我今天情绪挺好，给我放首歌" --no-speak
```

That does:

- create one arrival episode session
- ask the agent to greet
- feed the sample transcript into the same session
- print the result path / JSON locally

## Camera debug

If the camera is configured, capture and analyze one frame with:

```bash
node scripts/proactive-observer.mjs --once-camera --no-speak
```

## Service mode

Run directly:

```bash
node scripts/proactive-observer.mjs
```

Or via the helper:

```bash
./scripts/proactive-observer-instance.sh start
```

HTTP endpoints:

- `GET /health`
- `GET /state`
- `POST /events`

Example manual injection:

```bash
curl -sS -X POST http://127.0.0.1:7960/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"arrival","source":"manual"}'
```

## Design stance

- keep RemoteLab as the durable session/runtime substrate
- keep this observer as a separate local service with its own logic and state
- use minimal deterministic logic only for transition detection, cooldown, and dedupe
- push meaning, greeting style, and action choice into the model/session layer
