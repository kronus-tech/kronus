Generate a daily project briefing.

Focus: $ARGUMENTS

Instructions:
1. Invoke the **memory-retriever** agent to gather recent project context
2. Invoke the **planner** agent to compile a briefing that includes:
   - Recent activity summary (commits, PRs, issues)
   - Current priorities and blockers
   - Suggested tasks for today
   - Any outstanding action items

Recent git activity:
```
!git log --oneline --since="24 hours ago" 2>/dev/null || git log --oneline -10
```

Current branch status:
```
!git status --short
```
