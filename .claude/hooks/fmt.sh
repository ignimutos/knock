#!/usr/bin/env bash
set -euo pipefail

if ! jq -r '.tool_input.file_path // .tool_response.filePath // empty' \
  | { read -r f || exit 0; deno task fmt "$f"; }; then
  exit 0
fi
