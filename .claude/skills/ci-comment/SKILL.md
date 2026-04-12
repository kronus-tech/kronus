---
name: ci-comment
description: Parse CI/CD output and generate a formatted PR comment with test results, coverage, and actionable feedback. Auto-invoked when CI output is pasted or user says "CI comment", "PR comment".
model: haiku
context: fork
allowed-tools: Read, Write, Glob
---

Parse the following CI output and generate a PR comment right now:

**CI Output:** $ARGUMENTS

Generate a markdown PR comment with:

## [Pass/Fail Icon] CI [Passed/Failed]

### Test Results
| Status | Count | Duration |
|--------|-------|----------|
| Passed | X | Xs |
| Failed | Y | Ys |
| Skipped | Z | - |

### Failed Tests (if any)
For each failure: file:line, test name, error message, and suggested fix.

### Code Coverage
| Current | Previous | Delta |
|---------|----------|-------|
| X% | Y% | +/-Z% |

### Summary
Actionable bullet points: what to fix before merge.

Use `<details>` for verbose output. Keep the main view scannable.
