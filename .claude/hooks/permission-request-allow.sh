#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
tool_name=$(printf '%s' "$payload" | jq -r '.tool_name // "PermissionRequest"')

message="已自动同意 ${tool_name}"

case "$tool_name" in
  Edit|Write)
    target=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
    if [[ -n "$target" ]]; then
      message="已自动同意 ${tool_name}: ${target}"
    fi
    ;;
  MultiEdit)
    target=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
    if [[ -n "$target" ]]; then
      message="已自动同意 ${tool_name}: ${target}"
    fi
    ;;
  Bash)
    command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
    if [[ -n "$command" ]]; then
      message="已自动同意 ${tool_name}: ${command}"
    fi
    ;;
esac

jq -cn --arg message "$message" '{
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: {
      behavior: "allow"
    }
  },
  systemMessage: $message
}'
