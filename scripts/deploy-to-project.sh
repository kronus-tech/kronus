#!/usr/bin/env bash
# deploy-to-project.sh — Copy agents, commands, rules, and CLAUDE.md to a target project
# Usage: ./scripts/deploy-to-project.sh /path/to/target [--dry-run]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/kronus-common.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

TARGET_DIR=""
DRY_RUN=false

# ─── Parse Arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") TARGET_DIR [OPTIONS]

Deploy Kronus agents and configs to a target project directory.

Arguments:
  TARGET_DIR          Path to the target project directory

Options:
  --dry-run           Preview what would be deployed
  --agents-only       Only deploy agent files
  -h, --help          Show this help message

Examples:
  $(basename "$0") ~/projects/myapp
  $(basename "$0") ~/projects/myapp --dry-run
  $(basename "$0") /path/to/project --agents-only
EOF
  exit 0
}

AGENTS_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)      DRY_RUN=true; shift ;;
    --agents-only)  AGENTS_ONLY=true; shift ;;
    -h|--help)      usage ;;
    -*)             log_error "Unknown option: $1"; usage ;;
    *)              TARGET_DIR="$1"; shift ;;
  esac
done

[[ -z "$TARGET_DIR" ]] && { log_error "TARGET_DIR is required"; usage; }

# Expand ~
TARGET_DIR="${TARGET_DIR/#\~/$HOME}"

if [[ ! -d "$TARGET_DIR" ]]; then
  log_error "Target directory does not exist: $TARGET_DIR"
  exit 1
fi

# ─── Deploy ──────────────────────────────────────────────────────────────────

run() {
  if $DRY_RUN; then
    log_info "[DRY RUN] $*"
  else
    "$@"
  fi
}

log_header "Deploying Kronus to ${TARGET_DIR}"

# Create .claude directory structure
run mkdir -p "${TARGET_DIR}/.claude/agents"
if ! $AGENTS_ONLY; then
  run mkdir -p "${TARGET_DIR}/.claude/commands"
  run mkdir -p "${TARGET_DIR}/.claude/rules"
fi

# Copy agents
log_info "Deploying agents..."
local count=0
for agent in "${AGENTS[@]}"; do
  local src="${KRONUS_AGENTS_DIR}/${agent}.md"
  if [[ -f "$src" ]]; then
    run cp "$src" "${TARGET_DIR}/.claude/agents/${agent}.md"
    count=$((count + 1))
  fi
done
log_success "Deployed ${count} agents"

if ! $AGENTS_ONLY; then
  # Copy commands
  log_info "Deploying slash commands..."
  for cmd_file in "${KRONUS_COMMANDS_DIR}"/*.md; do
    if [[ -f "$cmd_file" ]]; then
      run cp "$cmd_file" "${TARGET_DIR}/.claude/commands/"
    fi
  done
  log_success "Deployed slash commands"

  # Copy rules
  log_info "Deploying rules..."
  for rule_file in "${KRONUS_RULES_DIR}"/*.md; do
    if [[ -f "$rule_file" ]]; then
      run cp "$rule_file" "${TARGET_DIR}/.claude/rules/"
    fi
  done
  log_success "Deployed rules"

  # Copy CLAUDE.md
  if [[ -f "${KRONUS_ROOT}/.claude/CLAUDE.md" ]]; then
    if [[ -f "${TARGET_DIR}/.claude/CLAUDE.md" ]]; then
      backup_file "${TARGET_DIR}/.claude/CLAUDE.md"
    fi
    run cp "${KRONUS_ROOT}/.claude/CLAUDE.md" "${TARGET_DIR}/.claude/CLAUDE.md"
    log_success "Deployed .claude/CLAUDE.md"
  fi
fi

log_header "Deployment Complete"
log_info "Target: ${TARGET_DIR}"
log_info "Agents are now available in Claude Code when working in ${TARGET_DIR}"
