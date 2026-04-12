#!/usr/bin/env bash
# kronus-team.sh — Launch pre-configured or custom agent teams
# Usage: kronus-team.sh --team security-review --task "Audit this project" --dir ~/myapp

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/kronus-common.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

TEAM=""
TASK=""
TARGET_DIR="."
STRATEGY="sequential"
LIST_TEAMS=false
CUSTOM_AGENTS=()

# ─── Parse Arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Launch a Kronus agent team.

Options:
  --team NAME           Pre-configured team name (required unless --agents)
  --agents A1,A2,...    Custom agent list (comma-separated)
  --task TEXT           Task description (required)
  --dir PATH           Target directory (default: current)
  --strategy MODE      Execution: sequential, parallel, pipeline (default: sequential)
  --list-teams         Show available team configurations
  -h, --help           Show this help message

Available Teams:
  engineering       planner, ai-engineer, code-reviewer, test-generator, test-runner
  security-review   security-auditor, fuzzing-agent, test-generator, code-reviewer
  full-stack        planner, frontend-dev, backend-infra, test-generator, security-auditor
  business          proposal-writer, profile-optimizer, seo-writer, memory-retriever

Examples:
  $(basename "$0") --team security-review --task "Audit this project" --dir ~/myapp
  $(basename "$0") --team engineering --task "Build auth feature" --strategy pipeline
  $(basename "$0") --agents security-auditor,code-reviewer --task "Review security" --dir .
  $(basename "$0") --list-teams
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)        TEAM="$2"; shift 2 ;;
    --agents)      IFS=',' read -ra CUSTOM_AGENTS <<< "$2"; shift 2 ;;
    --task)        TASK="$2"; shift 2 ;;
    --dir)         TARGET_DIR="$2"; shift 2 ;;
    --strategy)    STRATEGY="$2"; shift 2 ;;
    --list-teams)  LIST_TEAMS=true; shift ;;
    -h|--help)     usage ;;
    *)             log_error "Unknown option: $1"; usage ;;
  esac
done

# ─── List Teams ──────────────────────────────────────────────────────────────

if $LIST_TEAMS; then
  log_header "Available Teams"
  for team_name in $(list_teams); do
    local members="${TEAMS[$team_name]}"
    echo -e "  ${BOLD}${team_name}${NC}: ${members}"
  done
  echo ""

  # Also show teams from YAML files
  if [[ -d "$KRONUS_TEAMS_DIR" ]]; then
    log_info "Team config files in ${KRONUS_TEAMS_DIR}:"
    for f in "${KRONUS_TEAMS_DIR}"/*.yaml; do
      [[ -f "$f" ]] && echo "  $(basename "$f")"
    done
  fi
  exit 0
fi

# ─── Validation ──────────────────────────────────────────────────────────────

[[ -z "$TASK" ]] && { log_error "--task is required"; exit 1; }

# Determine agent list
AGENT_LIST=()
if [[ ${#CUSTOM_AGENTS[@]} -gt 0 ]]; then
  AGENT_LIST=("${CUSTOM_AGENTS[@]}")
elif [[ -n "$TEAM" ]]; then
  local members
  members=$(team_members "$TEAM")
  if [[ -z "$members" ]]; then
    log_error "Unknown team: $TEAM"
    log_info "Available teams: $(list_teams | tr '\n' ' ')"
    exit 1
  fi
  read -ra AGENT_LIST <<< "$members"
else
  log_error "Either --team or --agents is required"
  exit 1
fi

require_claude

# ─── Execute Team ────────────────────────────────────────────────────────────

log_header "Kronus Team — ${TEAM:-custom}"
log_info "Task: ${TASK}"
log_info "Agents: ${AGENT_LIST[*]}"
log_info "Strategy: ${STRATEGY}"
log_info "Directory: ${TARGET_DIR}"
echo ""

RESULTS_DIR="${KRONUS_DATA_DIR}/team-results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

CONTEXT_FILE="${RESULTS_DIR}/shared-context.md"
echo "# Team Session Context" > "$CONTEXT_FILE"
echo "Task: ${TASK}" >> "$CONTEXT_FILE"
echo "Team: ${TEAM:-custom}" >> "$CONTEXT_FILE"
echo "Started: $(timestamp)" >> "$CONTEXT_FILE"
echo "" >> "$CONTEXT_FILE"

run_agent() {
  local agent="$1"
  local agent_task="$TASK"
  local result_file="${RESULTS_DIR}/${agent}.md"

  # In pipeline mode, include shared context
  if [[ "$STRATEGY" == "pipeline" && -f "$CONTEXT_FILE" ]]; then
    agent_task="Context from previous agents:\n$(cat "$CONTEXT_FILE")\n\nTask: ${TASK}"
  fi

  log_info "Running ${agent}..."
  if claude -p "Invoke ${agent}: ${agent_task}" \
    --cwd "$TARGET_DIR" > "$result_file" 2>&1; then
    log_success "${agent} — completed"

    # In pipeline mode, append output to shared context
    if [[ "$STRATEGY" == "pipeline" ]]; then
      echo "## Output from ${agent}" >> "$CONTEXT_FILE"
      head -50 "$result_file" >> "$CONTEXT_FILE"
      echo "" >> "$CONTEXT_FILE"
    fi
    return 0
  else
    log_error "${agent} — failed"
    return 1
  fi
}

case "$STRATEGY" in
  sequential|pipeline)
    for agent in "${AGENT_LIST[@]}"; do
      run_agent "$agent" || log_warn "Continuing despite ${agent} failure"
    done
    ;;
  parallel)
    PIDS=()
    for agent in "${AGENT_LIST[@]}"; do
      run_agent "$agent" &
      PIDS+=($!)
    done
    for pid in "${PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    ;;
  *)
    log_error "Unknown strategy: $STRATEGY (use: sequential, parallel, pipeline)"
    exit 1
    ;;
esac

log_header "Team Session Complete"
log_info "Results saved to: ${RESULTS_DIR}"
