#!/usr/bin/env bash
# post-write-lint.sh — Hook to lint check after file writes
# Called by Claude Code PostToolUse hook after Write/Edit tool execution

set -euo pipefail

# Read the tool input from stdin
INPUT=$(cat)

# Extract the file path from the tool result
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//' 2>/dev/null || echo "")

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Get file extension
EXT="${FILE_PATH##*.}"

# Run appropriate linter based on file type
case "$EXT" in
  ts|tsx|js|jsx)
    if command -v npx &>/dev/null && [[ -f "$(dirname "$FILE_PATH")/node_modules/.bin/eslint" || -f "package.json" ]]; then
      npx eslint --no-error-on-unmatched-pattern "$FILE_PATH" 2>/dev/null || true
    fi
    ;;
  py)
    if command -v python3 &>/dev/null; then
      python3 -m py_compile "$FILE_PATH" 2>/dev/null || true
    fi
    ;;
  json)
    if command -v jq &>/dev/null; then
      jq empty "$FILE_PATH" 2>/dev/null || echo "Warning: Invalid JSON in $FILE_PATH" >&2
    elif command -v python3 &>/dev/null; then
      python3 -c "import json; json.load(open('$FILE_PATH'))" 2>/dev/null || echo "Warning: Invalid JSON in $FILE_PATH" >&2
    fi
    ;;
  yaml|yml)
    if command -v python3 &>/dev/null; then
      python3 -c "import yaml; yaml.safe_load(open('$FILE_PATH'))" 2>/dev/null || true
    fi
    ;;
esac

exit 0
