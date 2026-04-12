---
name: audit
description: Run a security audit pipeline on the codebase. Chains security scanning, dependency audit, and secret detection.
model: sonnet
context: fork
allowed-tools: Read, Write, Bash, Glob, Grep
agent: security-auditor
---

Run a comprehensive security audit right now on:

**Target:** $ARGUMENTS (path or defaults to full codebase)

Pipeline:
1. **SAST Scan** — Search for: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF patterns
2. **Dependency Audit** — Run `npm audit` / `pip audit` / `cargo audit`, categorize by severity
3. **Secret Detection** — Grep for hardcoded credentials, API keys, tokens, private keys
4. **Config Review** — Check for missing security headers, CSRF, weak auth, exposed debug endpoints

Bash restricted to: `npm audit`, `pip audit`, `cargo audit`, read-only git commands

Output a consolidated report:

| Severity | Category | File:Line | Issue | Remediation |
|----------|----------|-----------|-------|-------------|

End with executive summary and risk score (critical/high/medium/low overall).
