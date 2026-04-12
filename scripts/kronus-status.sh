#!/usr/bin/env bash
# kronus-status.sh — Show running sessions, recent results, and agent usage stats
# Usage: kronus-status.sh [--stats] [--watch 5]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/kronus-common.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

SHOW_STATS=false
WATCH_INTERVAL=0

# ─── Parse Arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Show Kronus system status.

Options:
  --stats         Show agent usage statistics
  --watch N       Refresh every N seconds (live dashboard)
  -h, --help      Show this help message

Examples:
  $(basename "$0")              # Show current status
  $(basename "$0") --stats      # Show usage statistics
  $(basename "$0") --watch 5    # Live dashboard, refresh every 5s
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stats)    SHOW_STATS=true; shift ;;
    --watch)    WATCH_INTERVAL="$2"; shift 2 ;;
    -h|--help)  usage ;;
    *)          log_error "Unknown option: $1"; usage ;;
  esac
done

# ─── Status Display ─────────────────────────────────────────────────────────

show_status() {
  clear 2>/dev/null || true

  log_header "Kronus v${KRONUS_VERSION} — Status"

  # System info
  echo -e "${BOLD}System:${NC}"
  echo "  Version:    ${KRONUS_VERSION}"
  echo "  Root:       ${KRONUS_ROOT}"
  echo "  Agents:     $(ls "${KRONUS_AGENTS_DIR}"/*.md 2>/dev/null | wc -l | tr -d ' ') installed"
  echo "  Commands:   $(ls "${KRONUS_COMMANDS_DIR}"/*.md 2>/dev/null | wc -l | tr -d ' ') available"
  echo "  Teams:      $(ls "${KRONUS_TEAMS_DIR}"/*.yaml 2>/dev/null | wc -l | tr -d ' ') configured"
  echo ""

  # Running sessions
  echo -e "${BOLD}Running Sessions:${NC}"
  local running_count=0
  if [[ -d "${KRONUS_DATA_DIR}/.pids" ]]; then
    for pidfile in "${KRONUS_DATA_DIR}/.pids"/*.pid; do
      [[ -f "$pidfile" ]] || continue
      local name
      name=$(basename "$pidfile" .pid)
      if is_running "$name"; then
        local pid
        pid=$(get_pid "$name")
        echo -e "  ${GREEN}●${NC} ${name} (PID: ${pid})"
        running_count=$((running_count + 1))
      fi
    done
  fi
  if [[ $running_count -eq 0 ]]; then
    echo "  No active sessions"
  fi
  echo ""

  # Recent results
  echo -e "${BOLD}Recent Results:${NC}"
  local results_count=0
  for results_dir in "${KRONUS_DATA_DIR}"/results/*/  "${KRONUS_DATA_DIR}"/team-results/*/ "${KRONUS_DATA_DIR}"/batch-results/*/; do
    [[ -d "$results_dir" ]] || continue
    local dirname
    dirname=$(basename "$results_dir")
    local file_count
    file_count=$(ls "$results_dir" 2>/dev/null | wc -l | tr -d ' ')
    echo "  ${dirname} — ${file_count} files"
    results_count=$((results_count + 1))
    [[ $results_count -ge 5 ]] && break
  done
  if [[ $results_count -eq 0 ]]; then
    echo "  No results yet"
  fi
  echo ""

  # Global install check
  echo -e "${BOLD}Global Install:${NC}"
  if [[ -d "$GLOBAL_AGENTS_DIR" ]]; then
    local global_count
    global_count=$(ls "${GLOBAL_AGENTS_DIR}"/*.md 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${GREEN}●${NC} Installed (${global_count} agents in ~/.claude/agents/)"
  else
    echo -e "  ${YELLOW}○${NC} Not installed (run: ./scripts/install.sh)"
  fi
  echo ""
}

# ─── Stats Display ───────────────────────────────────────────────────────────

show_stats() {
  log_header "Agent Usage Statistics"

  echo -e "${BOLD}Agent Roster:${NC}"
  printf "  %-22s %-8s %-10s %-12s\n" "AGENT" "TIER" "MEMORY" "MAX_TURNS"
  echo "  $(printf '%.0s─' {1..55})"

  # Parse agent frontmatter for stats
  for agent in "${AGENTS[@]}"; do
    local agent_file
    agent_file=$(agent_path "$agent")
    if [[ -f "$agent_file" ]]; then
      local memory maxturns tier
      memory=$(grep -m1 "^memory:" "$agent_file" | awk '{print $2}' || echo "none")
      maxturns=$(grep -m1 "^maxTurns:" "$agent_file" | awk '{print $2}' || echo "-")

      # Determine tier
      case "$agent" in
        planner|team-lead)       tier="1" ;;
        project-summarizer|memory-retriever) tier="2" ;;
        ai-engineer|test-*|code-reviewer|frontend-dev|backend-infra|security-auditor|fuzzing-agent) tier="3" ;;
        *)                       tier="4" ;;
      esac

      printf "  %-22s %-8s %-10s %-12s\n" "$agent" "$tier" "$memory" "$maxturns"
    fi
  done

  echo ""

  # Result counts
  echo -e "${BOLD}Results Summary:${NC}"
  for dir_type in results team-results batch-results; do
    local base="${KRONUS_DATA_DIR}/${dir_type}"
    if [[ -d "$base" ]]; then
      local count
      count=$(ls -d "$base"/*/ 2>/dev/null | wc -l | tr -d ' ')
      echo "  ${dir_type}: ${count} sessions"
    fi
  done
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────

if $SHOW_STATS; then
  show_stats
elif [[ $WATCH_INTERVAL -gt 0 ]]; then
  while true; do
    show_status
    echo -e "${CYAN}Refreshing every ${WATCH_INTERVAL}s... (Ctrl+C to stop)${NC}"
    sleep "$WATCH_INTERVAL"
  done
else
  show_status
fi
