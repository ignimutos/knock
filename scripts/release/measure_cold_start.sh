#!/usr/bin/env bash

prepare_runtime_fixture() {
  local runtime_dir
  runtime_dir="$1"

  chmod 0700 "$runtime_dir"
  chmod 0644 "$runtime_dir/config.yml"
}

assert_runtime_fixture() {
  local runtime_dir config_path dir_mode config_mode
  runtime_dir="$1"
  config_path="$runtime_dir/config.yml"

  if [ ! -d "$runtime_dir" ]; then
    echo 'runtime fixture check failed: runtime_dir must exist and be a directory' >&2
    return 1
  fi

  if [ ! -f "$config_path" ]; then
    echo 'runtime fixture check failed: config.yml must exist and be a regular file' >&2
    return 1
  fi

  dir_mode="$(stat -c '%a' "$runtime_dir")"
  if [ "$dir_mode" != "700" ]; then
    echo "runtime fixture check failed: expected runtime_dir mode 700, got $dir_mode" >&2
    return 1
  fi

  config_mode="$(stat -c '%a' "$config_path")"
  if [ "$config_mode" != "644" ]; then
    echo "runtime fixture check failed: expected config.yml mode 644, got $config_mode" >&2
    return 1
  fi
}

measure_once() {
  local image="$1"
  local runtime_dir=""
  local started ended
  cleanup_measure_once() {
    if [ -n "${runtime_dir:-}" ]; then
      rm -rf "$runtime_dir"
    fi
  }

  trap cleanup_measure_once RETURN
  runtime_dir="$(mktemp -d)"

  cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
  prepare_runtime_fixture "$runtime_dir"
  assert_runtime_fixture "$runtime_dir"

  started="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

  if ! docker run --rm \
    -v "$runtime_dir:/app/runtime" \
    -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
    -e KNOCK_ONCE=1 \
    "$image" >/dev/null 2>&1; then
    echo "daemon once run failed for $image" >&2
    return 1
  fi

  ended="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  echo $((ended - started))
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

main() {
  set -euo pipefail

  local baseline_image candidate_image samples
  local baseline_ms candidate_ms improvement_pct baseline_output candidate_output
  local -a baseline_runs candidate_runs

  baseline_image="${BASE_IMAGE:?BASE_IMAGE is required}"
  candidate_image="${CANDIDATE_IMAGE:?CANDIDATE_IMAGE is required}"
  samples="${SAMPLES:-3}"

  if ! [[ "$samples" =~ ^[1-9][0-9]*$ ]]; then
    echo "SAMPLES must be a positive integer" >&2
    return 1
  fi

  if ! baseline_output="$(measure_series "$baseline_image")"; then
    echo "baseline series failed before collecting $samples samples" >&2
    return 1
  fi

  if ! candidate_output="$(measure_series "$candidate_image")"; then
    echo "candidate series failed before collecting $samples samples" >&2
    return 1
  fi

  readarray -t baseline_runs < <(printf '%s' "$baseline_output")
  readarray -t candidate_runs < <(printf '%s' "$candidate_output")

  if [ "${#baseline_runs[@]}" -ne "$samples" ]; then
    echo "expected $samples baseline samples, got ${#baseline_runs[@]}" >&2
    return 1
  fi

  if [ "${#candidate_runs[@]}" -ne "$samples" ]; then
    echo "expected $samples candidate samples, got ${#candidate_runs[@]}" >&2
    return 1
  fi

  baseline_ms="$(median_ms "${baseline_runs[@]}")"
  candidate_ms="$(median_ms "${candidate_runs[@]}")"
  improvement_pct="$(python3 - <<PY
baseline = int(${baseline_ms})
candidate = int(${candidate_ms})
if baseline <= 0:
    raise SystemExit('baseline median must be positive')
print(int(((baseline - candidate) / baseline) * 100))
PY
)"

  echo "baseline_runs=${baseline_runs[*]}"
  echo "candidate_runs=${candidate_runs[*]}"
  echo "baseline_median_ms=${baseline_ms}"
  echo "candidate_median_ms=${candidate_ms}"
  echo "improvement_pct=${improvement_pct}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
