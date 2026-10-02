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

    local image entrypoint runtime_dir

    image="${KNOCK_IMAGE_TAG:-knock:local}"
    entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
    if [ "$entrypoint" != '["/app/docker-entrypoint.sh"]' ]; then
      echo "unexpected image entrypoint: expected [\"/app/docker-entrypoint.sh\"], got $entrypoint" >&2
      return 1
    fi

    runtime_dir="$(mktemp -d)"

    cleanup() {
      rm -rf "$runtime_dir"
    }
    trap cleanup EXIT

    cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF
    prepare_runtime_fixture "$runtime_dir"
    assert_runtime_fixture "$runtime_dir"

    # daemon cold-run: KNOCK_ONCE=1 must load config, init sqlite and exit cleanly
    docker run --rm \
      -v "$runtime_dir:/app/runtime" \
      -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
      -e KNOCK_ONCE=1 \
      "$image"
  )
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
