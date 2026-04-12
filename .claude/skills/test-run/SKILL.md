---
name: test-run
description: Execute test suites, parse results, and triage failures with root-cause analysis. Auto-invoked when user says "run tests", "execute tests", or after test generation.
model: sonnet
context: fork
allowed-tools: Read, Write, Bash, Glob, Grep
---

Execute tests and triage results right now:

**Target:** $ARGUMENTS (test path or command, defaults to full suite)

Steps:
1. Detect test runner from project config
2. Run tests with coverage: `npm test -- --coverage`, `pytest --cov`, `go test -cover ./...`, etc.
3. Parse output for pass/fail counts and coverage
4. For each failure: root-cause analysis, specific fix with file:line, severity (high/medium/low)

Bash restrictions — ONLY these commands:
- Test runners: `npm test`, `npx vitest`, `npx jest`, `pytest`, `go test`, `cargo test`, `forge test`
- Coverage flags: `--coverage`, `--cov`, `-cover`
- FORBIDDEN: `rm`, `mv`, `curl`, `wget`, `npm install`, `pip install`

Output: total/passed/failed/skipped, coverage %, failure details with fixes, coverage gaps. Warn if below 80%.
