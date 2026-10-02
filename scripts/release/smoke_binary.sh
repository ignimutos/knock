#!/usr/bin/env bash
set -euo pipefail

binary="${1:-./dist/knock-linux-x64}"
workdir="$(mktemp -d)"
daemon_pid=""

stop_pid() {
  local pid="$1"
  if [ -z "$pid" ]; then
    return 0
  fi
  kill "$pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 0.1
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  stop_pid "$daemon_pid"
  rm -rf "$workdir"
}
trap cleanup EXIT

cat >"$workdir/config.yml" <<'EOF'
sources: {}
EOF

# daemon --once: config load + sqlite init + one scheduled tick must exit cleanly
"$binary" --runtime_dir "$workdir" --once

# daemon long-running: process must stay alive, then stop cleanly on SIGTERM
KNOCK_RUNTIME_DIR="$workdir" "$binary" >/tmp/knock-daemon.log 2>&1 &
daemon_pid="$!"

for _ in $(seq 1 20); do
  if ! kill -0 "$daemon_pid" >/dev/null 2>&1; then
    echo "daemon exited unexpectedly during liveness check" >&2
    exit 1
  fi
  sleep 0.1
done

stop_pid "$daemon_pid"
daemon_pid=""

# removed web mode flags must be rejected
if "$binary" --runtime_dir "$workdir" --mode web >/dev/null 2>&1; then
  echo "expected --mode to be rejected" >&2
  exit 1
fi
