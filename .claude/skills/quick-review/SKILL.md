---
name: quick-review
description: Lightweight code review for a single file or small diff. Auto-invoked for small changes, "review this file", "quick review". For full PR reviews, use the code-reviewer agent.
model: sonnet
context: fork
allowed-tools: Read, Glob, Grep
---

Review the following code right now and report issues:

**Target:** $ARGUMENTS (file path or "recent changes")

Read the target file(s) and check for:

1. **Bugs** — Logic errors, off-by-one, null/undefined access, race conditions
2. **Security** — Injection, XSS, hardcoded secrets, insecure crypto, path traversal
3. **Performance** — N+1 queries, unnecessary loops, missing indexes, memory leaks
4. **Style** — Naming issues, dead code, missing error handling, complexity
5. **Types** — `any` usage, missing type guards, unsafe casts

Output findings as:

| Severity | Line | Issue | Fix |
|----------|------|-------|-----|
| critical/high/medium/low | file:line | description | suggested fix |

If the code looks clean, say so briefly. Keep this concise — it's a quick check, not a full audit.
