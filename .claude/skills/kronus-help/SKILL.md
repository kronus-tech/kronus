---
name: kronus-help
description: Show Kronus setup guide — how to configure Claude Code, set up the Telegram daemon, add projects, manage permissions. Auto-invoked when user says "kronus help", "how to set up", "configure kronus".
user-invocable: true
model: haiku
context: fork
allowed-tools: Read
disable-model-invocation: true
---

Print the following guide right now. Do not summarize or modify — output it exactly:

---

# Kronus — Setup & Configuration Guide

## Installation

Kronus is installed globally at `~/.claude/`. The source repo is at `~/kronus/`.

```bash
# Clone and install
git clone https://github.com/kronus-tech/kronus.git
cd claude-kronus && ./scripts/install.sh
```

## Telegram Daemon Setup

### 1. Create a Telegram Bot
- Message @BotFather → `/newbot` → follow prompts
- Copy the bot token
- Save it: `echo "TELEGRAM_BOT_TOKEN=<token>" > ~/.claude/channels/telegram/.env`

### 2. Disable Bot Privacy Mode
- @BotFather → `/mybots` → select your bot → Bot Settings → Group Privacy → Turn off
- This lets the bot see all messages in groups, not just /commands

### 3. Create Telegram Groups
- Create a Telegram group for each project (e.g., "my-project")
- Add your bot to each group

### 4. Get Group IDs
```bash
# After adding bot to groups and sending a message:
TOKEN=$(grep TELEGRAM_BOT_TOKEN ~/.claude/channels/telegram/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" | python3 -m json.tool
# Look for chat.id (negative number like -5101058364)
```

### 5. Register Projects
```bash
# Register access for each group
# Edit ~/.claude/channels/telegram/access.json to add groups

# Map group to project directory
./scripts/kronus-init.sh --group -5101058364 --name "my-project" --path /path/to/project
```

### 6. Disable the Telegram Plugin
The daemon and plugin can't run simultaneously (both use getUpdates).
```bash
# In ~/.claude/settings.json, set:
# "telegram@claude-plugins-official": false
```

### 7. Start the Daemon
```bash
./scripts/kronus-daemon.sh start      # Start in background
./scripts/kronus-daemon.sh status     # Check status
./scripts/kronus-daemon.sh logs       # Tail logs
./scripts/kronus-daemon.sh restart    # Restart
./scripts/kronus-daemon.sh stop       # Stop
```

## Project Configuration

### projects.json
Located at `~/.claude/channels/telegram/projects.json`:
```json
{
  "projects": {
    "-5101058364": {
      "name": "my-project",
      "path": "/path/to/project",
      "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      "permissionMode": "acceptEdits"
    }
  }
}
```

### Permission Modes
| Mode | Behavior |
|------|----------|
| `default` | Ask before dangerous operations |
| `acceptEdits` | Auto-approve file changes, ask for Bash |
| `plan` | Claude plans but doesn't make changes |
| `dontAsk` | Don't ask, just do everything |
| `bypassPermissions` | Skip all checks (use with caution) |
| `auto` | Let Claude decide |

Change mode from Telegram: `/mode plan` or `/mode accept`

### Allowed Tools
Default: `Read, Write, Edit, Glob, Grep, Bash`

Add more from Telegram: `/trust WebSearch` or `/trust WebFetch`

Or edit `projects.json` directly.

## Key Files

| File | Purpose |
|------|---------|
| `~/.claude/channels/telegram/.env` | Bot token |
| `~/.claude/channels/telegram/access.json` | Access control (who can message) |
| `~/.claude/channels/telegram/projects.json` | Group → project mapping |
| `~/.claude/channels/telegram/daemon.pid` | Daemon process ID |
| `~/.claude/channels/telegram/logs/daemon.log` | Daemon logs |
| `~/.claude/settings.json` | Global Claude Code settings |
| `.claude/settings.json` | Project-level settings |

## Permissions & Safety

### Two-Layer Safety
1. **allowedTools in projects.json** — per-project tool whitelist
2. **pre-bash-check.sh hook** — blocks destructive commands globally (rm -rf, sudo, force push, etc.)

### Expanding Permissions
```bash
# In .claude/settings.json, permissions.allow:
"Bash(npm test *)"    # Allow npm test
"Bash(git log *)"     # Allow git log
```

### Blocked Commands (always, regardless of mode)
- `rm -rf /`, `sudo rm`, `mkfs`, `dd if=`
- `git push --force origin main/master`
- `git reset --hard`
- `DROP TABLE`, `DROP DATABASE`

## Troubleshooting

### Daemon won't start
```bash
# Check for stale PID
cat ~/.claude/channels/telegram/daemon.pid
kill <pid>  # Kill stale process
rm ~/.claude/channels/telegram/daemon.pid
./scripts/kronus-daemon.sh start
```

### Bot not receiving messages
- Check bot privacy mode is OFF (@BotFather → Bot Settings → Group Privacy)
- Remove and re-add bot to the group after changing privacy
- Check access.json has the group ID in `groups`

### Plugin conflict
- Only one consumer of getUpdates per bot token
- Either run the daemon OR the plugin, not both
- Disable plugin: set `telegram@claude-plugins-official: false` in `~/.claude/settings.json`

### Session issues
- `/new` in Telegram to start fresh
- `/stop` to kill a stuck session
- Check logs: `./scripts/kronus-daemon.sh logs`

---
