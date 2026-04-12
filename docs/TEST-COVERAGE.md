# Kronus Test Coverage Report

**Last updated:** 2026-03-30
**Branches:** v5.3 + v5.4

---

## Summary

| Component | Test Files | Tests | Status |
|-----------|-----------|-------|--------|
| **Hub Core** | 13 | 632 | Pass |
| **Hub Fuzz** | 1 | 166 | 23 findings (expected) |
| **Connect SDK** | 7 | 127 | Pass (individually) |
| **Smart Scraper** | 1 | 12 | Pass |
| **Code Analyzer** | 1 | 24 | Pass |
| **Brain-MCP** | 7 | 286 | Pass |
| **Total** | **30** | **~1,247** | |

**Note:** Connect SDK tests have 18 cross-file failures when run in batch due to Bun's `mock.module` caching. All pass individually.

---

## Hub Tests (v5.3)

### Unit Tests

| File | Tests | What It Covers |
|------|-------|---------------|
| tests/unit/config.test.ts | 27 | Config loading, env validation, defaults, frozen object |
| tests/unit/logger.test.ts | 22 | JSON output, level filtering, context spread |
| tests/unit/health.test.ts | 8 | Health endpoint, 404 handling |
| tests/unit/db/schema.test.ts | 85 | genKronusId, all 8 table columns, relations, data types |
| tests/unit/auth/jwt.test.ts | 26 | Key init, sign/verify, claims, JWKS |
| tests/unit/auth/passwords.test.ts | 14 | Argon2 hash/verify, salting, malformed hash |
| tests/unit/auth/errors.test.ts | 33 | All 5 AppError subclasses, instanceof chain |
| tests/unit/billing/stripe.test.ts | 18 | isStripeConfigured, plan prices, checkout stub |
| tests/unit/relay/types.test.ts | 28 | Rate limit tiers, close codes, getRateLimits |
| tests/unit/relay/connections.test.ts | 32 | Register/unregister, plan caps, replacement |
| tests/unit/relay/metering.test.ts | 13 | Pipeline calls, key patterns, flush lifecycle |
| tests/unit/lib/rate-limit.test.ts | 19 | checkRateLimit allowed/blocked, per-day, per-tier |
| tests/unit/gateway/health-check.test.ts | 38 | Ping success/failure, degraded/offline transitions |

### Integration Tests

| File | Tests | What It Covers |
|------|-------|---------------|
| tests/integration/auth.test.ts | 41 | Register, login, refresh, validation, enumeration |
| tests/integration/instances.test.ts | 28 | Register, heartbeat, delete, ownership |
| tests/integration/apps.test.ts | 51 | List, search, detail, install, subscribe, pagination |
| tests/integration/gateway.test.ts | 35 | Proxy POST/GET, auth, SSRF, timeout, rate limit |
| tests/integration/developer.test.ts | 56 | Submit, update, versions, analytics, payouts, MCP check |
| tests/integration/billing.test.ts | 35 | Subscription, checkout, portal, usage, webhooks |
| tests/integration/admin.test.ts | 49 | Review queue, approve, reject, suspend, metrics |

### Security / Fuzz Tests

| File | Tests | What It Covers |
|------|-------|---------------|
| tests/security/fuzz.test.ts | 166 | Malformed JWTs, SQL injection, oversized payloads, path traversal, type confusion, header manipulation, auth bypass |

---

## Connect SDK Tests (v5.3)

| File | Tests | What It Covers |
|------|-------|---------------|
| tests/unit/cli.test.ts | 9 | CLI help, version, command error behavior |
| tests/unit/index.test.ts | 10 | SDK exports, VERSION, getStatus |
| tests/unit/identity.test.ts | 30 | Keypair gen, save/load/delete, fingerprint, roundtrip |
| tests/unit/token-manager.test.ts | 14 | getAccessToken caching, refresh, callback |
| tests/unit/relay-client.test.ts | 25 | WS connect/send/receive, reconnect, correlation |
| tests/unit/app-manager.test.ts | 20 | installApp, uninstallApp, updateApps, registry |
| tests/unit/heartbeat.test.ts | 19 | Start/stop, interval, graceful degradation |

---

## Demo App Tests (v5.3)

| File | Tests | What It Covers |
|------|-------|---------------|
| smart-scraper/src/index.test.ts | 12 | scrape_url, scrape_batch, extract_data, MCP handler |
| code-analyzer/src/index.test.ts | 24 | analyze_repo, dependency_graph, find_patterns, architecture_map |

---

## Brain-MCP Tests (v5.4)

| File | Tests | What It Covers |
|------|-------|---------------|
| tests/config.test.ts | 14 | Config loading, env overrides, defaults |
| tests/db.test.ts | 35 | Schema (16 cols), WAL, FTS5, triggers, idempotency |
| tests/parser.test.ts | 39 | Frontmatter, wikilinks, tags, headings, code-block masking |
| tests/indexer.test.ts | 18 | Hash check, upsert, wikilink resolution, tag edges, PARA |
| tests/tools.test.ts | 78 | All 13 MCP tools against synthetic vault |
| tests/e2e.test.ts | 29 | Create-index-search chain, orphan recovery, path traversal |
| tests/perf.test.ts | 7 | 1000-note scan (1.25s), search p95 (1ms), clusters (15ms) |

### Performance Benchmarks

| Metric | Result | Target |
|--------|--------|--------|
| Initial scan (1000 notes) | 1.25s | <10s |
| brain_search p95 | 1ms | <100ms |
| brain_clusters (1000 nodes) | 15ms | <2s |
| brain_map p95 | 5ms | <500ms |
