#!/usr/bin/env bash
# Publish daemon from live source (kronus-par1k-daemon) to kronus-tech/kronus/daemon/
# Usage: ./scripts/publish-daemon.sh [--dry-run]
#
# This syncs the daemon source of truth (~/.claude/daemon/) into the inline
# daemon/ directory of kronus-tech/kronus for public distribution.

set -euo pipefail

LIVE_DAEMON="$HOME/.claude/daemon"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DAEMON="$SCRIPT_DIR/../daemon"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN] Would sync daemon from $LIVE_DAEMON → $TARGET_DAEMON"
fi

# Verify source exists
if [[ ! -d "$LIVE_DAEMON/src" ]]; then
  echo "ERROR: Live daemon not found at $LIVE_DAEMON/src"
  exit 1
fi

echo "=== Syncing daemon source ==="
echo "From: $LIVE_DAEMON"
echo "  To: $TARGET_DAEMON"

if $DRY_RUN; then
  rsync -avn --delete \
    --exclude='node_modules/' \
    --exclude='.git/' \
    --exclude='.next/' \
    --exclude='dashboard/node_modules/' \
    --exclude='dashboard/dist/' \
    --exclude='dashboard/.next/' \
    --exclude='.env' \
    --exclude='*.pid' \
    --exclude='logs/' \
    "$LIVE_DAEMON/" "$TARGET_DAEMON/"
else
  rsync -av --delete \
    --exclude='node_modules/' \
    --exclude='.git/' \
    --exclude='.next/' \
    --exclude='dashboard/node_modules/' \
    --exclude='dashboard/dist/' \
    --exclude='dashboard/.next/' \
    --exclude='.env' \
    --exclude='*.pid' \
    --exclude='logs/' \
    "$LIVE_DAEMON/" "$TARGET_DAEMON/"
fi

# Verify file counts match
LIVE_COUNT=$(find "$LIVE_DAEMON/src" -name '*.ts' | wc -l | tr -d ' ')
TARGET_COUNT=$(find "$TARGET_DAEMON/src" -name '*.ts' | wc -l | tr -d ' ')

echo ""
echo "=== Verification ==="
echo "Live daemon:      $LIVE_COUNT .ts files"
echo "Published daemon:  $TARGET_COUNT .ts files"

if [[ "$LIVE_COUNT" != "$TARGET_COUNT" ]]; then
  echo "WARNING: File count mismatch!"
  exit 1
fi

echo ""
echo "=== Personal data check ==="
PERSONAL_HITS=$(grep -rl "par1kahl\|Parik Ahlawat\|parikahlawat\|1849889131" "$TARGET_DAEMON/src/" 2>/dev/null | wc -l | tr -d ' ')
if [[ "$PERSONAL_HITS" -gt 0 ]]; then
  echo "WARNING: $PERSONAL_HITS files still contain personal references:"
  grep -rl "par1kahl\|Parik Ahlawat\|parikahlawat\|1849889131" "$TARGET_DAEMON/src/" 2>/dev/null
  echo ""
  echo "Run the cleanup manually or update the daemon source."
else
  echo "OK — No personal data found in daemon source."
fi

echo ""
echo "Done. Review changes with 'git diff daemon/' then commit."
