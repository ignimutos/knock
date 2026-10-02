#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo "usage: $0 <command> [default-arg ...] -- [path ...]" >&2
  exit 1
fi

command_parts=()
default_args=()
paths=()
mode="command"

for arg in "$@"; do
  if [[ "$arg" == "--" ]]; then
    if [[ "$mode" == "command" ]]; then
      mode="default"
    elif [[ "$mode" == "default" ]]; then
      mode="paths"
    else
      paths+=("$arg")
    fi
    continue
  fi

  case "$mode" in
    command)
      command_parts+=("$arg")
      ;;
    default)
      default_args+=("$arg")
      ;;
    paths)
      paths+=("$arg")
      ;;
  esac
done

if [[ "${#command_parts[@]}" -eq 0 ]]; then
  echo "usage: $0 <command> [default-arg ...] -- [path ...]" >&2
  exit 1
fi

if [[ "${#paths[@]}" -eq 0 ]]; then
  exec "${command_parts[@]}" "${default_args[@]}"
fi

exec "${command_parts[@]}" "${paths[@]}"
