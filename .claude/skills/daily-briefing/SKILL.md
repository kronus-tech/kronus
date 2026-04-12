---
name: daily-briefing
description: Generate a morning briefing with recent git activity, open tasks, and priorities. Auto-invoked when user says "briefing", "what's happening", "morning update", or at session start.
model: sonnet
context: fork
allowed-tools: Read, Bash, Glob, Grep
---

Do the following right now:

1. Run `git log --since="24 hours ago" --oneline --stat --no-merges` to get recent commits
2. Run `git status --short` to see uncommitted work
3. Run `git branch -a` to see all branches
4. Run `gh pr list --state open 2>/dev/null` to check open PRs (skip if gh not available)

Then output a morning briefing in this format:

```
# Briefing — [today's date]

## Yesterday
- [commits from last 24h, grouped by purpose]

## Open Work
- [branches with uncommitted changes]
- [open PRs if any]

## Today's Priorities
1. [suggested based on recent patterns]
2. [unfinished work from yesterday]
3. [open PRs needing review]

## Blockers
- [any detected issues, or "None"]
```

## Second Brain Activity (v5.4)

If brain-mcp tools are available, include in the briefing:
1. Call brain_map to get overall brain health score and stats
2. Call brain_recent with days=1 to get notes modified in the last 24h
3. Include in the output:
   - Brain Health: {health_score}%
   - Notes Modified (24h): {count}
   - Orphan Notes: {orphan_count} (suggest linking)

Keep it scannable — someone should read this in 30 seconds. If $ARGUMENTS specifies a path, use that directory.
