#!/usr/bin/env bash
# kronus-init.sh — Connect a Telegram group to a project folder
# Usage: kronus-init --group <group_id> [--name <name>] [--mode <permissionMode>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/kronus-common.sh
source "${SCRIPT_DIR}/lib/kronus-common.sh"

PROJECTS_FILE="${HOME}/.claude/channels/telegram/projects.json"
ACCESS_FILE="${HOME}/.claude/channels/telegram/access.json"

usage() {
  cat <<EOF
Usage: kronus-init --group <group_id> [options]

Connect a Telegram group to a project folder so you can work on it from your phone.

Options:
  --group <id>    Telegram group ID (required)
  --name <name>   Project name (default: folder name)
  --mode <mode>   How much the AI can do without asking:
                    default      — asks before most actions
                    acceptEdits  — can edit files, asks for other actions (recommended)
                    plan         — shows a plan first, then asks to proceed
  --path <path>   Project folder (default: current directory)

How to find your group ID:
  1. Add @raw_data_bot to your Telegram group
  2. Send any message in the group
  3. The bot replies with the chat ID (a negative number)
  4. Remove @raw_data_bot after getting the ID

Examples:
  kronus-init --group -1001234567890
  kronus-init --group -1001234567890 --name "my-project"

EOF
  exit 1
}

# Parse arguments
GROUP_ID=""
PROJECT_NAME=""
PERMISSION_MODE="acceptEdits"
PROJECT_PATH="$(pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --group)
      GROUP_ID="$2"
      shift 2
      ;;
    --name)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --mode)
      PERMISSION_MODE="$2"
      shift 2
      ;;
    --path)
      PROJECT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      log_error "Unknown option: $1"
      usage
      ;;
  esac
done

# Validate
if [[ -z "$GROUP_ID" ]]; then
  log_error "Group ID is required. Use --group <id>"
  echo ""
  usage
fi

# Default name to directory basename
if [[ -z "$PROJECT_NAME" ]]; then
  PROJECT_NAME="$(basename "$PROJECT_PATH")"
fi

# Validate permission mode
case "$PERMISSION_MODE" in
  default|acceptEdits|plan|bypassPermissions) ;;
  *)
    log_error "Invalid permission mode: ${PERMISSION_MODE}"
    log_info "Valid modes: default, acceptEdits, plan, bypassPermissions"
    exit 1
    ;;
esac

# Validate project path exists
if [[ ! -d "$PROJECT_PATH" ]]; then
  log_error "Project path does not exist: ${PROJECT_PATH}"
  exit 1
fi

# Ensure directory structure
mkdir -p "$(dirname "$PROJECTS_FILE")"

log_header "Initializing Project: ${PROJECT_NAME}"

# Load or create projects.json
if [[ -f "$PROJECTS_FILE" ]]; then
  PROJECTS="$(cat "$PROJECTS_FILE")"
else
  PROJECTS='{"projects":{},"defaults":{"allowedTools":["Read","Glob","Grep"],"permissionMode":"default"}}'
fi

# Add project mapping
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if command -v jq &>/dev/null; then
  PROJECTS="$(echo "$PROJECTS" | jq \
    --arg gid "$GROUP_ID" \
    --arg name "$PROJECT_NAME" \
    --arg path "$PROJECT_PATH" \
    --arg mode "$PERMISSION_MODE" \
    --arg ts "$TIMESTAMP" \
    '.projects[$gid] = {
      name: $name,
      path: $path,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      permissionMode: $mode,
      addedAt: $ts
    }')"
else
  PROJECTS="$(python3 -c "
import json, sys
data = json.loads('''$PROJECTS''')
data['projects']['$GROUP_ID'] = {
    'name': '$PROJECT_NAME',
    'path': '$PROJECT_PATH',
    'allowedTools': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    'permissionMode': '$PERMISSION_MODE',
    'addedAt': '$TIMESTAMP'
}
print(json.dumps(data, indent=2))
")"
fi

# Write atomically
echo "$PROJECTS" > "${PROJECTS_FILE}.tmp"
mv "${PROJECTS_FILE}.tmp" "$PROJECTS_FILE"

log_success "Connected!"
log_info "  Project: ${PROJECT_NAME}"
log_info "  Folder:  ${PROJECT_PATH}"
log_info "  Group:   ${GROUP_ID}"
log_info "  AI can:  read, write, edit files (mode: ${PERMISSION_MODE})"

# Check if group is in access.json
if [[ -f "$ACCESS_FILE" ]]; then
  HAS_GROUP="false"
  if command -v jq &>/dev/null; then
    HAS_GROUP="$(jq --arg gid "$GROUP_ID" '.groups | has($gid)' "$ACCESS_FILE" 2>/dev/null || echo "false")"
  else
    HAS_GROUP="$(python3 -c "
import json
with open('$ACCESS_FILE') as f:
    data = json.load(f)
print('true' if '$GROUP_ID' in data.get('groups', {}) else 'false')
" 2>/dev/null || echo "false")"
  fi

  if [[ "$HAS_GROUP" != "true" ]]; then
    echo ""
    log_warn "Group ${GROUP_ID} is not registered in access.json."
    log_info "Add it with: /telegram:access group add ${GROUP_ID}"
    log_info "This allows the bot to receive messages from the group."
  fi
fi

echo ""
log_info "Next steps:"
log_info "  1. Add the bot to your Telegram group (if not already)"
log_info "  2. Allow the group: /telegram:access group add ${GROUP_ID}"
log_info "  3. Start Kronus: ~/.claude/daemon/scripts/kronus-daemon.sh start"
log_info "  4. Send a message in the group — the AI will respond!"
