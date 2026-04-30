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

main() {
  (
    set -euo pipefail

    local image entrypoint runtime_dir container_name client_tmp port config_html

    image="${KNOCK_IMAGE_TAG:-knock:local}"
    entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
    if [ "$entrypoint" != '["/app/docker-entrypoint.sh"]' ]; then
      echo "unexpected image entrypoint: expected [\"/app/docker-entrypoint.sh\"], got $entrypoint" >&2
      return 1
    fi

    runtime_dir="$(mktemp -d)"
    container_name="knock-smoke-$(date +%s)-$RANDOM"
    client_tmp="$(mktemp)"
    port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"

    cleanup() {
      docker rm -f "$container_name" >/dev/null 2>&1 || true
      rm -rf "$runtime_dir" "$client_tmp"
    }
    trap cleanup EXIT

    cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
    prepare_runtime_fixture "$runtime_dir"
    assert_runtime_fixture "$runtime_dir"

    docker run -d --rm \
      --name "$container_name" \
      -p "${port}:${port}" \
      -v "$runtime_dir:/app/runtime" \
      -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
      -e KNOCK_WEB_HOST=0.0.0.0 \
      -e KNOCK_WEB_PORT="$port" \
      "$image" >/dev/null

    for _ in $(seq 1 120); do
      config_html="$(curl -fsS "http://127.0.0.1:${port}/config")" || {
        sleep 0.25
        continue
      }
      if grep -Fq -- 'Knock Config' <<<"$config_html"; then
        curl -fsS "http://127.0.0.1:${port}/assets/client.js" >"$client_tmp"
        test -s "$client_tmp"
        return 0
      fi
      sleep 0.25
    done

    echo "image did not become ready" >&2
    return 1
  )
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
