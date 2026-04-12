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

## Getting Help

1. Check daemon logs: `tail -100 ~/.claude/channels/telegram/logs/daemon.log`
2. Check daemon status: `~/.claude/daemon/scripts/kronus-daemon.sh status`
3. File an issue: [github.com/kronus-tech/kronus/issues](https://github.com/kronus-tech/kronus/issues)
