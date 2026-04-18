# Troubleshooting

## Agents Not Showing

```bash
# Check agent files exist
ls .claude/agents/*.md | wc -l
# Should be 10+

# Test direct invocation in Claude Code
> "Invoke planner to plan my day"
```

If files exist but agents don't work:
- Restart Claude Code
- Make sure you're in the kronus directory (or agents are installed globally in `~/.claude/agents/`)
- Check YAML frontmatter: `head -7 .claude/agents/planner.md`

## Daemon Won't Start

```bash
~/.claude/daemon/scripts/kronus-daemon.sh status
```

**"Daemon not running"**
```bash
# Check if port is in use
lsof -i :8420
# Kill stale process if needed, then start
~/.claude/daemon/scripts/kronus-daemon.sh start
```

**"bun: command not found"**
```bash
curl -fsSL https://bun.sh/install | bash
# Restart your terminal, then try again
```

**"claude: command not found"**
```bash
npm install -g @anthropic-ai/claude-code
```

## Telegram Bot Not Responding

1. **Bot not in group** — add your bot to the Telegram group
2. **Group not mapped** — send `/setup /path/to/project` in the group
3. **Not authorized** — your Telegram user ID must be in `~/.claude/channels/telegram/access.json` → `allowFrom`. Get your ID from [@userinfobot](https://t.me/userinfobot)
4. **Daemon not running** — `~/.claude/daemon/scripts/kronus-daemon.sh start`
5. **Bot token invalid** — check `~/.claude/channels/telegram/.env` has your `TELEGRAM_BOT_TOKEN`

```bash
# Check daemon logs for errors
tail -50 ~/.claude/channels/telegram/logs/daemon.log
```

## /setup Path Not Found

The path must exist on your machine or Kronus will create it. Common issues:

- **Case sensitivity**: macOS uses `Desktop` not `desktop`. Kronus tries to fix this automatically, but use the correct case when possible
- **Tilde expansion**: `~/Desktop/my-project` works. Relative paths like `my-project` are resolved from your home directory

```bash
# Use full path if shorthand fails
/setup /Users/yourname/Desktop/my-project
```

## Conversation Too Large (>20MB)

If you see "Request too large" or the bot stops responding after long sessions:

- The conversation context exceeded the Anthropic API limit
- Kronus auto-detects this and resets the session
- Send any message — a fresh session starts automatically
- Important context is preserved in memory

To prevent: avoid reading large files (PDFs, images) in full. Summarize and discard.

## Knowledge Graph Not Starting

```bash
cd /path/to/kronus/brain
bun install    # install dependencies first
bun run start  # starts on http://localhost:4242
```

**"BRAIN_ROOT not set"** — set in `~/.kronus/.env`:
```bash
BRAIN_ROOTS=~/second-brain|personal
```

## Rate Limiting

If the bot goes silent mid-response, the Anthropic API may be rate-limiting. Wait 30-60 seconds and it will resume. This is normal during heavy usage or first-time setup when Claude is creating many files.

## /setup Conflicts with Other Bots

When multiple bots are in a Telegram group, `/setup` may be intercepted by another bot or not delivered at all. Solutions:

1. **Use explicit bot addressing**: `/setup@YourBotName /path/to/project`
2. **Remove other bots** from the group before running `/setup`
3. **Register the project manually** — see [Manual Project Registration](SETUP.md#manual-project-registration)

## BotFather Privacy Mode

If your bot ignores all messages in groups but works in DMs, privacy mode is likely still enabled. By default, BotFather creates bots with privacy mode **on**, which prevents them from seeing most group messages.

**Fix:**
1. Open [@BotFather](https://t.me/BotFather) → `/mybots` → select bot → Bot Settings → Group Privacy → **Turn Off**
2. **Remove and re-add** the bot to existing groups (the privacy change only applies to groups joined after the change)

## User IDs Must Be Strings in access.json

Telegram user IDs in `access.json` must be **strings** (quoted), not numbers:

```json
"allowFrom": ["7735704872"]     ← correct
"allowFrom": [7735704872]       ← WRONG, silently fails
```

**Symptom:** daemon.log shows `Blocked DM from unknown sender: 7735704872` even though the ID is in the file.

## Daemon Goes Silent After 24+ Hours

The daemon's Telegram polling connection can silently drop after long uptime. The bot shows as running but no messages are received.

**Fix:** Restart the daemon:
```bash
~/.claude/daemon/scripts/kronus-daemon.sh restart
```

**Prevent:** Enable autostart so the daemon recovers from crashes:
```bash
~/.claude/daemon/scripts/kronus-daemon.sh autostart on
```

Check daemon.log for `STALE` warnings — these indicate the polling connection may have dropped.

## Git Clone Fails Into Non-Empty Directory

If `git clone https://github.com/kronus-tech/kronus.git .` fails because the directory isn't empty (e.g. Claude Code auto-created `.claude/`), clone into a named folder:

```bash
git clone https://github.com/kronus-tech/kronus.git kronus
cd kronus && ./scripts/install.sh
```

## Getting Help

1. Check daemon logs: `tail -100 ~/.claude/channels/telegram/logs/daemon.log`
2. Check daemon status: `~/.claude/daemon/scripts/kronus-daemon.sh status`
3. File an issue: [github.com/kronus-tech/kronus/issues](https://github.com/kronus-tech/kronus/issues)
