#!/usr/bin/env bash
# Check kronus-tech/kronus for personal data that shouldn't be public.
# Run before pushing to kronus-tech/kronus.
# Usage: ./scripts/check-personal-data.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."
cd "$REPO_ROOT"

echo "=== Personal Data Check for kronus-tech/kronus ==="
echo ""

FOUND=0

# Patterns to search for
PATTERNS=(
  "par1kahl"
  "Parik Ahlawat"
  "parikahlawat"
  "1849889131"
  "Par1kKronus"
  "kronus-par1k"
  "par1k/claude-kronus"
)

for pattern in "${PATTERNS[@]}"; do
  HITS=$(grep -rl "$pattern" \
    --include="*.md" --include="*.ts" --include="*.tsx" \
    --include="*.js" --include="*.json" --include="*.sh" \
    --include="*.yaml" --include="*.yml" \
    --exclude-dir=node_modules --exclude-dir=.git \
    . 2>/dev/null | grep -v "check-personal-data.sh" | grep -v "publish-daemon.sh" || true)

  if [[ -n "$HITS" ]]; then
    echo "FOUND: \"$pattern\" in:"
    echo "$HITS" | sed 's/^/  /'
    echo ""
    FOUND=$((FOUND + 1))
  fi
done

# Also check for hardcoded personal paths
PATH_HITS=$(grep -rl "/Users/par1k\|/desktop/par1k\|~/Desktop/par1k" \
  --include="*.md" --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.sh" \
  --exclude-dir=node_modules --exclude-dir=.git \
  . 2>/dev/null | grep -v "check-personal-data.sh" | grep -v "publish-daemon.sh" || true)

if [[ -n "$PATH_HITS" ]]; then
  echo "FOUND: Personal paths (/Users/par1k) in:"
  echo "$PATH_HITS" | sed 's/^/  /'
  echo ""
  FOUND=$((FOUND + 1))
fi

echo "=== Result ==="
if [[ "$FOUND" -gt 0 ]]; then
  echo "FAIL: $FOUND pattern(s) found. Clean these before pushing."
  exit 1
else
  echo "PASS: No personal data found. Safe to push."
  exit 0
fi
