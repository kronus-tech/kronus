---
name: review
description: Run a code review pipeline on recent changes or a specific PR. Invoke with PR number, branch name, or file path.
model: sonnet
context: fork
allowed-tools: Read, Write, Bash, Glob, Grep
agent: code-reviewer
---

Run a code review right now on:

**Target:** $ARGUMENTS (PR number, branch, file, or "recent changes")

Steps:
1. Get the diff: `git diff` for branches/files, `gh pr diff` for PRs
2. Analyze for: bugs, security issues (OWASP), performance problems, maintainability, test coverage gaps
3. If changes touch auth/crypto/payments, flag as security-sensitive
4. Provide actionable feedback with severity and file:line references
5. Give verdict: approve, request changes, or flag for deeper review

Bash restricted to: `git diff`, `git log`, `git show`, `gh pr diff`, `gh pr view`

Output findings categorized by severity (critical/high/medium/low) with file:line and fix suggestions.
