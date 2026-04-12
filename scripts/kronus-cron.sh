#!/usr/bin/env bash
# kronus-cron.sh — Install and manage cron jobs for Kronus
# Usage: kronus-cron.sh --install --manifest cron.yaml

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib/kronus-common.sh"

# ─── Defaults ────────────────────────────────────────────────────────────────

ACTION=""
MANIFEST=""
LOG_DIR="${KRONUS_DATA_DIR}/cron-logs"

# ─── Parse Arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Install and manage Kronus cron jobs.

Options:
  --install             Install cron jobs from manifest
  --uninstall           Remove all Kronus cron jobs
  --list                List current Kronus cron jobs
  --manifest FILE       Cron job manifest (YAML, required for --install)
  --rotate-logs         Rotate cron log files
  -h, --help            Show this help message

Manifest Format (YAML):
  jobs:
    - name: "daily-summary"
      schedule: "0 9 * * *"
      agent: "project-summarizer"
      task: "Summarize yesterday's activity"
      dirs:
        - "~/projects/myapp"

Examples:
  $(basename "$0") --install --manifest cron.yaml
  $(basename "$0") --list
  $(basename "$0") --uninstall
  $(basename "$0") --rotate-logs
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)       ACTION="install"; shift ;;
    --uninstall)     ACTION="uninstall"; shift ;;
    --list)          ACTION="list"; shift ;;
    --manifest)      MANIFEST="$2"; shift 2 ;;
    --rotate-logs)   ACTION="rotate"; shift ;;
    -h|--help)       usage ;;
    *)               log_error "Unknown option: $1"; usage ;;
  esac
done

[[ -z "$ACTION" ]] && { log_error "Action required: --install, --uninstall, --list, or --rotate-logs"; exit 1; }

CRON_MARKER="# KRONUS-MANAGED"

# ─── Actions ─────────────────────────────────────────────────────────────────

do_list() {
  log_header "Kronus Cron Jobs"
  local jobs
  jobs=$(crontab -l 2>/dev/null | grep "$CRON_MARKER" || true)
  if [[ -z "$jobs" ]]; then
    log_info "No Kronus cron jobs installed"
  else
    echo "$jobs" | while IFS= read -r line; do
      echo "  $line"
    done
  fi
}

do_uninstall() {
  log_header "Removing Kronus Cron Jobs"
  local current
  current=$(crontab -l 2>/dev/null || true)
  local filtered
  filtered=$(echo "$current" | grep -v "$CRON_MARKER" || true)
  echo "$filtered" | crontab -
  log_success "All Kronus cron jobs removed"
}

do_install() {
  [[ -z "$MANIFEST" ]] && { log_error "--manifest is required for --install"; exit 1; }
  [[ ! -f "$MANIFEST" ]] && { log_error "Manifest not found: $MANIFEST"; exit 1; }

  require_cmd "python3"
  mkdir -p "$LOG_DIR"

  log_header "Installing Kronus Cron Jobs"

  # Remove existing kronus cron jobs first
  local current
  current=$(crontab -l 2>/dev/null || true)
  local clean
  clean=$(echo "$current" | grep -v "$CRON_MARKER" || true)

  # Parse manifest and generate cron entries
  local new_entries
  new_entries=$(python3 << PYEOF
import sys
try:
    import yaml
    with open("$MANIFEST") as f:
        data = yaml.safe_load(f)
except ImportError:
    import json
    with open("$MANIFEST") as f:
        data = json.load(f)

jobs = data.get("jobs", [])
for job in jobs:
    schedule = job["schedule"]
    name = job["name"]
    agent = job.get("agent", "planner")
    task = job.get("task", "")
    dirs = job.get("dirs", ["."])
    log_dir = "$LOG_DIR"

    for d in dirs:
        dir_name = d.rstrip("/").split("/")[-1]
        log_file = f"{log_dir}/{name}-{dir_name}.log"
        cmd = f'cd {d} && claude -p "Invoke {agent}: {task}" >> {log_file} 2>&1'
        print(f'{schedule} {cmd} # KRONUS-MANAGED:{name}')
PYEOF
  )

  # Combine and install
  local combined
  if [[ -n "$clean" ]]; then
    combined="${clean}"$'\n'"${new_entries}"
  else
    combined="${new_entries}"
  fi

  echo "$combined" | crontab -

  log_success "Cron jobs installed:"
  echo "$new_entries" | while IFS= read -r line; do
    echo "  $line"
  done
}

do_rotate() {
  log_header "Rotating Cron Logs"
  if [[ ! -d "$LOG_DIR" ]]; then
    log_info "No log directory found"
    exit 0
  fi

  local rotated=0
  for log_file in "${LOG_DIR}"/*.log; do
    [[ -f "$log_file" ]] || continue
    local size
    size=$(wc -c < "$log_file" | tr -d ' ')
    # Rotate if larger than 1MB
    if [[ $size -gt 1048576 ]]; then
      mv "$log_file" "${log_file}.$(date +%Y%m%d)"
      : > "$log_file"
      rotated=$((rotated + 1))
      log_info "Rotated: $(basename "$log_file")"
    fi
  done

  # Remove old rotated logs (older than 30 days)
  find "$LOG_DIR" -name "*.log.*" -mtime +30 -delete 2>/dev/null || true

  log_success "Rotated ${rotated} log files"
}

# ─── Execute ─────────────────────────────────────────────────────────────────

case "$ACTION" in
  install)    do_install ;;
  uninstall)  do_uninstall ;;
  list)       do_list ;;
  rotate)     do_rotate ;;
esac
