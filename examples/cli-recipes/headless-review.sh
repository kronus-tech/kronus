#!/usr/bin/env bash
# headless-review.sh — Automated headless code review
# Usage: ./examples/cli-recipes/headless-review.sh ~/projects/myapp

set -euo pipefail

PROJECT_DIR="${1:-.}"

echo "=== Headless Code Review ==="
echo "Project: ${PROJECT_DIR}"
echo ""

# Run code-reviewer in headless mode
claude -p "Invoke code-reviewer to analyze the latest changes: $(cd "$PROJECT_DIR" && git diff --stat HEAD~1 2>/dev/null || echo 'no recent commits')" \
  --cwd "$PROJECT_DIR" \
  --output-format json

echo ""
echo "=== Review Complete ==="
