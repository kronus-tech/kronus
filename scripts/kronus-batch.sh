#!/usr/bin/env bash
# kronus-batch.sh — Execute tasks from a YAML/JSON manifest with dependencies
# Usage: kronus-batch.sh --manifest tasks.yaml [--parallel]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/kronus-common.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

MANIFEST=""
PARALLEL=false
CHECKPOINT_FILE=""
RESUME=false

# ─── Parse Arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Execute tasks from a manifest file with dependency resolution.

Options:
  --manifest FILE    Path to tasks manifest (YAML or JSON, required)
  --parallel         Run independent tasks in parallel
  --resume           Resume from last checkpoint
  -h, --help         Show this help message

Manifest Format (YAML):
  tasks:
    - id: "build-api"
      agent: "backend-infra"
      task: "Create REST API for users"
      dir: "~/myapp"
      depends_on: []
    - id: "test-api"
      agent: "test-generator"
      task: "Generate tests for the users API"
      dir: "~/myapp"
      depends_on: ["build-api"]

Examples:
  $(basename "$0") --manifest tasks.yaml
  $(basename "$0") --manifest tasks.yaml --parallel
  $(basename "$0") --manifest tasks.yaml --resume
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)   MANIFEST="$2"; shift 2 ;;
    --parallel)   PARALLEL=true; shift ;;
    --resume)     RESUME=true; shift ;;
    -h|--help)    usage ;;
    *)            log_error "Unknown option: $1"; usage ;;
  esac
done

[[ -z "$MANIFEST" ]] && { log_error "--manifest is required"; exit 1; }
[[ ! -f "$MANIFEST" ]] && { log_error "Manifest not found: $MANIFEST"; exit 1; }

require_claude
require_cmd "python3"

# ─── Parse Manifest ──────────────────────────────────────────────────────────

log_header "Kronus Batch Runner"
log_info "Manifest: ${MANIFEST}"

# Use Python to parse YAML/JSON and compute topological order
TASK_ORDER=$(python3 << 'PYEOF'
import sys, json

try:
    import yaml
    with open(sys.argv[1] if len(sys.argv) > 1 else "$MANIFEST") as f:
        data = yaml.safe_load(f)
except ImportError:
    with open(sys.argv[1] if len(sys.argv) > 1 else "$MANIFEST") as f:
        data = json.load(f)

tasks = data.get("tasks", [])
task_map = {t["id"]: t for t in tasks}

# Topological sort (Kahn's algorithm)
in_degree = {t["id"]: len(t.get("depends_on", [])) for t in tasks}
queue = [tid for tid, deg in in_degree.items() if deg == 0]
order = []

while queue:
    queue.sort()
    current = queue.pop(0)
    order.append(current)
    for t in tasks:
        if current in t.get("depends_on", []):
            in_degree[t["id"]] -= 1
            if in_degree[t["id"]] == 0:
                queue.append(t["id"])

if len(order) != len(tasks):
    print("ERROR: Circular dependency detected", file=sys.stderr)
    sys.exit(1)

for tid in order:
    t = task_map[tid]
    print(f"{t['id']}|{t.get('agent', 'planner')}|{t.get('task', '')}|{t.get('dir', '.')}|{','.join(t.get('depends_on', []))}")
PYEOF
) || { log_error "Failed to parse manifest"; exit 1; }

# ─── Setup ───────────────────────────────────────────────────────────────────

RESULTS_DIR="${KRONUS_DATA_DIR}/batch-results/$(date +%Y%m%d-%H%M%S)"
CHECKPOINT_FILE="${RESULTS_DIR}/checkpoint.json"
mkdir -p "$RESULTS_DIR"

declare -A COMPLETED

# Load checkpoint if resuming
if $RESUME && [[ -f "$CHECKPOINT_FILE" ]]; then
  while IFS= read -r task_id; do
    COMPLETED[$task_id]=1
  done < <(python3 -c "import json; [print(t) for t in json.load(open('$CHECKPOINT_FILE')).get('completed', [])]" 2>/dev/null)
  log_info "Resuming from checkpoint: ${#COMPLETED[@]} tasks already completed"
fi

# ─── Execute Tasks ───────────────────────────────────────────────────────────

save_checkpoint() {
  local completed_list
  completed_list=$(printf '"%s",' "${!COMPLETED[@]}" | sed 's/,$//')
  echo "{\"completed\": [${completed_list}]}" > "$CHECKPOINT_FILE"
}

execute_task() {
  local task_id="$1" agent="$2" task="$3" dir="$4"

  # Skip if already completed
  if [[ -n "${COMPLETED[$task_id]:-}" ]]; then
    log_info "Skipping (already completed): $task_id"
    return 0
  fi

  local result_file="${RESULTS_DIR}/${task_id}.md"

  log_info "[${task_id}] Running ${agent}: ${task}"
  if claude -p "Invoke ${agent}: ${task}" \
    --cwd "${dir/#\~/$HOME}" > "$result_file" 2>&1; then
    log_success "[${task_id}] Completed"
    COMPLETED[$task_id]=1
    save_checkpoint
    return 0
  else
    log_error "[${task_id}] Failed"
    save_checkpoint
    return 1
  fi
}

TOTAL=0
PASSED=0
FAILED=0

while IFS='|' read -r task_id agent task dir deps; do
  TOTAL=$((TOTAL + 1))
  if execute_task "$task_id" "$agent" "$task" "$dir"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
done <<< "$TASK_ORDER"

# ─── Summary ─────────────────────────────────────────────────────────────────

log_header "Batch Complete"
log_info "Total: ${TOTAL} | Passed: ${PASSED} | Failed: ${FAILED}"
log_info "Results: ${RESULTS_DIR}"

if [[ $FAILED -gt 0 ]]; then
  log_warn "Some tasks failed. Run with --resume to retry."
  exit 1
fi
