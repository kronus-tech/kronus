#!/usr/bin/env bash
# kronus-common.sh — Shared library for Kronus scripts
# Source this file: source "$(dirname "$0")/lib/kronus-common.sh"

set -euo pipefail

# ─── Constants ───────────────────────────────────────────────────────────────

KRONUS_VERSION="4.1"
KRONUS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KRONUS_AGENTS_DIR="${KRONUS_ROOT}/.claude/agents"
KRONUS_COMMANDS_DIR="${KRONUS_ROOT}/.claude/commands"
KRONUS_RULES_DIR="${KRONUS_ROOT}/.claude/rules"
KRONUS_TEAMS_DIR="${KRONUS_ROOT}/.claude/teams"
KRONUS_SCRIPTS_DIR="${KRONUS_ROOT}/scripts"
KRONUS_DATA_DIR="${KRONUS_ROOT}/data"

GLOBAL_CLAUDE_DIR="${HOME}/.claude"
GLOBAL_AGENTS_DIR="${GLOBAL_CLAUDE_DIR}/agents"
GLOBAL_COMMANDS_DIR="${GLOBAL_CLAUDE_DIR}/commands"
GLOBAL_RULES_DIR="${GLOBAL_CLAUDE_DIR}/rules"

# ─── Agent List ──────────────────────────────────────────────────────────────

AGENTS=(
  planner
  team-lead
  memory-retriever
  ai-engineer
  code-reviewer
  frontend-dev
  backend-infra
  security-auditor
  fuzzing-agent
  proposal-writer
)

# ─── Team Names ─────────────────────────────────────────────────────────────
# Team compositions are in .claude/teams/*.yaml — no associative arrays needed

TEAM_NAMES=(engineering security-review full-stack business)

# ─── Color Logging ───────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }

# ─── Utility Functions ───────────────────────────────────────────────────────

# Check if a command exists
require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    log_error "Required command not found: $cmd"
    exit 1
  fi
}

# Check if claude CLI is available
require_claude() {
  require_cmd "claude"
}

# Get agent file path
agent_path() {
  local agent="$1"
  echo "${KRONUS_AGENTS_DIR}/${agent}.md"
}

# Check if agent exists
agent_exists() {
  local agent="$1"
  [[ -f "$(agent_path "$agent")" ]]
}

# List all available agents
list_agents() {
  for agent in "${AGENTS[@]}"; do
    if agent_exists "$agent"; then
      echo "$agent"
    fi
  done
}

# Get team members
team_members() {
  local team="$1"
  echo "${TEAMS[$team]:-}"
}

# List available teams
list_teams() {
  for team in "${!TEAMS[@]}"; do
    echo "$team"
  done | sort
}

# ─── PID Tracking ────────────────────────────────────────────────────────────

KRONUS_PID_DIR="${KRONUS_DATA_DIR}/.pids"

track_pid() {
  local name="$1" pid="$2"
  mkdir -p "$KRONUS_PID_DIR"
  echo "$pid" > "${KRONUS_PID_DIR}/${name}.pid"
}

get_pid() {
  local name="$1"
  local pidfile="${KRONUS_PID_DIR}/${name}.pid"
  if [[ -f "$pidfile" ]]; then
    cat "$pidfile"
  fi
}

clear_pid() {
  local name="$1"
  rm -f "${KRONUS_PID_DIR}/${name}.pid"
}

is_running() {
  local name="$1"
  local pid
  pid=$(get_pid "$name")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  clear_pid "$name"
  return 1
}

# ─── JSON Helpers ─────────────────────────────────────────────────────────────

# Pretty print JSON (requires jq)
json_pretty() {
  if command -v jq &>/dev/null; then
    jq '.'
  else
    cat
  fi
}

# Extract field from JSON
json_get() {
  local field="$1"
  if command -v jq &>/dev/null; then
    jq -r ".$field // empty"
  else
    log_warn "jq not installed, cannot parse JSON"
    cat
  fi
}

# ─── Backup ──────────────────────────────────────────────────────────────────

backup_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local backup="${file}.bak.$(date +%Y%m%d%H%M%S)"
    cp "$file" "$backup"
    log_info "Backed up: $file → $backup"
  fi
}

# ─── Timestamp ───────────────────────────────────────────────────────────────

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}
