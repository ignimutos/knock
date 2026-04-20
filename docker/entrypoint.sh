#!/bin/sh
set -eu

has_flag() {
  flag="$1"
  shift

  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$flag" ]; then
      return 0
    fi
    shift
  done

  return 1
}

should_enable_immediate() {
  value="${KNOCK_IMMEDIATE:-}"

  case "$value" in
    "")
      return 1
      ;;
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    0|false|FALSE|no|NO|off|OFF)
      return 1
      ;;
    *)
      printf '%s\n' "KNOCK_IMMEDIATE 非法: $value" >&2
      exit 1
      ;;
  esac
}

if [ "$#" -eq 0 ]; then
  set -- deno task start
fi

if [ "$#" -ge 3 ] && [ "$1" = "deno" ] && [ "$2" = "task" ] && [ "$3" = "start" ]; then
  if ! has_flag --config "$@" && [ -n "${KNOCK_CONFIG_PATH:-}" ]; then
    set -- "$@" --config "$KNOCK_CONFIG_PATH"
  fi

  if ! has_flag --web_host "$@" && [ -n "${KNOCK_WEB_HOST:-}" ]; then
    set -- "$@" --web_host "$KNOCK_WEB_HOST"
  fi

  if ! has_flag --web_port "$@" && [ -n "${KNOCK_WEB_PORT:-}" ]; then
    set -- "$@" --web_port "$KNOCK_WEB_PORT"
  fi

  if ! has_flag --immediate "$@" && should_enable_immediate; then
    set -- "$@" --immediate
  fi
fi

exec "$@"
