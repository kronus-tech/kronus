#!/usr/bin/env bash
# pre-bash-check.sh — Hook to block destructive bash commands
# Called by Claude Code PreToolUse hook before Bash tool execution

set -euo pipefail

# Read the tool input from stdin
INPUT=$(cat)

# Extract the command being run
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"command"[[:space:]]*:[[:space:]]*"//;s/"$//' 2>/dev/null || echo "")

# Destructive patterns to block
BLOCKED_PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "rm -rf \$HOME"
  "sudo rm"
  "mkfs"
  "dd if="
  ":(){:|:&};:"
  "chmod -R 777 /"
  "git push --force origin main"
  "git push --force origin master"
  "git reset --hard"
  "DROP TABLE"
  "DROP DATABASE"
  "truncate"
  "> /dev/sda"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qi "$pattern"; then
    echo '{"error": "BLOCKED: Destructive command detected: '"$pattern"'"}' >&2
    exit 2
  fi
done

# Command is safe, allow execution
exit 0
