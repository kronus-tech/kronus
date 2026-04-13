# Kronus Security Findings Register

> This is a point-in-time audit log from the v5.3/v5.4 development cycle. All HIGH/CRITICAL findings in the "Fixed" category have been resolved. Open items in BRAIN-010 to BRAIN-017 are tracked for v2.0.

**Last updated:** 2026-03-31
**Total findings:** 88 (HUB-01 to HUB-71 + BRAIN-001 to BRAIN-017)
**Fixed:** 42 | **Accepted risk:** 6 | **Documented for later:** 40

---

## Hub Findings (HUB-01 to HUB-71)

### Fixed In-Session

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| HUB-01 | HIGH | No rate limiting on auth endpoints | Rate limiting wired (3/hr register, 5/min login, 10/min refresh) |
| HUB-02 | HIGH | Seed password hash was plaintext | Real argon2 hash of throwaway password |
| HUB-03 | HIGH | No FK cascade behavior defined | Explicit onDelete cascade/restrict on all FKs |
| HUB-06 | MEDIUM | updated_at never auto-updates | $onUpdate(() => new Date()) added |
| HUB-07 | MEDIUM | drizzle.config.ts non-null assertion | Env guard with clear error message |
| HUB-12 | HIGH | No per-user instance registration limit | Plan-based cap (free:1, pro:5, enterprise:50) |
| HUB-13 | HIGH | JWT claims forwarded without DB re-validation | Re-fetch user plan from DB on instance registration |
| HUB-15 | MEDIUM | Body size limit not on /instances/* | bodyLimit 16KB added |
| HUB-17 | MEDIUM | registered_at undefined at runtime | Uses created_at from Hub response |
| HUB-20 | MEDIUM | No max-length on instance string fields | Caps: public_key 4096, fingerprint 256, version 32, os 64 |
| HUB-24 | HIGH | Refresh token accepted at relay | Type check rejects refresh tokens |
| HUB-26 | HIGH | No WebSocket message size limit | Per-plan limits (free:64KB, pro:512KB, enterprise:2MB) + transport cap |
| HUB-34 | HIGH | Metering deletes Redis before Postgres insert | Insert first, delete on success |
| HUB-40 | HIGH | IPv6 private addresses not blocked | IPv6 loopback, unique-local, link-local blocked |
| HUB-41 | HIGH | 0.0.0.0 not blocked | Added to SSRF guard |
| HUB-42 | HIGH | Fetch follows redirects (SSRF via redirect) | redirect:'error' on all upstream fetch |
| HUB-45 | MEDIUM | Upstream Content-Type reflected verbatim | Allowlist: json, event-stream, octet-stream, ndjson |
| HUB-47 | MEDIUM | App slug not validated | Regex: ^[a-z0-9][a-z0-9-]{0,62}$ |
| HUB-48 | HIGH | No body size limit on /mcp/* | bodyLimit 256KB |
| HUB-49 | HIGH | Refresh token accepted at gateway | Type check rejects refresh tokens |
| HUB-55 | MEDIUM | Developer error body reflected in responses | Capped at 256 chars |
| HUB-57 | MEDIUM | developer_mcp_url in public API response | Removed from public response |
| HUB-59 | HIGH | Path traversal in manifest files[].dest | Regex validation, reject .., absolute paths |
| HUB-60 | HIGH | Health check unbounded concurrency | Capped at 20 parallel probes (pLimit) |
| HUB-61 | MEDIUM | pricing.model not validated | Allowlist: free, one_time, subscription, usage |
| HUB-62 | MEDIUM | checkMcpCompliance response body not cancelled | await response.body?.cancel() added |
| HUB-63 | MEDIUM | Health check response body not cancelled | await response.body?.cancel() added |
| HUB-64 | MEDIUM | icon_url not checked with isPrivateOrLocalUrl | SSRF check added |
| HUB-68 | MEDIUM | Stub mode active without NODE_ENV guard | Production guard added |

### Accepted Risk (Documented in hub/docs/SECURITY-ACCEPTED-RISKS.md)

| ID | Severity | Issue | Mitigation | Revisit |
|----|----------|-------|------------|---------|
| HUB-39/58 | CRITICAL | DNS rebinding SSRF | String-level IP check blocks most vectors | Needs egress proxy or DNS resolution |
| HUB-22 | HIGH | JWT token in URL query string | Token is short-lived (1h) | Needs one-time ticket pattern |
| HUB-23 | HIGH | No JWT revocation | Short 1h expiry limits blast radius | Needs Redis jti set |
| HUB-04 | HIGH | Stateless refresh tokens, no rotation | 30-day expiry, can't be revoked | Needs Redis JTI store |
| HUB-53 | HIGH | SSE stream no idle timeout | 30s initial timeout exists | Needs max stream duration |
| HUB-67 | HIGH | Webhook event idempotency (replay) | Stripe retries are rare | Needs dedup table |

### Documented for Later (MEDIUM/LOW)

| ID | Severity | Issue |
|----|----------|-------|
| HUB-04 | MEDIUM | Enum CHECK constraints on text fields |
| HUB-05 | MEDIUM | usage_events no FK constraints |
| HUB-08 | MEDIUM | price_cents accepts negative values |
| HUB-09 | LOW | nanoid collision (85 bits entropy, statistically safe) |
| HUB-10 | LOW | Missing index on users.plan |
| HUB-11 | LOW | optionalAuth conflates no-token with bad-token |
| HUB-14 | HIGH | CLI password echo (needs hidden input) |
| HUB-16 | MEDIUM | CLI Hub URL not validated (SSRF-adjacent) |
| HUB-18 | LOW | Heartbeat installed_apps validated but discarded |
| HUB-19 | LOW | Dummy hash sentinel is public (low practical risk) |
| HUB-25 | MEDIUM | No iat freshness check on relay tokens |
| HUB-27 | MEDIUM | target field used in Redis keys without validation |
| HUB-28 | LOW | request_id reflected without sanitization |
| HUB-29 | MEDIUM | Rate limiter increments before checking |
| HUB-30 | MEDIUM | INCR and EXPIRE not atomic |
| HUB-31 | LOW | Fixed-window rate limit burst doubling |
| HUB-32 | HIGH | TOCTOU race in connection limit (safe single-threaded) |
| HUB-33 | LOW | Existing connection closed before new registration confirmed |
| HUB-35 | MEDIUM | target field corrupts metering key structure |
| HUB-36 | MEDIUM | No Redis key namespace prefix per environment |
| HUB-37 | INFO | Redis no explicit TLS config |
| HUB-38 | LOW | Debug logs record traffic metadata |
| HUB-43 | MEDIUM | SSRF check not at app registration time |
| HUB-44 | HIGH | Content-Type forwarded verbatim (partially fixed via allowlist) |
| HUB-46 | LOW | Implicit upstream header sanitization |
| HUB-50 | MEDIUM | app_access JWT claim bypasses live subscription check |
| HUB-51 | MEDIUM | Gateway rate limit no daily cap |
| HUB-52 | LOW | GET/POST share same rate limit counter |
| HUB-54 | MEDIUM | SSE stream body piped with no inspection |
| HUB-56 | MEDIUM | App cache not invalidated on status change |
| HUB-65 | LOW | mcp.tools array items not validated |
| HUB-66 | LOW | Version record has null developer_mcp_url |
| HUB-69 | MEDIUM | Open redirect in Connect returnUrl |
| HUB-70 | MEDIUM | Webhook plan upgrade trusts metadata |
| HUB-71 | LOW | executePayout accepts caller-supplied amounts |

---

## Brain-MCP Findings (BRAIN-001 to BRAIN-009)

### All Fixed

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| BRAIN-001 | HIGH | FTS5 MATCH receives raw unsanitized query | try/catch returns "Invalid search query syntax" |
| BRAIN-002 | HIGH | Path traversal in /api/open (prefix bypass) | Trailing slash on prefix check |
| BRAIN-003 | HIGH | Frontmatter injection in brain_create | yamlEscape() strips newlines and quotes |
| BRAIN-004 | MEDIUM | CORS header doesn't enforce same-origin | Origin header validated server-side |
| BRAIN-005 | MEDIUM | Regex injection in patchFmField key | escapeRegex() on key before RegExp |
| BRAIN-006 | MEDIUM | Frontmatter injection in brain_update | yamlEscape() applied |
| BRAIN-007 | LOW | console.log on stdout corrupts MCP stream | Changed to console.error |
| BRAIN-008 | LOW | LIKE wildcard injection in indexer | escapeLike() + ESCAPE clause |
| BRAIN-009 | INFO | HTTP server binds to all interfaces | hostname: '127.0.0.1' |

---

## Brain-MCP v5.5 Findings (BRAIN-010 to BRAIN-017)

### Requires Fix

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| BRAIN-010 | HIGH | /api/open validates against personal brainRoot only — ignores multi-root config | Open |
| BRAIN-011 | HIGH | findRootForPath/findLabelForPath use startsWith without trailing slash — prefix collision | Open |
| BRAIN-012 | MEDIUM | collectProjectMemoryFiles() does not guard against symlinks escaping ~/.claude/projects/ | Open |
| BRAIN-013 | MEDIUM | source filter not validated at application level — MCP schema enum not enforced by SDK | Open |
| BRAIN-014 | MEDIUM | /api/graph exposes source_root + project memory paths to UI/browser | Open |
| BRAIN-015 | MEDIUM | watcher joins root.path + OS filename without resolve() — path escape possible | Open |
| BRAIN-016 | LOW | No SQLITE_BUSY retry in watcher handleChange — concurrent indexer writes silently dropped | Open |
| BRAIN-017 | LOW | brain_create and brain_update path guards missing trailing slash (same pattern as BRAIN-011) | Open |

---

## Audit History

| Date | Scope | Tool | Findings |
|------|-------|------|----------|
| 2026-03-29 | Phase 0 DB schema | security-auditor | 10 (DB-001 to DB-010) |
| 2026-03-29 | Phase 1 auth | security-auditor | 11 (HUB-01 to HUB-11) |
| 2026-03-29 | Phase 1 gate | security-auditor + fuzzing-agent + dep-check + secret-scan | Gate PASS |
| 2026-03-29 | Phase 2 relay | security-auditor | 17 (HUB-22 to HUB-38) |
| 2026-03-29 | Phase 3 gateway | security-auditor | 19 (HUB-39 to HUB-57) |
| 2026-03-29 | Phase 3 developer | security-auditor | 9 (HUB-58 to HUB-66) |
| 2026-03-29 | Phase 6 billing | security-auditor | 5 (HUB-67 to HUB-71) |
| 2026-03-30 | Brain-MCP | security-auditor | 9 (BRAIN-001 to BRAIN-009) |
| 2026-03-31 | Brain-MCP v5.5 (multi-root) | security-auditor | 8 (BRAIN-010 to BRAIN-017) |
| 2026-03-29 | All phases | dep-check | 4 moderate (esbuild/drizzle-kit dev-only) |
| 2026-03-29 | All phases | secret-scan | PASS (0 secrets) |
