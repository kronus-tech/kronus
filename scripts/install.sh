#!/usr/bin/env bash
# install.sh — Install Kronus v5.5
# Usage: ./scripts/install.sh [--skip-daemon] [--uninstall] [--dry-run]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KRONUS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Colors ────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}  ✓${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }
log_step()    { echo -e "\n${BOLD}$*${NC}"; }
log_dim()     { echo -e "${DIM}  $*${NC}"; }

# ─── Options ───────────────────────────────────────────────────────────────

SKIP_DAEMON=false
DRY_RUN=false
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-daemon) SKIP_DAEMON=true; shift ;;
    --uninstall)   UNINSTALL=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--skip-daemon] [--uninstall] [--dry-run]"
      echo ""
      echo "Install Kronus — your AI that builds, remembers, and works across everything."
      echo ""
      echo "Options:"
      echo "  --skip-daemon  Skip phone/Telegram setup"
      echo "  --uninstall    Remove Kronus installation"
      echo "  --dry-run      Preview changes without executing"
      exit 0
      ;;
    *) log_error "Unknown option: $1"; exit 1 ;;
  esac
done

run() {
  if $DRY_RUN; then
    log_info "[DRY RUN] $*"
  else
    "$@"
  fi
}

# ─── Uninstall ─────────────────────────────────────────────────────────────

if $UNINSTALL; then
  log_header "Removing Kronus"
  log_warn "This removes AI capabilities from ~/.claude/"
  log_warn "It does NOT delete your notes, conversations, or personal data."
  read -p "Continue? [y/N] " -r
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0

  for f in "$KRONUS_ROOT"/.claude/agents/*.md; do
    [[ -f "$f" ]] || continue
    name=$(basename "$f")
    [[ "$name" == "README.md" ]] && continue
    run rm -f "$HOME/.claude/agents/$name" && log_success "Removed: ${name%.md}"
  done

  for d in "$KRONUS_ROOT"/.claude/skills/*/; do
    [[ -d "$d" ]] || continue
    name=$(basename "$d")
    run rm -rf "$HOME/.claude/skills/$name" && log_success "Removed: $name"
  done

  for f in "$KRONUS_ROOT"/.claude/rules/*.md; do
    [[ -f "$f" ]] || continue
    run rm -f "$HOME/.claude/rules/$(basename "$f")"
  done
  log_success "Cleanup complete"

  exit 0
fi

# ─── Dependency Check ──────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║              Welcome to Kronus             ║"
echo "  ║                                            ║"
echo "  ║  Your AI that builds, remembers, and       ║"
echo "  ║  works across everything.                  ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${DIM}  Let's set things up. This takes about 5 minutes.${NC}"
echo ""

check_dep() {
  if command -v "$1" &>/dev/null; then
    return 0
  else
    return 1
  fi
}

log_info "Checking requirements..."
MISSING=false
check_dep "git"    && log_success "git" || { log_error "git is required. Install from https://git-scm.com"; MISSING=true; }
check_dep "bun"    && log_success "bun" || { log_error "bun is required. Install: curl -fsSL https://bun.sh/install | bash"; MISSING=true; }
check_dep "claude" && log_success "claude" || { log_error "Claude Code is required. Install: npm install -g @anthropic-ai/claude-code"; MISSING=true; }

if $MISSING; then
  echo ""
  log_error "Some requirements are missing. Install them and run this again."
  exit 1
fi

# ─── Onboarding ───────────────────────────────────────────────────────────

log_header "Getting to Know You"

# Q1: Name
log_step "1. What's your name?"
log_dim "This personalizes your AI assistant."
read -p "  > " -r INPUT_NAME
KRONUS_NAME="${INPUT_NAME:-User}"
echo ""

# Q2: Profession
log_step "2. What do you do?"
log_dim "This helps me set up the right tools and organization for your work."
echo ""
echo "  1) Software Engineer / Developer"
echo "  2) Researcher / Academic"
echo "  3) Lawyer / Legal Professional"
echo "  4) Consultant / Freelancer"
echo "  5) Business Owner / Manager"
echo "  6) Writer / Content Creator"
echo "  7) Student"
echo "  8) Other"
echo ""
read -p "  Pick a number (1-8): " -r PROFESSION_NUM

case "${PROFESSION_NUM:-8}" in
  1) PROFESSION="developer" ;;
  2) PROFESSION="researcher" ;;
  3) PROFESSION="lawyer" ;;
  4) PROFESSION="consultant" ;;
  5) PROFESSION="business" ;;
  6) PROFESSION="writer" ;;
  7) PROFESSION="student" ;;
  *) PROFESSION="general" ;;
esac
echo ""

# Q3: How they work
log_step "3. How do you prefer to work?"
log_dim "This determines which connections to set up."
echo ""
echo "  1) Mostly from my computer"
echo "  2) I want to use my phone too (via Telegram)"
echo "  3) Both"
echo ""
read -p "  Pick a number (1-3): " -r WORK_MODE

case "${WORK_MODE:-1}" in
  2|3) SETUP_TELEGRAM=true ;;
  *)   SETUP_TELEGRAM=false; SKIP_DAEMON=true ;;
esac
echo ""

# Q4: Notes / brain
log_step "4. Do you keep notes or documents?"
log_dim "Kronus can organize your knowledge and remember everything."
echo ""
echo "  1) Yes, I have a notes folder already"
echo "  2) Not really — set one up for me"
echo "  3) I use Claude a lot already (auto-detect my project memories)"
echo ""
read -p "  Pick a number (1-3): " -r NOTES_MODE

CUSTOM_BRAIN_PATH=""
AUTO_DETECT_PROJECTS=false

case "${NOTES_MODE:-2}" in
  1)
    read -p "  Where are your notes? (full path): " -r CUSTOM_BRAIN_PATH
    if [[ -z "$CUSTOM_BRAIN_PATH" ]] || [[ ! -d "$CUSTOM_BRAIN_PATH" ]]; then
      log_warn "Path not found. I'll create the default location instead."
      CUSTOM_BRAIN_PATH=""
    fi
    ;;
  3) AUTO_DETECT_PROJECTS=true ;;
  *) ;; # default: create ~/second-brain
esac
echo ""

# Q5: What's most useful
log_step "5. What would be most useful right now?"
log_dim "This helps me prioritize what to show you first."
echo ""
echo "  1) Help me organize my work and remember things"
echo "  2) Help me build tools and automate tasks"
echo "  3) Help me communicate and collaborate"
echo "  4) All of the above"
echo ""
read -p "  Pick a number (1-4): " -r PRIORITY
echo ""

log_success "Got it. Setting things up for you, $KRONUS_NAME."
echo ""

# ─── Load profession config ───────────────────────────────────────────────

PROF_FILE="$KRONUS_ROOT/templates/professions/${PROFESSION}.json"
if [[ ! -f "$PROF_FILE" ]]; then
  PROF_FILE="$KRONUS_ROOT/templates/professions/default.json"
fi

# Parse profession config (using bun for JSON parsing)
PERSONA_STYLE=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$PROF_FILE','utf8')).persona_style)" 2>/dev/null || echo "Helpful, clear, adaptable.")
PROF_LABEL=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$PROF_FILE','utf8')).label)" 2>/dev/null || echo "$PROFESSION")
DASHBOARD_WELCOME=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$PROF_FILE','utf8')).dashboard_welcome)" 2>/dev/null || echo "Your personal dashboard.")

# ─── Install AI Capabilities ──────────────────────────────────────────────

TARGET="$HOME/.claude"
log_header "Setting Up AI Capabilities"

run mkdir -p "$TARGET/agents" "$TARGET/skills" "$TARGET/rules"

# Agents
agent_count=0
for f in "$KRONUS_ROOT"/.claude/agents/*.md; do
  [[ -f "$f" ]] || continue
  name=$(basename "$f")
  [[ "$name" == "README.md" ]] && continue
  run cp "$f" "$TARGET/agents/$name"
  ((agent_count++))
done
log_success "$agent_count AI specialists installed"

# Skills
skill_count=0
for d in "$KRONUS_ROOT"/.claude/skills/*/; do
  [[ -d "$d" ]] || continue
  name=$(basename "$d")
  run mkdir -p "$TARGET/skills/$name"
  for f in "$d"*; do
    [[ -f "$f" ]] && run cp "$f" "$TARGET/skills/$name/"
  done
  ((skill_count++))
done
log_success "$skill_count quick actions installed"

# Rules
rule_count=0
for f in "$KRONUS_ROOT"/.claude/rules/*.md; do
  [[ -f "$f" ]] || continue
  run cp "$f" "$TARGET/rules/$(basename "$f")"
  ((rule_count++))
done
log_success "$rule_count guidelines installed"

# Teams
if [[ -d "$KRONUS_ROOT/.claude/teams" ]]; then
  run mkdir -p "$TARGET/teams"
  run cp -r "$KRONUS_ROOT/.claude/teams/"* "$TARGET/teams/" 2>/dev/null || true
  log_success "Team configurations installed"
fi

# ─── Knowledge Base (Brain) ───────────────────────────────────────────────

log_header "Setting Up Your Knowledge Base"

BRAIN_DIR="${CUSTOM_BRAIN_PATH:-$HOME/second-brain}"

if [[ ! -d "$BRAIN_DIR" ]]; then
  # Create profession-specific folder structure
  FOLDERS=$(bun -e "JSON.parse(require('fs').readFileSync('$PROF_FILE','utf8')).brain_folders.forEach(f => console.log(f))" 2>/dev/null || echo -e "Projects\nNotes\nResources\nArchive")

  while IFS= read -r folder; do
    run mkdir -p "$BRAIN_DIR/$folder"
  done <<< "$FOLDERS"

  run mkdir -p "$BRAIN_DIR/kronus/memory" "$BRAIN_DIR/kronus/journal" "$BRAIN_DIR/kronus/usage"
  run mkdir -p "$BRAIN_DIR/kronus/.claude/rules"

  log_success "Created knowledge base at $BRAIN_DIR"
  log_dim "Folders organized for: $PROF_LABEL"
else
  run mkdir -p "$BRAIN_DIR/kronus/memory" "$BRAIN_DIR/kronus/journal" "$BRAIN_DIR/kronus/usage"
  run mkdir -p "$BRAIN_DIR/kronus/.claude/rules"
  log_success "Using existing knowledge base at $BRAIN_DIR"
fi

# Create starter notes from profession template
NOTES_CREATED=0
if ! $DRY_RUN; then
  bun -e "
    const prof = JSON.parse(require('fs').readFileSync('$PROF_FILE', 'utf8'));
    const path = require('path');
    const fs = require('fs');
    const brainDir = '$BRAIN_DIR';

    for (const note of prof.starter_notes || []) {
      const fullPath = path.join(brainDir, note.path);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        const frontmatter = [
          '---',
          'title: ' + note.title,
          'created: ' + new Date().toISOString().split('T')[0],
          'type: ' + (note.path.startsWith('Projects') || note.path.startsWith('Cases') ? 'project' : 'resource'),
          '---',
          '',
        ].join('\n');
        fs.writeFileSync(fullPath, frontmatter + note.content + '\n');
        console.log(note.path);
      }
    }
  " 2>/dev/null | while IFS= read -r note_path; do
    log_success "Created: $note_path"
    ((NOTES_CREATED++)) || true
  done
fi

# ─── Persona ──────────────────────────────────────────────────────────────

# Pre-evaluate priority label (case inside heredoc fails in non-interactive shells)
case "${PRIORITY:-4}" in
  1) PRIORITY_LABEL="Organization and memory";;
  2) PRIORITY_LABEL="Building and automation";;
  3) PRIORITY_LABEL="Communication and collaboration";;
  *) PRIORITY_LABEL="Everything — organize, build, communicate";;
esac

PERSONA_FILE="$BRAIN_DIR/kronus/.claude/rules/persona.md"
if [[ ! -f "$PERSONA_FILE" ]]; then
  if ! $DRY_RUN; then
    cat > "$PERSONA_FILE" << PERSONA_EOF
# Kronus — Personal AI for $KRONUS_NAME

## Who You Are

You are Kronus — $KRONUS_NAME's personal AI assistant. You help with everything from building tools to organizing work to writing documents.

## Your Style

$PERSONA_STYLE

## About $KRONUS_NAME

- Name: $KRONUS_NAME
- Profession: $PROF_LABEL
- Priority: $PRIORITY_LABEL

## Guidelines

- Address $KRONUS_NAME by name when appropriate
- Adapt to their profession — use relevant examples and terminology
- Remember context from previous conversations
- Always ask before doing anything irreversible
- Be thorough but concise — lead with the answer
PERSONA_EOF
  fi
  log_success "Created personalized AI profile"
fi

# ─── Environment Config ──────────────────────────────────────────────────

KRONUS_ENV="$HOME/.kronus/.env"
run mkdir -p "$HOME/.kronus"
if [[ ! -f "$KRONUS_ENV" ]]; then
  if ! $DRY_RUN; then
    cat > "$KRONUS_ENV" << ENV_EOF
# Kronus Configuration
KRONUS_OWNER=$KRONUS_NAME
KRONUS_PROFESSION=$PROFESSION

# Knowledge base paths
BRAIN_ROOTS=$BRAIN_DIR|personal$([ "$AUTO_DETECT_PROJECTS" = true ] && echo ",$HOME/.claude/projects|project" || echo "")
BRAIN_DB=$HOME/.kronus/brain.sqlite
BRAIN_UI_PORT=4242
ENV_EOF
  fi
  log_success "Saved configuration to ~/.kronus/.env"
fi

# Domain mapping for knowledge graph note synthesis
DOMAINS_FILE="$HOME/.kronus/domains.json"
if [[ ! -f "$DOMAINS_FILE" ]]; then
  if ! $DRY_RUN; then
    # Profession-aware default domains
    case "$PROFESSION" in
      developer|consultant)
        DOMAINS_JSON='{"default":"work","domains":["work","clients","personal"],"rules":[]}'
        ;;
      lawyer|business)
        DOMAINS_JSON='{"default":"work","domains":["work","clients","personal","cases"],"rules":[]}'
        ;;
      researcher|student)
        DOMAINS_JSON='{"default":"research","domains":["research","personal","coursework"],"rules":[]}'
        ;;
      writer)
        DOMAINS_JSON='{"default":"writing","domains":["writing","personal","clients"],"rules":[]}'
        ;;
      *)
        DOMAINS_JSON='{"default":"work","domains":["work","personal"],"rules":[]}'
        ;;
    esac
    echo "$DOMAINS_JSON" | bun -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      process.stdout.write(JSON.stringify(d, null, 2) + '\n');
    " > "$DOMAINS_FILE" 2>/dev/null || echo "$DOMAINS_JSON" > "$DOMAINS_FILE"
    log_success "Created domain mapping (~/.kronus/domains.json)"
    log_dim "Edit this file to customize how your knowledge graph organizes notes"
  fi
fi

# ─── Telegram / Phone Setup ──────────────────────────────────────────────

BOT_TOKEN=""

if ! $SKIP_DAEMON && $SETUP_TELEGRAM; then
  log_header "Setting Up Phone Access (Telegram)"

  echo -e "  To use Kronus from your phone, you'll need a Telegram bot."
  echo -e "  It's free and takes about 2 minutes:"
  echo ""
  echo -e "  ${BOLD}1.${NC} Open Telegram on your phone"
  echo -e "  ${BOLD}2.${NC} Search for ${CYAN}@BotFather${NC}"
  echo -e "  ${BOLD}3.${NC} Send ${CYAN}/newbot${NC}"
  echo -e "  ${BOLD}4.${NC} Pick a name for your bot (e.g., \"${KRONUS_NAME}'s AI\")"
  echo -e "  ${BOLD}5.${NC} Copy the token it gives you"
  echo ""
  read -p "  Paste your bot token here (or 'skip' to do this later): " -r BOT_TOKEN

  if [[ "$BOT_TOKEN" == "skip" ]] || [[ -z "$BOT_TOKEN" ]]; then
    BOT_TOKEN=""
    log_warn "Skipped for now. You can set this up later."
  else
    log_success "Bot token saved"
  fi

  DAEMON_DIR="$HOME/.claude/daemon"

  if [[ -d "$DAEMON_DIR" ]]; then
    log_info "Updating daemon..."
    (cd "$DAEMON_DIR" && run git pull 2>/dev/null || true)
  else
    log_info "Setting up daemon..."
    run git clone https://github.com/kronus-tech/daemon.git "$DAEMON_DIR" 2>/dev/null || {
      log_warn "Git clone failed — copying from local"
      run mkdir -p "$DAEMON_DIR"
      run cp -r "$KRONUS_ROOT/daemon/"* "$DAEMON_DIR/" 2>/dev/null || true
    }
  fi

  log_info "Installing dependencies..."
  (cd "$DAEMON_DIR" && run bun install 2>/dev/null)
  log_success "Daemon ready"

  if [[ -d "$DAEMON_DIR/dashboard" ]]; then
    log_info "Building dashboard..."
    (cd "$DAEMON_DIR/dashboard" && run bun install 2>/dev/null && run bun run build 2>/dev/null)
    log_success "Dashboard built"
  fi

  # Telegram config files
  TELEGRAM_DIR="$HOME/.claude/channels/telegram"
  run mkdir -p "$TELEGRAM_DIR/logs" "$TELEGRAM_DIR/transcripts" "$TELEGRAM_DIR/scope-approvals"

  if [[ -n "$BOT_TOKEN" ]]; then
    if ! $DRY_RUN; then
      echo "TELEGRAM_BOT_TOKEN=$BOT_TOKEN" > "$TELEGRAM_DIR/.env"
    fi
  fi

  if [[ ! -f "$TELEGRAM_DIR/projects.json" ]]; then
    if ! $DRY_RUN; then
      cat > "$TELEGRAM_DIR/projects.json" << 'PROJECTS_EOF'
{
  "projects": {},
  "defaults": {
    "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    "permissionMode": "acceptEdits"
  }
}
PROJECTS_EOF
    fi
  fi

  if [[ ! -f "$TELEGRAM_DIR/access.json" ]]; then
    if ! $DRY_RUN; then
      cat > "$TELEGRAM_DIR/access.json" << 'ACCESS_EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": [],
  "groups": {},
  "pending": {}
}
ACCESS_EOF
    fi
  fi
fi

# ─── First-Run Brain Scan ─────────────────────────────────────────────────

if [[ -d "$KRONUS_ROOT/brain" ]] && check_dep "bun"; then
  log_header "Scanning Your Knowledge Base"

  # Set env vars for the scan
  export BRAIN_ROOTS="$BRAIN_DIR|personal"
  if $AUTO_DETECT_PROJECTS && [[ -d "$HOME/.claude/projects" ]]; then
    export BRAIN_ROOTS="$BRAIN_DIR|personal,$HOME/.claude/projects|project"
  fi
  export BRAIN_DB="$HOME/.kronus/brain.sqlite"

  SCAN_OUTPUT=$(cd "$KRONUS_ROOT/brain" && bun run src/scan.ts 2>&1) || true

  # Parse scan results
  PERSONAL_COUNT=$(echo "$SCAN_OUTPUT" | grep -oE '[0-9]+ personal' | grep -oE '[0-9]+' || echo "0")
  PROJECT_COUNT=$(echo "$SCAN_OUTPUT" | grep -oE '[0-9]+ project' | grep -oE '[0-9]+' || echo "0")
  TOTAL_COUNT=$(echo "$SCAN_OUTPUT" | grep -oE '[0-9]+ notes indexed' | grep -oE '[0-9]+' || echo "0")

  if [[ "$TOTAL_COUNT" -gt 0 ]]; then
    log_success "Found $TOTAL_COUNT notes in your knowledge base"
    [[ "$PERSONAL_COUNT" -gt 0 ]] && log_dim "$PERSONAL_COUNT personal notes"
    [[ "$PROJECT_COUNT" -gt 0 ]] && log_dim "$PROJECT_COUNT memories from past Claude conversations"
  else
    log_success "Knowledge base ready (starter notes created)"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║              Setup Complete!               ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${BOLD}Hi $KRONUS_NAME!${NC} Your AI is ready."
echo ""
echo -e "  ${GREEN}✓${NC} $agent_count AI specialists"
echo -e "  ${GREEN}✓${NC} $skill_count quick actions"
echo -e "  ${GREEN}✓${NC} Knowledge base at ${CYAN}$BRAIN_DIR${NC}"
if $SETUP_TELEGRAM && ! $SKIP_DAEMON; then
  echo -e "  ${GREEN}✓${NC} Dashboard at ${CYAN}http://localhost:8420${NC}"
  echo -e "  ${GREEN}✓${NC} Knowledge graph at ${CYAN}http://localhost:4242${NC}"
fi
echo ""

# Show suggested first actions from profession config
log_step "Things to try first:"
bun -e "
  const prof = JSON.parse(require('fs').readFileSync('$PROF_FILE', 'utf8'));
  (prof.suggested_first_actions || []).forEach((a, i) => {
    console.log('  ' + (i+1) + '. \"' + a + '\"');
  });
" 2>/dev/null || true
echo ""

# Next steps
log_step "Next steps:"
echo ""
if [[ -n "$BOT_TOKEN" ]] && $SETUP_TELEGRAM; then
  echo "  1. Start your AI:"
  echo -e "     ${CYAN}~/.claude/daemon/scripts/kronus-daemon.sh start${NC}"
  echo ""
  echo "  2. Find your Telegram user ID:"
  echo "     Send a message to @userinfobot on Telegram"
  echo "     Add your ID to ~/.claude/channels/telegram/access.json"
  echo ""
  echo "  3. Create a Telegram group, add your bot, and say hello!"
  echo ""
elif $SETUP_TELEGRAM && ! $SKIP_DAEMON; then
  echo "  1. Set up your Telegram bot when you're ready:"
  echo "     Open Telegram → @BotFather → /newbot → copy token"
  echo -e "     Save it: ${CYAN}echo 'TELEGRAM_BOT_TOKEN=your_token' > ~/.claude/channels/telegram/.env${NC}"
  echo ""
  echo "  2. Start your AI:"
  echo -e "     ${CYAN}~/.claude/daemon/scripts/kronus-daemon.sh start${NC}"
  echo ""
else
  echo "  Just run 'claude' in any directory and start a conversation."
  echo "  Try one of the suggestions above!"
  echo ""
fi

echo -e "  ${DIM}Documentation: https://kronus.tech${NC}"
echo ""
