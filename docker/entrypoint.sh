#!/bin/sh
set -eu

APP_BIN="${APP_BIN:-/app/knock-linux-x64}"
RUNTIME_DIR="${KNOCK_RUNTIME_DIR:-/app/runtime}"
DEFAULT_UID="${APP_UID:-10001}"
DEFAULT_GID="${APP_GID:-10001}"

warn() {
  printf '%s\n' "$*" >&2
}

read_runtime_owner() {
  runtime_dir="$1"
  stat -c '%u:%g' "$runtime_dir"
}

resolve_target_identity() {
  default_uid="$1"
  default_gid="$2"
  runtime_uid="${3:-}"
  runtime_gid="${4:-}"

  target_uid="$default_uid"
  target_gid="$default_gid"
  keep_root=0

  if [ -n "$runtime_uid" ] && [ -n "$runtime_gid" ]; then
    target_uid="$runtime_uid"
    target_gid="$runtime_gid"
  fi

  if [ "$target_uid" = "0" ] || [ "$target_gid" = "0" ]; then
    keep_root=1
  fi

  printf '%s:%s keep-root=%s\n' "$target_uid" "$target_gid" "$keep_root"
}

fix_runtime_permissions() {
  runtime_dir="$1"
  target_uid="$2"
  target_gid="$3"

  if [ -d "$runtime_dir" ]; then
    if ! chown -R "${target_uid}:${target_gid}" "$runtime_dir" 2>/dev/null; then
      warn "warn: chown failed for $runtime_dir"
    fi
    if ! chmod -R u+rwX "$runtime_dir" 2>/dev/null; then
      warn "warn: chmod u+rwX failed for $runtime_dir"
    fi
    if ! chmod -R g+rwX "$runtime_dir" 2>/dev/null; then
      warn "warn: chmod g+rwX failed for $runtime_dir"
    fi
  fi
}

exec_app() {
  target_uid="$1"
  target_gid="$2"
  keep_root="$3"
  shift 3

  if [ "$(id -u)" -eq 0 ] && [ "$keep_root" != "1" ] && [ "$target_uid" != "0" ] && [ "$target_gid" != "0" ] && command -v gosu >/dev/null 2>&1; then
    exec gosu "${target_uid}:${target_gid}" "$APP_BIN" "$@"
  fi

  exec "$APP_BIN" "$@"
}

main() {
  runtime_dir="$RUNTIME_DIR"
  runtime_uid=''
  runtime_gid=''

  if [ -d "$runtime_dir" ]; then
    owner="$(read_runtime_owner "$runtime_dir" 2>/dev/null || true)"
    if [ -n "$owner" ]; then
      runtime_uid="${owner%%:*}"
      runtime_gid="${owner##*:}"
    fi
  fi

  identity="$(resolve_target_identity "$DEFAULT_UID" "$DEFAULT_GID" "$runtime_uid" "$runtime_gid")"
  target_uid="${identity%%:*}"
  rest="${identity#*:}"
  target_gid="${rest%% *}"
  keep_root="${identity##*keep-root=}"

  if [ "$(id -u)" -eq 0 ] && [ -d "$runtime_dir" ]; then
    fix_runtime_permissions "$runtime_dir" "$target_uid" "$target_gid"
  fi

  exec_app "$target_uid" "$target_gid" "$keep_root" "$@"
}

if [ "${0##*/}" = "entrypoint.sh" ] || [ "${0##*/}" = "docker-entrypoint.sh" ]; then
  main "$@"
fi
