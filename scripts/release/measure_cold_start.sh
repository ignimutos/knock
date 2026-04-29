#!/usr/bin/env bash
set -euo pipefail

baseline_image="${BASE_IMAGE:?BASE_IMAGE is required}"
candidate_image="${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
ready_path="${READY_PATH:-/config}"
ready_marker="${READY_MARKER:-Knock Config}"
threshold_pct="${THRESHOLD_PCT:-30}"
samples="${SAMPLES:-3}"

if [ -z "$ready_path" ]; then
  echo "READY_PATH must not be empty" >&2
  exit 1
fi

if ! [[ "$samples" =~ ^[1-9][0-9]*$ ]]; then
  echo "SAMPLES must be a positive integer" >&2
  exit 1
fi

if ! [[ "$threshold_pct" =~ ^[0-9]+$ ]]; then
  echo "THRESHOLD_PCT must be an integer" >&2
  exit 1
fi

measure_once() {
  local image="$1"
  local runtime_dir=""
  local container_name=""
  local port started ended
  cleanup_measure_once() {
    if [ -n "${container_name:-}" ]; then
      docker rm -f "$container_name" >/dev/null 2>&1 || true
    fi
    if [ -n "${runtime_dir:-}" ]; then
      rm -rf "$runtime_dir"
    fi
  }

  trap cleanup_measure_once RETURN
  runtime_dir="$(mktemp -d)"
  container_name="knock-measure-$(date +%s)-$RANDOM"
  port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"

  cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
  chmod 0777 "$runtime_dir"
  chmod 0666 "$runtime_dir/config.yml"

  started="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

  docker run -d --rm \
    --name "$container_name" \
    -p "${port}:${port}" \
    -v "$runtime_dir:/app/runtime" \
    -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
    -e KNOCK_WEB_HOST=0.0.0.0 \
    -e KNOCK_WEB_PORT="$port" \
    "$image" >/dev/null

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${port}${ready_path}" | grep -q "$ready_marker"; then
      ended="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
      cleanup_measure_once
      container_name=""
      runtime_dir=""
      echo $((ended - started))
      return 0
    fi
    sleep 0.25
  done

  docker logs "$container_name" || true
  cleanup_measure_once
  container_name=""
  runtime_dir=""
  return 1
}

measure_series() {
  local image="$1"
  for _ in $(seq 1 "$samples"); do
    measure_once "$image"
  done
}

median_ms() {
  python3 - <<'PY' "$@"
import sys
values = sorted(int(value) for value in sys.argv[1:])
print(values[len(values) // 2])
PY
}

readarray -t baseline_runs < <(measure_series "$baseline_image")
readarray -t candidate_runs < <(measure_series "$candidate_image")

baseline_ms="$(median_ms "${baseline_runs[@]}")"
candidate_ms="$(median_ms "${candidate_runs[@]}")"
improvement_pct="$(python3 - <<PY
baseline = int(${baseline_ms})
candidate = int(${candidate_ms})
if baseline <= 0:
    raise SystemExit('baseline median must be positive')
print(round(((baseline - candidate) / baseline) * 100))
PY
)"

echo "baseline_runs=${baseline_runs[*]}"
echo "candidate_runs=${candidate_runs[*]}"
echo "baseline_median_ms=${baseline_ms}"
echo "candidate_median_ms=${candidate_ms}"
echo "improvement_pct=${improvement_pct}"

if [ "$improvement_pct" -lt "$threshold_pct" ]; then
  echo "cold-start improvement below threshold" >&2
  exit 1
fi
