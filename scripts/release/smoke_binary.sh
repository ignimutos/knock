#!/usr/bin/env bash
set -euo pipefail

binary="${1:-./dist/knock-linux-x64}"
workdir="$(mktemp -d)"
client_tmp="$(mktemp)"
port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"
web_pid=""
all_pid=""

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
  stop_pid "$web_pid"
  stop_pid "$all_pid"
  rm -rf "$workdir" "$client_tmp"
}
trap cleanup EXIT

wait_for_ready() {
  local target_port="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${target_port}/config" | grep -q 'Knock Config'; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

cat >"$workdir/config.yml" <<'EOF'
sources: {}
EOF

"$binary" --mode daemon --runtime_dir "$workdir" --once

KNOCK_RUNTIME_DIR="$workdir" "$binary" --mode web --web_host 127.0.0.1 --web_port "$port" >/tmp/knock-web.log 2>&1 &
web_pid="$!"
wait_for_ready "$port"
stop_pid "$web_pid"
web_pid=""

KNOCK_RUNTIME_DIR="$workdir" "$binary" --mode all --web_host 127.0.0.1 --web_port "$port" >/tmp/knock-all.log 2>&1 &
all_pid="$!"
wait_for_ready "$port"
curl -fsS "http://127.0.0.1:${port}/assets/client.js" >"$client_tmp"
test -s "$client_tmp"
