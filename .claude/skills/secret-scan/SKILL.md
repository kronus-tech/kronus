---
name: secret-scan
description: Scan codebase for hardcoded secrets, API keys, tokens, and credentials. Auto-invoked when user says "scan for secrets", "check for credentials", "secret scan".
model: haiku
context: fork
allowed-tools: Read, Glob, Grep
---

Do the following right now:

1. Search for API key patterns: `AKIA`, `sk-`, `pk_`, `ghp_`, `xoxb-`, `Bearer`
2. Search for credential assignments: `password`, `passwd`, `secret`, `token`, `api_key` followed by `=` or `:`
3. Search for connection strings with embedded credentials: `postgresql://`, `mongodb://`, `redis://` containing `@`
4. Search for private keys: `BEGIN RSA PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY`
5. Search for AWS credentials: `aws_access_key_id`, `aws_secret_access_key`
6. Check if `.env` files exist and whether `.gitignore` includes `.env`, `*.pem`, `*.key`

Scan $ARGUMENTS path (defaults to current directory). Skip `node_modules/`, `.git/`, `vendor/`, `__pycache__/`, and backup files.

Output findings as:

| Severity | File:Line | Pattern | Remediation |
|----------|-----------|---------|-------------|

Filter obvious false positives (test fixtures, documentation, example configs with placeholder values). If nothing found, say "No secrets detected" with what was scanned.
