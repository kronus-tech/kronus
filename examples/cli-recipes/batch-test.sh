#!/usr/bin/env bash
# batch-test.sh — Run test-generator + test-runner across multiple projects
# Usage: ./examples/cli-recipes/batch-test.sh ~/projects/app1 ~/projects/app2

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <dir1> [dir2] [dir3] ..."
  echo "Example: $0 ~/projects/myapp ~/projects/api"
  exit 1
fi

echo "=== Batch Test Generation & Execution ==="
echo ""

# Step 1: Generate tests across all projects
echo "--- Step 1: Generating tests ---"
"${SCRIPT_DIR}/kronus-run.sh" \
  --task "Generate tests for all source files missing test coverage" \
  --agent test-generator \
  --dirs "$@" \
  --parallel \
  --jobs 4

echo ""

# Step 2: Run tests across all projects
echo "--- Step 2: Running tests ---"
"${SCRIPT_DIR}/kronus-run.sh" \
  --task "Execute all tests and report coverage" \
  --agent test-runner \
  --dirs "$@" \
  --parallel \
  --jobs 4

echo ""
echo "=== Batch testing complete ==="
