---
name: standup-update
description: Generate a standup update from recent commits and open tasks. Auto-invoked when user says "standup", "daily update", "what did I do yesterday".
model: haiku
context: fork
allowed-tools: Read, Bash, Glob, Grep
---

Do the following right now:

1. Run `git log --since="yesterday 00:00" --until="yesterday 23:59" --oneline --no-merges` to get yesterday's commits
2. Run `git log --since="today 00:00" --oneline --no-merges` to get today's commits
3. Run `git status --short` to see uncommitted work
4. Run `git branch --list` to see active branches

Then output a standup update in this exact format:

```
## Done (yesterday)
- [bullet points from yesterday's git log — if empty, say "No commits yesterday"]

## Done (today so far)
- [bullet points from today's git log — if empty, say "Nothing committed yet"]

## Up Next
- [planned work based on open branches, uncommitted changes, recent patterns]

## Blockers
- [any issues detected, or "None"]
```

## Project Notes (v5.4)

If brain-mcp tools are available:
1. Call brain_recent with para_type=project, days=1
2. Include recently modified project notes in the standup

Also provide a **one-liner version** at the end for quick pasting into Slack/chat.

Keep it concise. 2-3 bullets per section max. Use commit messages to infer what was done — don't just list file names.
