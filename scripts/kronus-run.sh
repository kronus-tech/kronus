#!/usr/bin/env bash
# kronus-run.sh — Run an agent across multiple directories
# Usage: kronus-run.sh --task "Security audit" --agent security-auditor --dirs ~/projects/*

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/kronus-common.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

TASK=""
AGENT=""
DIRS=()
PARALLEL=false
JOBS=4
TIMEOUT=300
OUTPUT_FORMAT="text"
RESULTS_DIR=""

# ─── Parse Arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Run a Kronus agent across multiple project directories.

Options:
  --task TEXT          Task description to send to the agent (required)
  --agent NAME        Agent name to invoke (required)
  --dirs PATH...      Target directories (required)
  --parallel          Run across directories in parallel
  --jobs N            Max parallel jobs (default: 4)
  --timeout SECS      Timeout per directory in seconds (default: 300)
  --output-format FMT Output format: text or json (default: text)
  --results-dir DIR   Save results to this directory
  -h, --help          Show this help message

Examples:
  $(basename "$0") --task "Summarize this project" --agent project-summarizer --dirs ~/projects/*
  $(basename "$0") --task "Security audit" --agent security-auditor --dirs ~/app --output-format json
  $(basename "$0") --task "Run tests" --agent test-runner --dirs ~/projects/* --parallel --jobs 8
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)           TASK="$2"; shift 2 ;;
    --agent)          AGENT="$2"; shift 2 ;;
    --dirs)           shift; while [[ $# -gt 0 && ! "$1" =~ ^-- ]]; do DIRS+=("$1"); shift; done ;;
    --parallel)       PARALLEL=true; shift ;;
    --jobs)           JOBS="$2"; shift 2 ;;
    --timeout)        TIMEOUT="$2"; shift 2 ;;
    --output-format)  OUTPUT_FORMAT="$2"; shift 2 ;;
    --results-dir)    RESULTS_DIR="$2"; shift 2 ;;
    -h|--help)        usage ;;
    *)                log_error "Unknown option: $1"; usage ;;
  esac
done

# ─── Validation ──────────────────────────────────────────────────────────────

[[ -z "$TASK" ]] && { log_error "--task is required"; exit 1; }
[[ -z "$AGENT" ]] && { log_error "--agent is required"; exit 1; }
[[ ${#DIRS[@]} -eq 0 ]] && { log_error "--dirs is required"; exit 1; }

require_claude

if ! agent_exists "$AGENT"; then
  log_error "Agent not found: $AGENT"
  log_info "Available agents: $(list_agents | tr '\n' ' ')"
  exit 1
fi

# ─── Setup Results Directory ─────────────────────────────────────────────────

if [[ -z "$RESULTS_DIR" ]]; then
  RESULTS_DIR="${KRONUS_DATA_DIR}/results/$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$RESULTS_DIR"

# ─── Run Agent ───────────────────────────────────────────────────────────────

run_agent_in_dir() {
  local dir="$1"
  local dir_name
  dir_name=$(basename "$dir")
  local result_file="${RESULTS_DIR}/${dir_name}.${OUTPUT_FORMAT}"

  if [[ ! -d "$dir" ]]; then
    log_warn "Skipping (not a directory): $dir"
    return 1
  fi

  log_info "Running ${AGENT} in ${dir}..."

  local start_time
  start_time=$(date +%s)

  if timeout "${TIMEOUT}" claude -p "Invoke ${AGENT}: ${TASK}" \
    --output-format "${OUTPUT_FORMAT}" \
    --cwd "$dir" > "$result_file" 2>&1; then
    local elapsed=$(( $(date +%s) - start_time ))
    log_success "${dir_name} — completed in ${elapsed}s"
    return 0
  else
    local exit_code=$?
    local elapsed=$(( $(date +%s) - start_time ))
    if [[ $exit_code -eq 124 ]]; then
      log_warn "${dir_name} — timed out after ${TIMEOUT}s"
    else
      log_error "${dir_name} — failed (exit code: ${exit_code}) in ${elapsed}s"
    fi
    return $exit_code
  fi
}

# ─── Execute ─────────────────────────────────────────────────────────────────

log_header "Kronus Run — ${AGENT}"
log_info "Task: ${TASK}"
log_info "Directories: ${#DIRS[@]}"
log_info "Mode: $(if $PARALLEL; then echo "parallel (${JOBS} jobs)"; else echo "sequential"; fi)"
log_info "Results: ${RESULTS_DIR}"
echo ""

TOTAL=0
PASSED=0
FAILED=0

if $PARALLEL; then
  # Parallel execution with job control
  PIDS=()
  for dir in "${DIRS[@]}"; do
    while [[ $(jobs -r | wc -l) -ge $JOBS ]]; do
      wait -n 2>/dev/null || true
    done
    run_agent_in_dir "$dir" &
    PIDS+=($!)
    TOTAL=$((TOTAL + 1))
  done

  # Wait for all jobs
  for pid in "${PIDS[@]}"; do
    if wait "$pid" 2>/dev/null; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  done
else
  # Sequential execution
  for dir in "${DIRS[@]}"; do
    TOTAL=$((TOTAL + 1))
    if run_agent_in_dir "$dir"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  done
fi

# ─── Summary Report ──────────────────────────────────────────────────────────

echo ""
log_header "Summary"
log_info "Total: ${TOTAL} | Passed: ${PASSED} | Failed: ${FAILED}"
log_info "Results saved to: ${RESULTS_DIR}"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
