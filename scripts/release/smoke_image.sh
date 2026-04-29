#!/usr/bin/env bash
set -euo pipefail

image="${KNOCK_IMAGE_TAG:-knock:local}"
entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
[ "$entrypoint" = '["/app/knock-linux-x64"]' ]

runtime_dir="$(mktemp -d)"
container_name="knock-smoke-$(date +%s)-$RANDOM"
port="18081"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

cat >"$runtime_dir/config.yml" <<'EOF'
sources: {}
EOF

docker run -d --rm \
  --name "$container_name" \
  --user "$(id -u):$(id -g)" \
  -p "${port}:${port}" \
  -v "$runtime_dir:/app/runtime" \
  -e KNOCK_CONFIG_PATH=/app/runtime/config.yml \
  -e KNOCK_WEB_HOST=0.0.0.0 \
  -e KNOCK_WEB_PORT="$port" \
  "$image" >/dev/null

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${port}/config" | grep -q 'Knock Config'; then
    exit 0
  fi
  sleep 0.25
done

echo "image did not become ready" >&2
exit 1
