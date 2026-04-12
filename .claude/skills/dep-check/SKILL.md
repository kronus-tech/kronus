---
name: dep-check
description: Quick dependency vulnerability scan. Auto-invoked when user says "check dependencies", "audit deps", "npm audit", "pip audit".
model: haiku
context: fork
allowed-tools: Read, Bash, Glob, Grep
---

Do the following right now:

1. Detect the package manager by checking for: package.json (npm/yarn/pnpm), pyproject.toml or requirements.txt (pip), Cargo.toml (cargo), go.mod (go)
2. Run the appropriate audit command:
   - npm: `npm audit --json 2>/dev/null || npm audit`
   - pip: `pip audit 2>/dev/null`
   - cargo: `cargo audit 2>/dev/null`
   - go: `govulncheck ./... 2>/dev/null`
3. Parse the results

Output as:

| Severity | Package | Vulnerability | Fix |
|----------|---------|---------------|-----|
| critical/high/medium/low | name@version | CVE or description | upgrade to X.Y.Z |

End with a summary: total vulnerabilities by severity and recommended actions. If no vulnerabilities found, say so.

Scan $ARGUMENTS path (defaults to current directory).
