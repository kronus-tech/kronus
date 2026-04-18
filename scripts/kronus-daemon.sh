#!/usr/bin/env bash
# kronus-daemon.sh — Manage the Kronus Telegram control plane daemon
# Usage: kronus-daemon {start|stop|status|restart|logs}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/kronus-common.sh
source "${SCRIPT_DIR}/lib/kronus-common.sh"

DAEMON_DIR="${SCRIPT_DIR}/../daemon"
PID_FILE="${HOME}/.claude/channels/telegram/daemon.pid"
LOG_DIR="${HOME}/.claude/channels/telegram/logs"
LOG_FILE="${LOG_DIR}/daemon.log"

usage() {
  cat <<EOF
Usage: kronus-daemon <command>

Commands:
  start     Start the daemon in the background
  stop      Stop the running daemon
  restart   Restart the daemon
  status    Show daemon status and active sessions
  logs      Tail daemon logs

EOF
  exit 1
}

get_pid() {
  if [[ -f "$PID_FILE" ]]; then
    cat "$PID_FILE"
  else
    echo ""
  fi
}

is_running() {
  local pid
  pid="$(get_pid)"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

cmd_start() {
  if is_running; then
    log_warn "Daemon already running (PID $(get_pid))"
    return 1
  fi

  log_header "Starting Kronus Daemon"

  # Check dependencies
  require_cmd bun
  require_cmd claude

  # Install dependencies if needed
  if [[ ! -d "${DAEMON_DIR}/node_modules" ]]; then
    log_info "Installing daemon dependencies..."
    cd "$DAEMON_DIR" && bun install
  fi

  # Ensure log directory exists
  mkdir -p "$LOG_DIR"

  # Start daemon in background
  cd "$DAEMON_DIR"
  nohup bun run src/index.ts >> "$LOG_FILE" 2>&1 &
  local daemon_pid=$!

  # Wait a moment and verify it started
  sleep 2
  if kill -0 "$daemon_pid" 2>/dev/null; then
    log_success "Daemon started (PID ${daemon_pid})"
    log_info "Logs: ${LOG_FILE}"
  else
    log_error "Daemon failed to start. Check logs: ${LOG_FILE}"
    return 1
  fi
}

cmd_stop() {
  if ! is_running; then
    log_warn "Daemon is not running"
    # Clean up stale PID file
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(get_pid)"
  log_info "Stopping daemon (PID ${pid})..."

  # Send SIGTERM for graceful shutdown
  kill "$pid" 2>/dev/null || true

  # Wait up to 10 seconds for graceful shutdown
  local count=0
  while kill -0 "$pid" 2>/dev/null && [[ $count -lt 10 ]]; do
    sleep 1
    count=$((count + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    log_warn "Graceful shutdown timed out, force killing..."
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  log_success "Daemon stopped"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  log_header "Kronus Daemon Status"

  if is_running; then
    local pid
    pid="$(get_pid)"
    log_success "Daemon running (PID ${pid})"

    # Show uptime
    if command -v ps &>/dev/null; then
      local elapsed
      elapsed="$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')" || elapsed="unknown"
      log_info "Uptime: ${elapsed}"
    fi
  else
    log_warn "Daemon is not running"
  fi

  # Show project mappings
  local projects_file="${HOME}/.claude/channels/telegram/projects.json"
  if [[ -f "$projects_file" ]]; then
    echo ""
    log_info "Project mappings:"
    if command -v jq &>/dev/null; then
      jq -r '.projects | to_entries[] | "  \(.value.name) → \(.value.path) (group: \(.key))"' "$projects_file" 2>/dev/null || echo "  (none)"
    else
      python3 -c "
import json, sys
with open('$projects_file') as f:
    data = json.load(f)
for gid, proj in data.get('projects', {}).items():
    print(f\"  {proj['name']} → {proj['path']} (group: {gid})\")
" 2>/dev/null || echo "  (unable to parse)"
    fi
  else
    echo ""
    log_info "No project mappings found. Run: kronus-init --group <group_id>"
  fi

  # Show log file info
  if [[ -f "$LOG_FILE" ]]; then
    echo ""
    local log_size
    log_size="$(du -h "$LOG_FILE" | cut -f1)"
    log_info "Log file: ${LOG_FILE} (${log_size})"
  fi
}

cmd_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    log_warn "No log file found at ${LOG_FILE}"
    return 1
  fi

  log_info "Tailing ${LOG_FILE} (Ctrl+C to stop)"
  tail -f "$LOG_FILE"
}

# Main dispatch
case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)       usage ;;
esac
