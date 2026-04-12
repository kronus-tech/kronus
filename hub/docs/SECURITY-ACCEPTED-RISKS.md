---
last_reviewed: 2026-03-29
reviewed_by: backend-infra
---

# Hub Security — Accepted & Deferred Risks

This document records security findings that were consciously deferred or accepted during v5.3
development. Each entry explains the residual risk, mitigating controls already in place, and the
condition that should trigger a revisit.

---

## HUB-SR-01: IP-based rate limiting is proxy-naive

**Finding:** Auth route rate limits key on `x-forwarded-for`. A client behind a shared NAT (or a
developer testing through a forward proxy) could be locked out by another user at the same IP.
Conversely, an attacker who can spoof or rotate the forwarded IP header on an unprotected edge
could bypass the limit entirely.

**Residual risk:** Low-medium in the current deployment model (single-tenant developer tools). High
if the Hub is ever exposed directly to the internet without a trusted reverse proxy.

**Mitigating controls:**
- Rate limits are generous enough not to affect legitimate use (3 reg/hr, 5 login/min, 10 refresh/min).
- Redis-backed counters reset on window expiry — no permanent lockout.
- `secureHeaders()` middleware sets `X-Content-Type-Options`, `X-Frame-Options`, etc.

**Revisit when:** Hub is deployed behind a public-facing load balancer or CDN. At that point,
replace the raw IP key with a per-user-ID key on authenticated endpoints, and enforce trusted
proxy IP validation at the ingress layer (e.g., Cloudflare trusted IP list).

---

## HUB-SR-02: JWT refresh tokens are not persisted or revocable

**Finding:** Refresh tokens are signed JWTs with no server-side record. A stolen refresh token
remains valid until it expires. There is no revocation endpoint.

**Residual risk:** Medium. Token lifetime is bounded by `signRefreshToken` expiry, but any
compromise window is non-zero.

**Mitigating controls:**
- Access tokens are short-lived (15 min by default).
- Refresh tokens are validated against the user record — a deleted user's token is rejected.
- HTTPS-only transport prevents token interception in transit.

**Revisit when:** Phase 5.33 (Teams/Enterprise) or when a user-facing "sign out all devices"
feature is required. Implement a `refresh_token_jti` table in Postgres with Redis TTL mirror
for fast revocation checks.

---

## HUB-SR-03: Stripe billing stubs silently succeed in non-production environments

**Finding:** When `STRIPE_SECRET_KEY` is not set and `NODE_ENV !== "production"`, checkout and
portal sessions return stub responses (`stub_session`, `returnUrl`) and the webhook endpoint
acknowledges with `{ received: true, mode: "stub" }`. A misconfigured staging environment
could process real user actions against stubs.

**Residual risk:** Low. The production guard added in Phase 8 (HUB-68) raises a hard error in
production. Staging deployments that omit `NODE_ENV=production` and `STRIPE_SECRET_KEY` will
silently stub — but no real money moves.

**Mitigating controls:**
- Production guard: `createCheckoutSession`, `createPortalSession`, and the webhook handler all
  throw / return 503 in production when Stripe is unconfigured.
- Stub mode logs a structured `info` entry so operators can detect it in log aggregators.

**Revisit when:** A staging environment is provisioned that should test real Stripe flows. At that
point add a `BILLING_MODE=stub|live` env var to make the intent explicit rather than inferring
from `NODE_ENV`.

---

## HUB-SR-04: Admin API key is a static bearer token

**Finding:** `X-Admin-Key` is a single shared secret stored in `ADMIN_API_KEY`. There is no
rotation mechanism, no per-operation scoping, and no audit trail beyond the structured request log.

**Residual risk:** Medium. Rotation requires a deployment config change and a server restart.
Leaked keys grant full admin access until rotated.

**Mitigating controls:**
- Key is read from environment — never hardcoded.
- All admin requests are logged with method, path, status, and duration.
- Admin routes are body-limited to 16 KB, reducing attack surface.

**Revisit when:** More than one human operator needs admin access, or the Hub is offered as a
managed SaaS. At that point replace the static key with short-lived signed admin JWTs or an
internal OAuth client credential grant.

---

## HUB-SR-05: Health checker makes outbound HTTP requests to developer-supplied URLs

**Finding:** Developer MCP URLs are stored in `apps.developer_mcp_url` and are pinged every 5
minutes. Even with the SSRF guard (`isPrivateOrLocalUrl`), an attacker who controls a DNS name
could point it at a private IP after the initial check (DNS rebinding).

**Residual risk:** Low-medium. DNS rebinding requires the attacker to control a DNS record and
time requests within the TTL window.

**Mitigating controls:**
- `isPrivateOrLocalUrl` blocks RFC-1918 and loopback addresses at the URL parse stage.
- `redirect: "error"` prevents open redirect chains.
- Only `published` and `degraded` apps are checked — `pending_review` apps are never probed.
- Response body is cancelled immediately (`response.body?.cancel()`) to prevent FD leaks.
- Concurrency is capped at 20 simultaneous checks (added Phase 8 HUB-60).

**Revisit when:** Hub gains any internal service endpoints on the same network. At that point
add a DNS-resolved IP validation step (resolve → check against RFC-1918 ranges) before opening
the connection.

---

## HUB-SR-06: CORS origin in development allows wildcard (`*`)

**Finding:** When `NODE_ENV !== "production"`, the CORS middleware uses `origin: "*"`, which
permits any origin to make credentialed requests during local development.

**Residual risk:** None in production (wildcard is blocked by the production guard). Low in
development — only affects local developer machines.

**Mitigating controls:**
- Production CORS is pinned to `HUB_URL` (e.g., `https://hub.kronusapp.com`).
- Wildcard is only active when `NODE_ENV` is absent or `"development"`.

**Revisit when:** An internal staging deployment requires CORS from a specific staging frontend
origin. At that point add `CORS_ALLOWED_ORIGINS` to `Config` for explicit multi-origin allow-lists.
