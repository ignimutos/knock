#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
first_line="PermissionRequest"
diagnostic=""

emit_allow_json() {
  local message="$1"
  jq -cn --arg message "$message" '{
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "allow"
      }
    },
    systemMessage: $message
  }'
}

append_diagnostic() {
  local line="$1"
  if [[ -n "$line" ]]; then
    diagnostic="$line"
  fi
}

join_message() {
  if [[ -n "$diagnostic" ]]; then
    printf '%s\n%s' "$first_line" "$diagnostic"
  else
    printf '%s' "$first_line"
  fi
}

jq_read() {
  local filter="$1"
  if ! printf '%s' "$payload" | jq -r "$filter" 2>/dev/null; then
    return 1
  fi
}

summarize_bash_command() {
  local command="$1"
  local normalized
  normalized=$(printf '%s' "$command" | tr '\n\r\t' '   ' | tr -s ' ')
  normalized="${normalized# }"
  normalized="${normalized% }"

  local executable
  executable=$(printf '%s' "$normalized" | jq -Rr 'split(" ") | map(select(length > 0)) | .[0] // empty')
  if [[ -z "$executable" ]]; then
    executable="command"
  fi

  local arg_count
  arg_count=$(printf '%s' "$normalized" | jq -Rr 'split(" ") | map(select(length > 0)) | length')
  if [[ -z "$arg_count" || "$arg_count" == "null" ]]; then
    arg_count=0
  fi
  if (( arg_count > 0 )); then
    arg_count=$((arg_count - 1))
  fi

  local summary="${executable} [args=${arg_count}]"
  local prefix="Bash: "
  local max_line_length=120
  local full_line="${prefix}${summary}"
  local full_length=${#full_line}

  if (( ${#normalized} <= max_line_length - ${#prefix} )); then
    printf '%s' "$full_line"
    return 0
  fi

  local suffix="… [len=${#normalized}]"
  local summary_budget=$(( max_line_length - ${#prefix} - ${#suffix} ))
  if (( summary_budget < 1 )); then
    summary_budget=1
  fi

  printf '%s%s%s' "$prefix" "${summary:0:summary_budget}" "$suffix"
}

if ! printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
  append_diagnostic "invalid-json"
  emit_allow_json "$(join_message)"
  exit 0
fi

tool_name="PermissionRequest"
if extracted_tool_name=$(jq_read '.tool_name | if . == null then "PermissionRequest" elif type == "string" then . else error("parse-failed") end'); then
  tool_name="$extracted_tool_name"
else
  append_diagnostic "parse-failed"
  emit_allow_json "$(join_message)"
  exit 0
fi

first_line="$tool_name"

case "$tool_name" in
  Edit|Write|MultiEdit)
    if target=$(jq_read '.tool_input | if . == null then empty elif type == "object" then (.file_path | if . == null then empty elif type == "string" then . else error("parse-failed") end) else error("parse-failed") end'); then
      if [[ -n "$target" ]]; then
        first_line="${tool_name}: ${target}"
      else
        append_diagnostic "missing:tool_input.file_path"
      fi
    else
      append_diagnostic "parse-failed"
    fi
    ;;
  Bash)
    if command=$(jq_read '.tool_input | if . == null then empty elif type == "object" then (.command | if . == null then empty elif type == "string" then . else error("parse-failed") end) else error("parse-failed") end'); then
      if [[ -n "$command" ]]; then
        first_line=$(summarize_bash_command "$command")
      else
        append_diagnostic "missing:tool_input.command"
      fi
    else
      append_diagnostic "parse-failed"
    fi
    ;;
esac

emit_allow_json "$(join_message)"
