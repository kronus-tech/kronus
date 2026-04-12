---
name: project-summary
description: Compress recent git activity into a concise summary. Auto-invoked when user says "summarize", "what happened", "project status", "wrap up".
model: haiku
context: fork
allowed-tools: Read, Bash, Glob, Grep
---

Do the following right now:

1. Run `git log --since="7 days ago" --oneline --stat --no-merges` (or use $ARGUMENTS as time range if provided, e.g. "today", "this week")
2. Run `git status --short`

Then output:

1. A **2-4 sentence summary** covering: what changed, why (from commit messages), and impact level (high/medium/low)
2. A **key changes list** with the most important files modified
3. Any **action items** or TODOs found in commit messages

Focus on WHAT and WHY, not HOW. Be concise.
