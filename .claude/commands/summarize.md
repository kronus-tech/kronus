Summarize recent project activity.

Scope: $ARGUMENTS

Instructions:
1. Invoke the **project-summarizer** agent to compress recent git activity into a concise summary
2. Include: key changes, decisions made, files modified, and impact assessment
3. Store the summary for future retrieval by memory-retriever

Recent commits:
```
!git log --oneline -20
```

Files changed recently:
```
!git diff --stat HEAD~5 2>/dev/null || echo "Not enough commits"
```
