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

rewrite_start=0

if [ "$#" -eq 0 ]; then
  rewrite_start=1
  set --
fi

if [ "$#" -ge 3 ] && [ "$1" = "deno" ] && [ "$2" = "task" ] && [ "$3" = "start" ]; then
  rewrite_start=1
  shift 3
fi

if [ "$rewrite_start" -eq 1 ]; then
  if ! has_flag --config "$@" && [ -n "${KNOCK_CONFIG_PATH:-}" ]; then
    set -- "$@" --config "$KNOCK_CONFIG_PATH"
  fi

  target_mode=web
  index=1
  while [ "$index" -le "$#" ]; do
    eval "arg=\${$index}"
    if [ "$arg" = "--mode" ]; then
      next_index=$((index + 1))
      if [ "$next_index" -le "$#" ]; then
        eval "target_mode=\${$next_index}"
      fi
      break
    fi
    index=$((index + 1))
  done

  if [ "$target_mode" = "web" ] && ! has_flag --web_host "$@" && [ -n "${KNOCK_WEB_HOST:-}" ]; then
    set -- "$@" --web_host "$KNOCK_WEB_HOST"
  fi

  if [ "$target_mode" = "web" ] && ! has_flag --web_port "$@" && [ -n "${KNOCK_WEB_PORT:-}" ]; then
    set -- "$@" --web_port "$KNOCK_WEB_PORT"
  fi

  if ! has_flag --immediate "$@" && should_enable_immediate; then
    set -- "$@" --immediate
  fi

  set -- \
    deno eval \
    --cached-only \
    --node-modules-dir=none \
    'import { main } from "./src/main.ts"; await main(Deno.args)' \
    -- \
    "$@"
fi

exec "$@"
