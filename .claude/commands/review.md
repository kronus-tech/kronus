Run a code review on recent changes.

Review target: $ARGUMENTS

Instructions:
1. Get the diff of recent changes:
```
!git diff --stat HEAD~1
```

2. Invoke the **code-reviewer** agent on the diff output
3. If auth-related files are changed, also invoke the **security-auditor** agent
4. Combine findings into a single review report with severity ratings

Full diff for review:
```
!git diff HEAD~1
```

Files changed:
```
!git diff --name-only HEAD~1
```
