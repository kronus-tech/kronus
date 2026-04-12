---
name: kronus-troubleshoot
description: Diagnose and fix common Kronus issues — daemon, brain, dashboard, Telegram. Auto-invoked when user says "troubleshoot", "fix kronus", "kronus not working", "diagnose".
model: sonnet
context: fork
allowed-tools: Read, Bash, Glob, Grep
---

Run a full Kronus health check and fix any issues found.

## Diagnostics (run ALL of these)

### 1. Daemon Status
```bash
~/.claude/daemon/scripts/kronus-daemon.sh status
```
- If not running: offer to start it
- If running: report PID and uptime

### 2. Dashboard API
```bash
curl -s http://localhost:8420/api/status
```
- Should return JSON with version and status
- If down: daemon may need restart

### 3. Knowledge Graph (Brain)
```bash
curl -s http://localhost:4242/api/map
```
- Should return JSON with node counts
- If down: start with `cd ~/.claude/daemon && bun run brain/src/index.ts &` or check if brain-mcp is configured

### 4. Hub Server
```bash
curl -s http://localhost:3100/health
```
- Optional — may not be running
- If down: `cd hub && bun run dev &`

### 5. Telegram Config
```bash
cat ~/.claude/channels/telegram/.env
cat ~/.claude/channels/telegram/access.json
cat ~/.claude/channels/telegram/projects.json
```
- .env must have TELEGRAM_BOT_TOKEN
- access.json must have user IDs in allowFrom
- projects.json maps groups to project paths

### 6. Agents & Skills
```bash
ls ~/.claude/agents/*.md | wc -l
ls -d ~/.claude/skills/*/ | wc -l
```
- Should have 10+ agents and 20+ skills
- If missing: re-run install.sh

### 7. Brain Database
```bash
ls -la ~/.kronus/brain.sqlite
```
- Should exist and be non-zero size
- If missing or corrupted: delete and re-scan

## Fix Protocol

For each issue found:
1. Explain what's wrong in plain language
2. Show the fix command
3. Ask: "Should I fix this? (y/n)" — use AskUserQuestion
4. Apply the fix

## If Daemon Restart Needed

1. Tell the user: "The daemon needs to restart. Active Telegram sessions will reconnect automatically."
2. Ask to proceed with AskUserQuestion
3. Run: `~/.claude/daemon/scripts/kronus-daemon.sh restart`
4. Wait 3 seconds
5. Verify: `curl -s http://localhost:8420/api/status`
6. Report: "Kronus is back online. Dashboard: http://localhost:8420"

## Output Format

```
KRONUS HEALTH CHECK
═══════════════════

✓ Daemon: running (PID XXXX, uptime Xh)
✓ Dashboard: http://localhost:8420 (v5.5)
✗ Brain: not running
  → Fix: cd brain && bun run src/index.ts &
✓ Hub: http://localhost:3100 (v5.3.0)
✓ Telegram: configured (X projects mapped)
✓ Agents: XX installed
✓ Skills: XX installed

Issues found: 1
```
