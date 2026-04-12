#!/usr/bin/env bash
# ci-pipeline.sh — CI/CD pipeline using Kronus agents
# Usage: ./examples/cli-recipes/ci-pipeline.sh

set -euo pipefail

PROJECT_DIR="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts"

echo "=== Kronus CI Pipeline ==="
echo "Project: ${PROJECT_DIR}"
echo ""

# Step 1: Code Review
echo "--- Step 1: Code Review ---"
"${SCRIPT_DIR}/kronus-run.sh" \
  --task "Review all changes in the current branch compared to main" \
  --agent code-reviewer \
  --dirs "$PROJECT_DIR" \
  --output-format json

# Step 2: Security Audit
echo ""
echo "--- Step 2: Security Audit ---"
"${SCRIPT_DIR}/kronus-run.sh" \
  --task "Run full security audit: dependencies, SAST, secrets" \
  --agent security-auditor \
  --dirs "$PROJECT_DIR" \
  --output-format json

# Step 3: Test Generation + Execution
echo ""
echo "--- Step 3: Test & Coverage ---"
"${SCRIPT_DIR}/kronus-run.sh" \
  --task "Run all tests and report coverage with gap analysis" \
  --agent test-runner \
  --dirs "$PROJECT_DIR" \
  --output-format json

# Step 4: Generate CI comment
echo ""
echo "--- Step 4: CI Summary ---"
"${SCRIPT_DIR}/kronus-run.sh" \
  --task "Generate a CI summary comment combining review, security, and test results" \
  --agent ci-commenter \
  --dirs "$PROJECT_DIR" \
  --output-format json

echo ""
echo "=== CI Pipeline Complete ==="
