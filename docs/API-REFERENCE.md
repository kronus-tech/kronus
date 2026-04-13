# Kronus Hub API Reference

**Version:** 1.0
**Base URL:** `https://hub.kronus.dev` (or your self-hosted `HUB_URL`)

---

## Authentication

All protected endpoints require a **Bearer JWT** in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Token Architecture

Kronus Hub issues **Ed25519-signed JWTs** (algorithm: `EdDSA`). Two token types are in circulation:

| Type | Claim `type` | Lifetime | Purpose |
|------|-------------|----------|---------|
| Access token | `access` | 1 hour | API requests, MCP Gateway, WebSocket Relay |
| Refresh token | `refresh` | 30 days | Obtain new access tokens only |

**Access token payload claims:**

```typescript
{
  sub: string;           // user ID (e.g. "usr_01...")
  instance_id?: string;  // set after POST /instances/register
  plan: string;          // "free" | "pro" | "enterprise"
  capabilities: string[]; // e.g. ["apps:install"]
  app_access: string[];  // slugs of installed paid apps
  scopes: string[];      // e.g. ["read"]
  type: "access";
  iat: number;
  exp: number;
}
```

**Key rules:**
- Refresh tokens cannot be used for API requests, gateway calls, or relay connections — only for `POST /auth/refresh`.
- Instance-scoped tokens (after `/instances/register`) include `instance_id` and are required for `POST /instances/heartbeat` and `WSS /relay/connect`.
- The Hub's public key is discoverable at `GET /.well-known/jwks.json` for third-party verification.

### Admin Authentication

Admin endpoints use a separate static API key:

```
X-Admin-Key: <ADMIN_API_KEY>
```

The key is compared via a constant-time comparison to prevent timing attacks.

### Error Response Format

All errors follow a consistent envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

---

## Rate Limits

| Endpoint group | Window | Limit |
|---------------|--------|-------|
| `POST /auth/register` | Per IP, per hour | 3 requests |
| `POST /auth/login` | Per IP, per minute | 5 requests |
| `POST /auth/refresh` | Per IP, per minute | 10 requests |
| MCP Gateway (free plan) | Per user per app, per minute | 10 calls |
| MCP Gateway (pro plan) | Per user per app, per minute | 60 calls |
| MCP Gateway (enterprise plan) | Per user per app, per minute | 300 calls |
| WebSocket Relay (free plan) | Per user, per minute | 10 messages |
| WebSocket Relay (pro plan) | Per user, per minute | 60 messages |
| WebSocket Relay (enterprise plan) | Per user, per minute | 300 messages |

Rate-limited responses return HTTP `429` with code `RATE_LIMITED`.

---

## Body Size Limits

| Route prefix | Max body |
|-------------|----------|
| `/auth/*` | 64 KB |
| `/instances/*` | 16 KB |
| `/apps/*` | 32 KB |
| `/mcp/*` | 256 KB |
| `/developer/*` | 128 KB |
| `/admin/*` | 16 KB |
| `/billing/*` (except webhooks) | 16 KB |
| `/billing/webhooks` | Unlimited (raw body required for Stripe signature) |

---

## 1. Health

### GET /health

Basic liveness check. No authentication required.

**Auth:** None
**Rate limit:** None

**Response `200`:**
```json
{
  "status": "ok",
  "version": "5.3.0",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

**curl example:**
```bash
curl https://hub.kronus.dev/health
```

---

## 2. Auth

### POST /auth/register

Create a new user account. Returns an access token and refresh token immediately — no separate login step required.

**Auth:** None
**Rate limit:** 3 requests per IP per hour

**Request body:**
```typescript
{
  email: string;    // valid email, max 254 chars, case-insensitive
  name: string;     // 1–100 chars
  password: string; // 8–128 chars
}
```

**Response `201`:**
```json
{
  "user": {
    "id": "usr_01jq...",
    "email": "alice@example.com",
    "name": "Alice",
    "plan": "free"
  },
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Missing or invalid fields (see `details.errors`) |
| 409 | `CONFLICT` | Email already registered |
| 429 | `RATE_LIMITED` | Too many registration attempts from this IP |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","password":"correct-horse-battery"}'
```

---

### POST /auth/login

Authenticate with email and password. Returns tokens on success.

**Auth:** None
**Rate limit:** 5 requests per IP per minute

The response time is constant regardless of whether the email exists (timing-safe login to prevent user enumeration).

**Request body:**
```typescript
{
  email: string;
  password: string;
}
```

**Response `200`:**
```json
{
  "user": {
    "id": "usr_01jq...",
    "email": "alice@example.com",
    "name": "Alice",
    "plan": "free"
  },
  "access_token": "eyJ...",
  "refresh_token": "eyJ..."
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Missing fields |
| 401 | `UNAUTHORIZED` | Invalid email or password (intentionally generic) |
| 429 | `RATE_LIMITED` | Too many login attempts from this IP |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"correct-horse-battery"}'
```

---

### POST /auth/refresh

Exchange a valid refresh token for a new access token. Refresh tokens are not rotated — the same refresh token remains valid for 30 days.

**Auth:** None (refresh token in body)
**Rate limit:** 10 requests per IP per minute

**Request body:**
```typescript
{
  refresh_token: string;
}
```

**Response `200`:**
```json
{
  "access_token": "eyJ..."
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Missing `refresh_token` field |
| 401 | `UNAUTHORIZED` | Invalid, expired, or wrong token type (must be `type: "refresh"`) |
| 429 | `RATE_LIMITED` | Too many refresh attempts from this IP |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"eyJ..."}'
```

---

### GET /.well-known/jwks.json

Returns the Hub's Ed25519 public key in JWK Set format. Use this to verify Hub-issued JWTs in third-party services.

**Auth:** None
**Rate limit:** None

**Response `200`:**
```json
{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "<base64url-encoded public key>",
      "alg": "EdDSA",
      "use": "sig"
    }
  ]
}
```

**curl example:**
```bash
curl https://hub.kronus.dev/.well-known/jwks.json
```

---

## 3. Instances

All instance routes require a valid Bearer JWT. The plan-based instance cap is enforced at registration time using the authoritative plan from the database (not the JWT claim).

**Plan instance limits:**
| Plan | Max active instances |
|------|---------------------|
| free | 1 |
| pro | 5 |
| enterprise | 50 |

---

### POST /instances/register

Register a new Kronus instance for the authenticated user. Returns an instance-scoped access token with `instance_id` embedded — this token is required for heartbeats and WebSocket relay connections.

**Auth:** Bearer JWT (user-level or instance-level)
**Rate limit:** None explicit (plan cap enforced)

**Request body:**
```typescript
{
  public_key: string;            // required, max 4096 chars (Ed25519 or RSA public key)
  machine_fingerprint?: string;  // optional, max 256 chars (e.g. hardware UUID)
  kronus_version?: string;       // optional, max 32 chars (e.g. "5.3.0")
  os?: string;                   // optional, max 64 chars (e.g. "darwin 25.3.0")
}
```

**Response `201`:**
```json
{
  "instance": {
    "id": "inst_01jq...",
    "user_id": "usr_01jq...",
    "status": "active",
    "created_at": "2026-03-29T12:00:00.000Z"
  },
  "access_token": "eyJ..."
}
```

The returned `access_token` contains `instance_id` in its payload. Use this token (not the original login token) for all subsequent instance operations.

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Missing `public_key`, invalid field types, or plan instance cap exceeded |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/instances/register \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"public_key":"<ed25519-pubkey>","kronus_version":"5.3.0","os":"darwin 25.3.0"}'
```

---

### POST /instances/heartbeat

Update the last-seen timestamp for the connected instance. Must use an instance-scoped access token (one that contains `instance_id`).

**Auth:** Bearer JWT with `instance_id` claim
**Rate limit:** None explicit

**Request body:**
```typescript
{
  kronus_version?: string; // optional version update, max 32 chars
  installed_apps?: string[]; // optional, array of installed app slugs
}
```

Body may be empty `{}`.

**Response `200`:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-29T12:05:00.000Z"
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Token does not contain `instance_id` (use instance-scoped token) |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/instances/heartbeat \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"kronus_version":"5.3.1"}'
```

---

### DELETE /instances/:id

Deregister and permanently delete an instance. Only the owning user can delete their own instances — the check is enforced in a single database query (no separate ownership lookup).

**Auth:** Bearer JWT
**Rate limit:** None

**Path parameter:** `id` — the instance ID to delete

**Response `204`:** No content on success.

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 404 | `NOT_FOUND` | Instance not found or not owned by this user |

**curl example:**
```bash
curl -X DELETE https://hub.kronus.dev/instances/inst_01jq... \
  -H "Authorization: Bearer eyJ..."
```

---

## 4. Apps

The marketplace app listing and detail endpoints are public (no authentication required). Install and subscribe require a valid JWT.

---

### GET /apps

List published marketplace apps. Supports filtering, search, sorting, and cursor-based pagination.

**Auth:** None
**Rate limit:** None

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Full-text search against name and description (LIKE, case-insensitive) |
| `type` | string | — | Filter by app type: `developer_mcp`, `local_skill`, `local_agent`, `hybrid` |
| `pricing` | string | — | Filter by pricing model: `free`, `one_time`, `subscription`, `usage` |
| `sort` | string | `popular` | Sort order: `popular` (default), `new` (newest first), `name` (A-Z) |
| `limit` | integer | 20 | Max results per page (1–100) |
| `cursor` | string | — | Pagination cursor (value of `next_cursor` from previous response) |

**Response `200`:**
```json
{
  "apps": [
    {
      "id": "app_01jq...",
      "slug": "my-mcp-server",
      "name": "My MCP Server",
      "description": "Does useful things via MCP.",
      "type": "developer_mcp",
      "pricing_model": "subscription",
      "price_cents": 999,
      "icon_url": "https://example.com/icon.png",
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ],
  "next_cursor": "app_01jr..."
}
```

`next_cursor` is `null` when there are no more pages.

**curl example:**
```bash
curl "https://hub.kronus.dev/apps?sort=new&type=developer_mcp&limit=10"
```

---

### GET /apps/:slug

Get full details for a single published app, including its latest version and rating.

**Auth:** None
**Rate limit:** None

**Path parameter:** `slug` — the app's URL-safe identifier

**Response `200`:**
```json
{
  "app": {
    "id": "app_01jq...",
    "slug": "my-mcp-server",
    "name": "My MCP Server",
    "description": "Does useful things via MCP.",
    "type": "developer_mcp",
    "developer_id": "usr_01jq...",
    "pricing_model": "subscription",
    "price_cents": 999,
    "status": "published",
    "manifest_json": { "name": "my-mcp-server", "version": "1.2.0", "..." },
    "download_url": null,
    "icon_url": "https://example.com/icon.png",
    "created_at": "2026-03-01T00:00:00.000Z",
    "updated_at": "2026-03-20T00:00:00.000Z"
  },
  "latest_version": {
    "version": "1.2.0",
    "changelog": "Bug fixes and performance improvements.",
    "published_at": "2026-03-20T00:00:00.000Z"
  },
  "rating": {
    "average": 4.7,
    "count": 23
  }
}
```

Note: `developer_mcp_url` is intentionally excluded from the public response (internal infrastructure detail).

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 404 | `NOT_FOUND` | App not found or not published |

**curl example:**
```bash
curl https://hub.kronus.dev/apps/my-mcp-server
```

---

### POST /apps/:slug/install

Install an app for the authenticated user. For paid apps, an active subscription must exist. Returns an updated access token with the app added to the `app_access` claim.

**Auth:** Bearer JWT
**Rate limit:** None

**Path parameter:** `slug` — the app slug to install

**Request body:** None required (empty `{}` acceptable).

**Response `200` — for `developer_mcp` apps:**
```json
{
  "install_type": "gateway",
  "gateway_url": "https://hub.kronus.dev/mcp/my-mcp-server",
  "access_token": "eyJ...",
  "app": {
    "id": "app_01jq...",
    "slug": "my-mcp-server",
    "name": "My MCP Server",
    "type": "developer_mcp",
    "pricing_model": "subscription",
    "icon_url": "https://example.com/icon.png"
  }
}
```

**Response `200` — for `local_skill` / `local_agent` apps:**
```json
{
  "install_type": "local",
  "download_url": "https://cdn.example.com/my-skill.tar.gz",
  "files": [
    { "src": "skill.md", "dest": ".claude/skills/my-skill.md" }
  ],
  "access_token": "eyJ...",
  "app": {
    "id": "app_01jq...",
    "slug": "my-skill",
    "name": "My Skill",
    "type": "local_skill",
    "pricing_model": "free",
    "icon_url": null
  }
}
```

**Response `402` — subscription required:**
```json
{
  "error": {
    "code": "SUBSCRIPTION_REQUIRED",
    "message": "An active subscription is required to install this app",
    "subscribe_url": "/apps/my-mcp-server/subscribe"
  }
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 402 | `SUBSCRIPTION_REQUIRED` | Paid app, no active subscription |
| 404 | `NOT_FOUND` | App not found or not published |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/apps/my-mcp-server/install \
  -H "Authorization: Bearer eyJ..."
```

---

### POST /apps/:slug/subscribe

Subscribe to a paid app. Creates or reactivates a subscription record. Stripe integration is pending (Phase 6) — currently activates directly.

**Auth:** Bearer JWT
**Rate limit:** None

**Path parameter:** `slug` — the app slug

**Request body:** None required.

**Response `201`:**
```json
{
  "subscription": {
    "id": "sub_01jq...",
    "status": "active",
    "app_slug": "my-mcp-server"
  },
  "message": "Subscription activated (Stripe integration pending)"
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | App is free and does not require a subscription |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 404 | `NOT_FOUND` | App not found or not published |
| 409 | `CONFLICT` | Already have an active subscription for this app |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/apps/my-mcp-server/subscribe \
  -H "Authorization: Bearer eyJ..."
```

---

## 5. Developer

All developer routes require a valid Bearer JWT. Developers interact with their own apps only — ownership is enforced on all write operations.

---

### POST /developer/apps

Submit a new app to the marketplace. The app is placed in `review` status immediately and is not publicly visible until approved by an admin.

For `developer_mcp` type apps, the Hub performs:
1. An SSRF check to ensure `mcp_url` does not point to a private network.
2. An MCP compliance check — a live `initialize` JSON-RPC call to the developer's server. The server must respond with HTTP 2xx within 10 seconds.

**Auth:** Bearer JWT
**Rate limit:** None explicit (body limit: 128 KB)

**Request body (manifest):**
```typescript
{
  // Required fields
  name: string;          // slug format: lowercase alphanumeric + hyphens, 1–63 chars, globally unique
  display_name: string;  // 1–100 chars
  version: string;       // semver format, e.g. "1.0.0"
  description: string;   // 20–2000 chars
  type: "developer_mcp" | "local_skill" | "local_agent" | "hybrid";

  // Required for developer_mcp
  mcp_url?: string;      // HTTPS URL of the developer's MCP server (not private/local)
  mcp?: {
    tools: object[];     // must be non-empty array
  };

  // Required for local_skill and local_agent
  files?: Array<{
    src: string;  // relative path in package, no "..", no absolute paths
    dest: string; // relative install destination in the user's Kronus directory
  }>;

  // Optional
  pricing?: {
    model: "free" | "one_time" | "subscription" | "usage";
  };
}
```

**Response `201`:**
```json
{
  "app": {
    "id": "app_01jq...",
    "slug": "my-mcp-server",
    "status": "review"
  },
  "message": "Submitted for review"
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Manifest validation failed (see message for details) |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 409 | `CONFLICT` | App slug already taken |
| 422 | `MCP_COMPLIANCE_FAILED` | MCP server did not respond to `initialize` probe |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/developer/apps \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-mcp-server",
    "display_name": "My MCP Server",
    "version": "1.0.0",
    "description": "A powerful MCP server that does X, Y, and Z for your workflow.",
    "type": "developer_mcp",
    "mcp_url": "https://mcp.example.com/mcp",
    "mcp": { "tools": [{"name": "do_thing", "description": "Does a thing"}] },
    "pricing": { "model": "subscription" }
  }'
```

---

### PUT /developer/apps/:id

Update mutable metadata on an existing app. Only `description` and `icon_url` are updatable after submission. The app must be owned by the authenticated user.

**Auth:** Bearer JWT
**Rate limit:** None

**Path parameter:** `id` — the app ID (not slug)

**Request body:**
```typescript
{
  description?: string; // 20–2000 chars
  icon_url?: string;    // valid HTTPS URL, max 2048 chars, must not be private/internal
}
```

At least one field must be provided.

**Response `200`:**
```json
{
  "app": {
    "id": "app_01jq...",
    "slug": "my-mcp-server",
    "name": "My MCP Server",
    "description": "Updated description text...",
    "icon_url": "https://cdn.example.com/icon-v2.png",
    "..."
  }
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | No updatable fields provided, or validation failed |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 403 | `FORBIDDEN` | App not owned by this user |
| 404 | `NOT_FOUND` | App not found |

**curl example:**
```bash
curl -X PUT https://hub.kronus.dev/developer/apps/app_01jq... \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"description":"New description with at least twenty characters here."}'
```

---

### POST /developer/apps/:id/versions

Publish a new version of an existing app. Version strings must be semver and unique per app. For `developer_mcp` type apps, optionally supply a new `developer_mcp_url` — the Hub performs the same SSRF and MCP compliance checks as at submission time.

**Auth:** Bearer JWT
**Rate limit:** None

**Path parameter:** `id` — the app ID

**Request body:**
```typescript
{
  version: string;             // required, semver (e.g. "1.2.0"), unique per app
  changelog?: string;          // optional, max 4000 chars
  developer_mcp_url?: string;  // optional, HTTPS only, developer_mcp type only
  kronus_min_version?: string; // optional, minimum Kronus version required, max 32 chars
}
```

**Response `201`:**
```json
{
  "version": {
    "id": "ver_01jq...",
    "version": "1.2.0",
    "published_at": "2026-03-29T12:00:00.000Z"
  }
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Invalid semver, field type errors, or `developer_mcp_url` provided for non-MCP app type |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 403 | `FORBIDDEN` | App not owned by this user |
| 404 | `NOT_FOUND` | App not found |
| 409 | `CONFLICT` | Version already exists for this app |
| 422 | `MCP_COMPLIANCE_FAILED` | New MCP URL failed compliance probe |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/developer/apps/app_01jq.../versions \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"version":"1.2.0","changelog":"Fixed a critical bug in the search tool."}'
```

---

### GET /developer/analytics

Returns aggregated usage statistics for all apps owned by the authenticated developer. Apps with zero usage are included in the response with zeroed counters.

**Auth:** Bearer JWT
**Rate limit:** None

**Response `200`:**
```json
{
  "apps": [
    {
      "app_id": "app_01jq...",
      "app_slug": "my-mcp-server",
      "total_calls": 14203,
      "total_bytes": 52428800
    },
    {
      "app_id": "app_01jr...",
      "app_slug": "my-other-app",
      "total_calls": 0,
      "total_bytes": 0
    }
  ]
}
```

`total_calls` is the number of MCP gateway or relay invocations. `total_bytes` is the cumulative request payload size in bytes.

**curl example:**
```bash
curl https://hub.kronus.dev/developer/analytics \
  -H "Authorization: Bearer eyJ..."
```

---

### GET /developer/payouts

Returns the authenticated developer's payout history, ordered by most recent first, plus an aggregate summary.

**Auth:** Bearer JWT
**Rate limit:** None

**Response `200`:**
```json
{
  "payouts": [
    {
      "id": "pay_01jq...",
      "developer_id": "usr_01jq...",
      "amount_cents": 7640,
      "commission_cents": 1360,
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ],
  "summary": {
    "total_earned_cents": 7640,
    "total_commission_cents": 1360
  }
}
```

`amount_cents` is the net developer payout. `commission_cents` is the Hub's take. Both are in USD cents.

**curl example:**
```bash
curl https://hub.kronus.dev/developer/payouts \
  -H "Authorization: Bearer eyJ..."
```

---

## 6. MCP Gateway

The MCP Gateway proxies JSON-RPC requests and SSE streams from authenticated Kronus clients to developer-hosted MCP servers. The Hub adds authentication, subscription enforcement, rate limiting, SSRF protection, and usage metering transparently.

**Auth:** Bearer JWT with `app_access` claim containing the app slug (obtained via `POST /apps/:slug/install`)
**Rate limit:** Per-user per-app per-minute (see plan limits above)

For paid apps, the gateway checks the `app_access` JWT claim first (fast path) and falls back to a live subscription lookup (with Redis caching) if the claim does not include the slug.

The gateway adds the following headers to all upstream requests:

| Header | Value |
|--------|-------|
| `X-Kronus-User` | Authenticated user ID |
| `X-Kronus-Plan` | User's current plan |
| `X-Kronus-Request-Id` | Per-request UUID for tracing |

SSRF protection is applied to the stored `developer_mcp_url` at every request. Redirects from the upstream are blocked. Only responses with a `Content-Type` in the allowlist (`application/json`, `text/event-stream`, `application/octet-stream`, `application/x-ndjson`) are forwarded; others are sanitized to the appropriate fallback.

---

### POST /mcp/:slug

Forward a JSON-RPC request to the developer's MCP server. Times out after 30 seconds.

**Auth:** Bearer JWT (access token, not refresh token)
**Rate limit:** Per plan (see plan limits)

**Path parameter:** `slug` — the installed app slug

**Request body:** Any valid MCP JSON-RPC payload, e.g.:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "search",
    "arguments": { "query": "kronus platform" }
  }
}
```

**Response:** The upstream developer server's response, passed through verbatim with sanitized `Content-Type`. HTTP status mirrors the upstream status (for 2xx responses). Non-2xx upstream responses are surfaced as `502`.

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Invalid app slug format |
| 401 | `UNAUTHORIZED` | Missing, invalid, or expired token; refresh token used |
| 403 | `SUBSCRIPTION_REQUIRED` | Paid app with no active subscription |
| 404 | `NOT_FOUND` | App slug not found, draft, or suspended |
| 429 | `RATE_LIMITED` | Gateway rate limit exceeded for this user/app |
| 502 | `APP_UPSTREAM_ERROR` | Developer server returned a non-2xx response |
| 503 | `APP_TIMEOUT` | Developer server did not respond within 30 seconds |
| 503 | `APP_UNAVAILABLE` | App status is `degraded` or `offline` |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/mcp/my-mcp-server \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{}}'
```

---

### GET /mcp/:slug

Open an SSE stream from the developer's MCP server. The response is piped directly without buffering so events arrive in real time. Times out after 30 seconds if the upstream does not respond.

**Auth:** Bearer JWT (access token, not refresh token)
**Rate limit:** Per plan (same as POST; counted as a call with 0 payload bytes)

**Path parameter:** `slug` — the installed app slug

**Response:** The upstream SSE stream, passed through with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `X-Accel-Buffering: no`.

**Error codes:** Same as `POST /mcp/:slug`.

**curl example:**
```bash
curl https://hub.kronus.dev/mcp/my-mcp-server \
  -H "Authorization: Bearer eyJ..." \
  -H "Accept: text/event-stream" \
  --no-buffer
```

---

## 7. Billing

All billing routes require a valid Bearer JWT. The `/billing/webhooks` endpoint is the exception — it is called by Stripe directly with no bearer token.

---

### GET /billing/subscription

Returns the authenticated user's current plan and Stripe billing status.

**Auth:** Bearer JWT
**Rate limit:** None

**Response `200`:**
```json
{
  "plan": "pro",
  "stripe_configured": true,
  "has_customer_id": true
}
```

`stripe_configured` indicates whether Stripe keys are set in the Hub environment. `has_customer_id` indicates whether this user has a Stripe customer record (i.e. has subscribed at least once).

**curl example:**
```bash
curl https://hub.kronus.dev/billing/subscription \
  -H "Authorization: Bearer eyJ..."
```

---

### POST /billing/subscribe/:plan

Initiate a Stripe Checkout session for upgrading the authenticated user's plan. Returns a redirect URL that the client should open in a browser.

**Auth:** Bearer JWT
**Rate limit:** None

**Path parameter:** `plan` — must be `pro` or `enterprise`

**Request body:** None required.

**Response `200`:**
```json
{
  "checkout_url": "https://checkout.stripe.com/pay/cs_test_...",
  "session_id": "cs_test_..."
}
```

After the user completes payment, Stripe sends a webhook to `POST /billing/webhooks` which updates the user's plan in the database.

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | Invalid plan name |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |
| 404 | `NOT_FOUND` | User not found |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/billing/subscribe/pro \
  -H "Authorization: Bearer eyJ..."
```

---

### GET /billing/portal

Generate a Stripe Customer Portal URL for the authenticated user to manage their subscription, update payment methods, or cancel. Requires the user to have a Stripe customer ID (i.e. must have subscribed at least once).

**Auth:** Bearer JWT
**Rate limit:** None

**Response `200`:**
```json
{
  "portal_url": "https://billing.stripe.com/session/..."
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | No billing account found (user has never subscribed) |
| 401 | `UNAUTHORIZED` | Invalid or expired JWT |

**curl example:**
```bash
curl https://hub.kronus.dev/billing/portal \
  -H "Authorization: Bearer eyJ..."
```

---

### GET /billing/usage

Returns the authenticated user's MCP call usage for the current calendar month.

**Auth:** Bearer JWT
**Rate limit:** None

**Response `200`:**
```json
{
  "period_start": "2026-03-01T00:00:00.000Z",
  "period_end": "2026-03-29T12:00:00.000Z",
  "total_calls": 432,
  "total_bytes": 1048576
}
```

`total_calls` is the number of MCP gateway invocations. `total_bytes` is the total request payload volume in bytes.

**curl example:**
```bash
curl https://hub.kronus.dev/billing/usage \
  -H "Authorization: Bearer eyJ..."
```

---

### POST /billing/webhooks

Stripe webhook receiver. Called directly by Stripe — do not call this endpoint from client code.

**Auth:** Stripe signature header (`stripe-signature`). **No Bearer token.**
**Rate limit:** None
**Body limit:** None (raw body required for HMAC signature verification)

The Hub verifies the `stripe-signature` header using `STRIPE_WEBHOOK_SECRET` before processing any event. Signature failures return `400`.

**Handled event types:**

| Event | Effect |
|-------|--------|
| `customer.subscription.created` | Creates or updates the subscription record; updates user plan to `pro` or `enterprise` if plan metadata is set |
| `customer.subscription.updated` | Same as above |
| `customer.subscription.deleted` | Marks subscription `cancelled`; reverts user plan to `free` |
| `invoice.payment_failed` | Marks subscription `past_due` |

All other event types are acknowledged with `200` and ignored.

**Response `200`:**
```json
{ "received": true }
```

**Response `200` (Stripe not configured, non-production):**
```json
{ "received": true, "mode": "stub" }
```

**Error codes:**
| Status | Cause |
|--------|-------|
| 400 | Missing or invalid `stripe-signature` header |
| 500 | `STRIPE_WEBHOOK_SECRET` not set in environment |
| 503 | Stripe not configured in production environment |

---

## 8. Admin

All admin routes require the `X-Admin-Key` header with the value of the `ADMIN_API_KEY` environment variable. The comparison is constant-time to prevent timing attacks. If `ADMIN_API_KEY` is not set, all admin routes return `503`.

---

### GET /admin/apps/review

List all apps currently in `review` status, waiting for admin approval.

**Auth:** X-Admin-Key
**Rate limit:** None

**Response `200`:**
```json
{
  "apps": [
    {
      "id": "app_01jq...",
      "slug": "new-mcp-app",
      "name": "New MCP App",
      "type": "developer_mcp",
      "developer_id": "usr_01jq...",
      "submitted_at": "2026-03-28T10:00:00.000Z",
      "manifest_json": { "..." }
    }
  ]
}
```

**curl example:**
```bash
curl https://hub.kronus.dev/admin/apps/review \
  -H "X-Admin-Key: your-admin-key"
```

---

### POST /admin/apps/:id/approve

Approve an app in review. Before approving, the Hub re-validates the stored manifest and, for `developer_mcp` apps, re-runs the live MCP compliance probe. If either check fails, the app is not approved and the endpoint returns `422` with a reason.

**Auth:** X-Admin-Key
**Rate limit:** None

**Path parameter:** `id` — the app ID

**Request body:** None required.

**Response `200` — approved:**
```json
{
  "approved": true,
  "app": {
    "id": "app_01jq...",
    "slug": "new-mcp-app",
    "status": "published"
  }
}
```

**Response `422` — checks failed:**
```json
{
  "approved": false,
  "reason": "MCP compliance check failed: MCP server did not respond correctly"
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | App is not in `review` status |
| 401 | `ADMIN_UNAUTHORIZED` | Missing or invalid X-Admin-Key |
| 404 | `NOT_FOUND` | App not found |
| 422 | — | Manifest validation or MCP compliance failed |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/admin/apps/app_01jq.../approve \
  -H "X-Admin-Key: your-admin-key"
```

---

### POST /admin/apps/:id/reject

Reject an app with feedback. The app's status is set back to `draft` so the developer can revise and resubmit.

**Auth:** X-Admin-Key
**Rate limit:** None

**Path parameter:** `id` — the app ID

**Request body:**
```typescript
{
  reason?: string; // feedback for the developer; defaults to "No reason provided"
}
```

**Response `200`:**
```json
{
  "app": {
    "id": "app_01jq...",
    "slug": "new-mcp-app",
    "status": "draft"
  },
  "feedback": "The description is too short and the MCP tools list is missing descriptions."
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 401 | `ADMIN_UNAUTHORIZED` | Missing or invalid X-Admin-Key |
| 404 | `NOT_FOUND` | App not found |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/admin/apps/app_01jq.../reject \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"reason":"The mcp.tools array is empty. Add at least one tool definition."}'
```

---

### POST /admin/apps/:id/suspend

Suspend a published or degraded app, making it immediately unavailable to all users. The app's status is set to `suspended`. Cannot be applied to apps in `draft`, `review`, or already `suspended` status.

**Auth:** X-Admin-Key
**Rate limit:** None

**Path parameter:** `id` — the app ID

**Request body:**
```typescript
{
  reason?: string; // internal suspension reason (logged, not returned to developer)
}
```

**Response `200`:**
```json
{
  "app": {
    "id": "app_01jq...",
    "slug": "bad-actor-app",
    "status": "suspended"
  }
}
```

**Error codes:**
| Status | Code | Cause |
|--------|------|-------|
| 400 | `BAD_REQUEST` | App status is not `published` or `degraded` |
| 401 | `ADMIN_UNAUTHORIZED` | Missing or invalid X-Admin-Key |
| 404 | `NOT_FOUND` | App not found |

**curl example:**
```bash
curl -X POST https://hub.kronus.dev/admin/apps/app_01jq.../suspend \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Violates ToS section 4.2"}'
```

---

### GET /admin/metrics

Platform-wide aggregate counters. Returns current counts across users, instances, apps by status, and total MCP call volume.

**Auth:** X-Admin-Key
**Rate limit:** None

**Response `200`:**
```json
{
  "total_users": 1240,
  "total_instances": 1893,
  "total_apps_published": 47,
  "apps_pending_review": 3,
  "apps_degraded": 1,
  "apps_offline": 0,
  "total_mcp_calls": 2847392
}
```

**curl example:**
```bash
curl https://hub.kronus.dev/admin/metrics \
  -H "X-Admin-Key: your-admin-key"
```

---

### GET /admin/health

Returns the health status of all non-draft apps, including their current status and last updated timestamp. Used to monitor developer MCP server availability.

**Auth:** X-Admin-Key
**Rate limit:** None

**Response `200`:**
```json
{
  "apps": [
    {
      "slug": "my-mcp-server",
      "status": "published",
      "developer_mcp_url": "https://mcp.example.com/mcp",
      "last_updated": "2026-03-29T06:00:00.000Z"
    },
    {
      "slug": "flaky-app",
      "status": "degraded",
      "developer_mcp_url": "https://mcp.flaky.io/mcp",
      "last_updated": "2026-03-29T11:45:00.000Z"
    }
  ]
}
```

App statuses reported here: `review`, `published`, `degraded`, `offline`, `suspended`. Apps in `draft` are excluded.

The background health checker probes all `developer_mcp_url` endpoints every 5 minutes and updates the app status accordingly (`published` → `degraded` → `offline`).

**curl example:**
```bash
curl https://hub.kronus.dev/admin/health \
  -H "X-Admin-Key: your-admin-key"
```

---

## 9. WebSocket Relay

The Relay enables real-time, bidirectional message forwarding between Kronus instances. It is built on Bun's native WebSocket server and operates on the same port as the HTTP API.

**Endpoint:** `WSS /relay/connect`

---

### Connection

Connect with an instance-scoped access token (must include `instance_id` claim). The token can be supplied in two ways:

**Option A — Query parameter (simpler):**
```
wss://hub.kronus.dev/relay/connect?token=eyJ...
```

**Option B — Authorization header:**
```
Authorization: Bearer eyJ...
```

**Authentication requirements:**
- Must be an access token (`type: "access"`), not a refresh token.
- Token must include `instance_id` (obtained from `POST /instances/register`).
- Token must include `sub` (user ID).

On successful upgrade, the connection is registered in the relay's in-memory connection registry keyed by `instance_id`. Other instances can target this connection using that ID.

**Connection limits per plan:**
| Plan | Max simultaneous connections |
|------|----------------------------|
| free | 1 |
| pro | 5 |
| enterprise | 20 |

Exceeding the connection limit results in an immediate close with code `4005`.

---

### Message Size Limits

Messages exceeding the per-plan size limit are rejected with an error frame (the connection remains open):

| Plan | Max message size |
|------|-----------------|
| free | 64 KB |
| pro | 512 KB |
| enterprise | 2 MB |

A transport-level cap of 2 MB is enforced by Bun regardless of plan.

---

### Sending a Message

Send a JSON-encoded `RelayMessage` to forward to another connected instance:

```typescript
{
  target: string;     // instance_id of the destination (e.g. "inst_01jq...")
  payload: unknown;   // any JSON-serializable value (MCP JSON-RPC message)
  request_id?: string; // optional correlation ID echoed back in the response
}
```

**Example:**
```json
{
  "target": "inst_01jr...",
  "payload": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 42,
    "params": { "name": "search", "arguments": { "query": "hello" } }
  },
  "request_id": "req-abc-123"
}
```

---

### Receiving a Message

When another instance forwards a message to you, you receive a `RelayResponse`:

```typescript
{
  source: string;     // instance_id of the sender
  payload: unknown;   // the forwarded payload
  request_id?: string; // echoed correlation ID, if the sender provided one
}
```

**Example:**
```json
{
  "source": "inst_01jq...",
  "payload": {
    "jsonrpc": "2.0",
    "result": { "content": [{ "type": "text", "text": "Hello world" }] },
    "id": 42
  },
  "request_id": "req-abc-123"
}
```

---

### Error Frames

Errors are delivered as `RelayError` frames (the connection is not closed unless specified):

```typescript
{
  error: {
    code: string;
    message: string;
  };
  request_id?: string; // echoed if available
}
```

**Application-level error codes:**

| Code | Cause |
|------|-------|
| `INVALID_JSON` | Message could not be parsed as JSON |
| `INVALID_MESSAGE` | Missing required fields (`target` or `payload`) |
| `MESSAGE_TOO_LARGE` | Message exceeds per-plan size limit |
| `RATE_LIMITED` | Per-minute relay rate limit exceeded |
| `TARGET_OFFLINE` | Target instance is not currently connected |

**WebSocket close codes:**

| Code | Meaning |
|------|---------|
| `4001` | AUTH_FAILED — token invalid or missing at upgrade time |
| `4002` | RATE_LIMITED — connection-level rate limit exceeded |
| `4003` | INVALID_MESSAGE — unrecoverable message format error |
| `4004` | INTERNAL_ERROR — unexpected server error |
| `4005` | CONNECTION_LIMIT — plan connection cap reached |

---

### Ping / Pong

The server responds to WebSocket ping frames with pong at the transport level. Application-level pings are not currently defined.

---

### JavaScript Client Example

```javascript
const ws = new WebSocket(
  "wss://hub.kronus.dev/relay/connect?token=eyJ..."
);

ws.onopen = () => {
  ws.send(JSON.stringify({
    target: "inst_01jr...",
    payload: { jsonrpc: "2.0", method: "tools/list", id: 1, params: {} },
    request_id: "my-req-1"
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.error) {
    console.error("Relay error:", msg.error.code, msg.error.message);
    return;
  }

  if (msg.source) {
    // Incoming RelayResponse
    console.log("Message from", msg.source, msg.payload);
  }
};

ws.onclose = (event) => {
  console.log("Closed:", event.code, event.reason);
};
```

---

## Appendix: App Status Lifecycle

```
[submit] → review
              ↓ approve       ↓ reject
           published  ←→   draft
              ↓ health degraded
           degraded
              ↓ health offline
           offline
              ↓ admin suspend (from published or degraded)
           suspended
```

| Status | Visible in marketplace | Gateway accessible | Notes |
|--------|----------------------|-------------------|-------|
| `draft` | No | No | Developer editing, never submitted or rejected |
| `review` | No | No | Awaiting admin review |
| `published` | Yes | Yes | Live in marketplace |
| `degraded` | Yes | Returns 503 | Health check failing |
| `offline` | Yes | Returns 503 | Health check consistently failing |
| `suspended` | No | No | Admin action, not user-visible |

---

## Appendix: Plan Feature Matrix

| Feature | free | pro | enterprise |
|---------|------|-----|------------|
| Max instances | 1 | 5 | 50 |
| Relay connections | 1 | 5 | 20 |
| Relay msgs/min | 10 | 60 | 300 |
| Relay msgs/day | 100 | 5,000 | 50,000 |
| Gateway calls/min | 10 | 60 | 300 |
| Max relay message | 64 KB | 512 KB | 2 MB |
