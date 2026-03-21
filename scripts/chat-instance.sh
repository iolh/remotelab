#!/bin/bash
set -euo pipefail

ACTION="${1:-}"
shift || true

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/remotelab"

if [[ "$(uname)" == "Darwin" ]]; then
  DEFAULT_LOG_DIR="$HOME/Library/Logs"
else
  DEFAULT_LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/remotelab/logs"
fi

PORT=""
NAME=""
LOG_PATH=""
NODE_BIN="${NODE_BIN:-$(command -v node)}"
INSTANCE_HOME="$HOME"
SYNC_FROM_HOME=""
SECURE_COOKIES_VALUE=""

usage() {
  cat <<'EOF'
Usage:
  scripts/chat-instance.sh <start|stop|restart|status|logs|sync> [options]

Options:
  --port <port>    Chat server port (required for non-sync actions)
  --name <name>    Optional label used for pid/log filenames
  --home <path>    HOME to use for the instance runtime
  --sync-from-home <path>
                    Mirror ~/.config/remotelab and ~/.remotelab/memory from source HOME before start
  --log <path>     Explicit log path override
  --node <path>    Explicit node binary override
  --secure-cookies <0|1>
                    Override SECURE_COOKIES for the instance runtime

Examples:
  scripts/chat-instance.sh restart --port 7695 --name scratch
  scripts/chat-instance.sh start --port 7692 --name staging --home ~/.remotelab/instances/staging-home --sync-from-home ~ --secure-cookies 0
  scripts/chat-instance.sh sync --home ~/.remotelab/instances/staging-home --sync-from-home ~
  scripts/chat-instance.sh status --port 7695
  scripts/chat-instance.sh logs --port 7695

Notes:
  - This is for optional ad-hoc chat-server instances started manually on arbitrary ports.
  - Production service management still uses launchd/systemd via `remotelab restart chat`.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --home)
      INSTANCE_HOME="$2"
      shift 2
      ;;
    --sync-from-home)
      SYNC_FROM_HOME="$2"
      shift 2
      ;;
    --log)
      LOG_PATH="$2"
      shift 2
      ;;
    --node)
      NODE_BIN="$2"
      shift 2
      ;;
    --secure-cookies)
      SECURE_COOKIES_VALUE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ACTION" ]]; then
  usage >&2
  exit 1
fi

INSTANCE_TAG=""
PID_FILE=""

if [[ "$ACTION" != "sync" ]]; then
  if [[ -z "$PORT" ]]; then
    echo "Missing required argument: --port <port>" >&2
    usage >&2
    exit 1
  fi

  INSTANCE_TAG="${NAME:-$PORT}"
  LOG_PATH="${LOG_PATH:-$DEFAULT_LOG_DIR/chat-server-${INSTANCE_TAG}.log}"
  PID_FILE="$CONFIG_DIR/chat-server-${INSTANCE_TAG}.pid"

  mkdir -p "$CONFIG_DIR" "$(dirname "$LOG_PATH")"
fi

canonical_existing_dir() {
  local path
  path="${1/#\~/$HOME}"
  if [[ ! -d "$path" ]]; then
    echo "missing sync source home: $path" >&2
    exit 1
  fi
  (
    cd "$path"
    pwd -P
  )
}

canonical_target_dir() {
  local path
  path="${1/#\~/$HOME}"
  mkdir -p "$path"
  (
    cd "$path"
    pwd -P
  )
}

mirror_home_subdir() {
  local source_home relative_path target_home source_path target_path
  source_home="$1"
  relative_path="$2"
  target_home="$3"
  source_path="$source_home/$relative_path"
  target_path="$target_home/$relative_path"

  mkdir -p "$(dirname "$target_path")"
  if [[ ! -d "$source_path" ]]; then
    rm -rf "$target_path"
    return 0
  fi

  if command -v rsync >/dev/null 2>&1; then
    mkdir -p "$target_path"
    rsync -a --delete "$source_path/" "$target_path/"
    return 0
  fi

  rm -rf "$target_path"
  cp -R "$source_path" "$target_path"
}

sync_instance_home() {
  local source_home target_home
  source_home="$(canonical_existing_dir "$1")"
  target_home="$(canonical_target_dir "$2")"

  if [[ "$source_home" == "$target_home" ]]; then
    echo "refusing to sync home onto itself: $source_home" >&2
    exit 1
  fi

  mirror_home_subdir "$source_home" ".config/remotelab" "$target_home"
  mirror_home_subdir "$source_home" ".remotelab/memory" "$target_home"

  echo "synced data: $source_home -> $target_home"
}

listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

wait_for_bind() {
  for _ in $(seq 1 40); do
    local pid
    pid="$(listener_pid)"
    if [[ -n "$pid" ]]; then
      echo "$pid"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

stop_instance() {
  local pid
  pid="$(listener_pid)"
  if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    echo "chat-server on :$PORT is already stopped"
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "stopped :$PORT (pid $pid)"
      return 0
    fi
    sleep 0.25
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "force-stopped :$PORT (pid $pid)"
}

start_instance() {
  local pid
  local -a env_args
  pid="$(listener_pid)"
  if [[ -n "$pid" ]]; then
    echo "chat-server already listening on :$PORT (pid $pid)"
    echo "log: $LOG_PATH"
    return 0
  fi

  printf '\n=== start %s (port %s) ===\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$PORT" >> "$LOG_PATH"

  if [[ -n "$SYNC_FROM_HOME" ]]; then
    sync_instance_home "$SYNC_FROM_HOME" "$INSTANCE_HOME"
  fi

  env_args=(
    CHAT_PORT="$PORT"
    PATH="$PATH"
    HOME="$INSTANCE_HOME"
    USER="${USER:-}"
    SHELL="${SHELL:-/bin/bash}"
    SSH_AUTH_SOCK="${SSH_AUTH_SOCK:-}"
    TMPDIR="${TMPDIR:-/tmp}"
  )
  if [[ -n "$SECURE_COOKIES_VALUE" ]]; then
    env_args+=(SECURE_COOKIES="$SECURE_COOKIES_VALUE")
  fi

  (
    cd "$ROOT_DIR"
    nohup env \
      "${env_args[@]}" \
      "$NODE_BIN" chat-server.mjs >> "$LOG_PATH" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
  )

  pid="$(wait_for_bind)" || {
    echo "failed to start chat-server on :$PORT" >&2
    tail -n 40 "$LOG_PATH" >&2 || true
    exit 1
  }

  echo "started :$PORT (pid $pid)"
  echo "log: $LOG_PATH"
  echo "home: $INSTANCE_HOME"
}

show_status() {
  local pid
  pid="$(listener_pid)"
  if [[ -z "$pid" ]]; then
    echo "chat-server on :$PORT is not running"
    echo "log: $LOG_PATH"
    return 1
  fi

  echo "chat-server listening on :$PORT"
  echo "pid: $pid"
  echo "log: $LOG_PATH"
  echo "home: $INSTANCE_HOME"
  ps -p "$pid" -o pid=,ppid=,user=,lstart=,command=
}

show_logs() {
  tail -n 60 "$LOG_PATH"
}

case "$ACTION" in
  start)
    start_instance
    ;;
  stop)
    stop_instance
    ;;
  restart)
    stop_instance
    start_instance
    ;;
  sync)
    sync_instance_home "${SYNC_FROM_HOME:-$HOME}" "$INSTANCE_HOME"
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage >&2
    exit 1
    ;;
esac
