# Kronus Developer Guide — Build & Publish Marketplace Apps

## Overview

Kronus marketplace apps extend the capabilities of every Kronus install on the planet. When you publish an app, users can discover it in the marketplace, install it with a single command, and invoke it through their local Claude Code session — without you ever seeing their code or data.

**How it works at a high level:**

1. You build an MCP server and host it yourself (Railway, Fly.io, VPS, anywhere HTTPS-accessible)
2. You publish a `kronus-app.json` manifest describing your server to the Hub
3. The Hub reviews the app, then lists it in the marketplace
4. When a user installs your app, their Claude Code connects to `https://mcp.kronus.tech/apps/<your-app>` — the Hub Gateway proxies the request to your server, validates the user's subscription, and meters usage
5. You receive 70% of revenue. Stripe Connect handles payouts monthly.

**What you don't need to build:** auth, billing, rate limiting, a storefront. The Hub handles all of it.

**What you do need to build:** an MCP server that responds correctly to JSON-RPC over HTTP POST.

---

## Quick Start

### 1. Create an MCP server (Streamable HTTP transport)

Your server must expose a `POST /mcp` endpoint that speaks JSON-RPC 2.0. The minimum viable server handles three methods: `initialize`, `tools/list`, and `tools/call`.

See the full [Building an MCP Server](#building-an-mcp-server) section below for a working example.

### 2. Create a kronus-app.json manifest

Place a `kronus-app.json` file at the root of your project. This is the contract between you and the Hub — it describes your app, its tools, pricing, and where the Hub can reach your server.

See the full [Manifest Format](#manifest-format-kronus-appjson) section for the complete schema.

### 3. Test locally

```bash
# Start your server
bun run dev  # or node, deno, python, whatever your stack is

# Verify the health endpoint responds
curl http://localhost:3200/health

# Verify the MCP endpoint handles initialize
curl -X POST http://localhost:3200/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}'

# Verify tools/list returns your tools
curl -X POST http://localhost:3200/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2,"params":{}}'
```

### 4. Publish to the marketplace

```bash
# Register as a developer (one-time)
kronus connect

# Submit your app for review
kronus publish ./path/to/your-app/

# Check review status
kronus status <app-name>
```

---

## Building an MCP Server

### Streamable HTTP transport

Kronus apps use the **Streamable HTTP transport** defined in the MCP spec (protocol version `2024-11-05`). This means:

- Your server runs as a plain HTTP server
- All MCP communication happens over `POST /mcp`
- Each request is a single JSON-RPC call; each response is the corresponding JSON-RPC result
- No WebSocket or SSE required for basic apps

The Hub Gateway proxies user requests to your `mcp_url`. Your server never communicates directly with users — the Hub is always in the middle, handling auth and metering before your server sees any traffic.

### JSON-RPC protocol

Your `/mcp` endpoint must handle these methods:

**`initialize`** — Called once per session to negotiate protocol version and capabilities.

```json
// Request
{ "jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {} }

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "your-app-name", "version": "1.0.0" }
  }
}
```

**`tools/list`** — Returns all tools your server exposes.

```json
// Request
{ "jsonrpc": "2.0", "method": "tools/list", "id": 2, "params": {} }

// Response
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "scrape_url",
        "description": "Scrape and extract structured data from a URL",
        "inputSchema": {
          "type": "object",
          "properties": {
            "url": { "type": "string", "description": "The URL to scrape" }
          },
          "required": ["url"]
        }
      }
    ]
  }
}
```

**`tools/call`** — Executes a tool call.

```json
// Request
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "scrape_url",
    "arguments": { "url": "https://example.com" }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "{\"title\":\"Example Domain\",...}" }]
  }
}
```

**Standard error codes:**

| Code | Constant | When to use |
|------|----------|-------------|
| -32700 | PARSE_ERROR | Could not parse request body as JSON |
| -32601 | METHOD_NOT_FOUND | Unknown method or tool name |
| -32602 | INVALID_PARAMS | Missing or wrong-typed parameters |
| -32603 | INTERNAL_ERROR | Unexpected server-side failure |

### Example server (smart-scraper pattern)

Below is a minimal but complete MCP server using Bun. The pattern shown here matches `./demo-apps/smart-scraper/src/index.ts`.

```typescript
import type { JsonRpcRequest, JsonRpcResponse, McpToolDefinition } from "./types.js";

// 1. Define your tools with full inputSchema
const TOOLS: McpToolDefinition[] = [
  {
    name: "scrape_url",
    description: "Scrape and extract structured data from a single URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to scrape" },
      },
      required: ["url"],
    },
  },
];

// 2. Standard JSON-RPC helpers
function errorResponse(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function successResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

// 3. JSON-RPC dispatcher — handle all MCP methods
async function handleJsonRpc(body: unknown): Promise<JsonRpcResponse> {
  if (typeof body !== "object" || body === null) {
    return errorResponse(null, -32700, "Invalid JSON-RPC request");
  }

  const req = body as Partial<JsonRpcRequest>;
  const id = req.id ?? null;

  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return errorResponse(id, -32700, "Invalid JSON-RPC envelope");
  }

  if (req.method === "initialize") {
    return successResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "your-app", version: "1.0.0" },
    });
  }

  if (req.method === "tools/list") {
    return successResponse(id, { tools: TOOLS });
  }

  if (req.method === "tools/call") {
    const params = req.params as Record<string, unknown> | undefined;
    const toolName = params?.["name"];
    const toolInput = params?.["arguments"];

    if (typeof toolName !== "string") {
      return errorResponse(id, -32602, "tools/call requires params.name");
    }

    if (toolName === "scrape_url") {
      if (typeof (toolInput as Record<string, unknown>)?.["url"] !== "string") {
        return errorResponse(id, -32602, "scrape_url requires { url: string }");
      }
      // --- your tool logic here ---
      const data = { title: "Example" };
      return successResponse(id, {
        content: [{ type: "text", text: JSON.stringify(data) }],
      });
    }

    return errorResponse(id, -32601, `Unknown tool: ${toolName}`);
  }

  // Notifications are fire-and-forget; return empty ok
  if (req.method === "notifications/initialized") {
    return successResponse(id, {});
  }

  return errorResponse(id, -32601, `Method not found: ${req.method}`);
}

// 4. HTTP server — /mcp and /health are the only two routes you need
const PORT = Number(process.env["PORT"] ?? 3200);

Bun.serve({
  port: PORT,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);

    // Health endpoint — required by the Hub
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", name: "your-app", version: "1.0.0" });
    }

    // MCP endpoint
    if (url.pathname === "/mcp" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          errorResponse(null, -32700, "Could not parse request body as JSON"),
          { status: 400 }
        );
      }
      const result = await handleJsonRpc(body);
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`MCP server running on port ${PORT}`);
```

### Health endpoint requirement

Your server must expose `GET /health` returning a 200 status. The Hub health-checks every 5 minutes. After 3 consecutive failures your app is marked **degraded** (you get an email). After 10 consecutive failures it is marked **offline** and traffic stops routing to it.

Minimum acceptable response:

```json
{ "status": "ok" }
```

---

## Manifest Format (kronus-app.json)

The manifest is a JSON file that describes your app to the Hub. It lives at the root of your project directory.

### Full schema

```jsonc
{
  // --- Required fields (all types) ---

  // Unique identifier. Lowercase alphanumeric + hyphens. 1-63 chars. Immutable once registered.
  "name": "my-app",

  // Human-readable name shown in the marketplace. 1-100 chars.
  "display_name": "My App",

  // Semantic version. Must match pattern: MAJOR.MINOR.PATCH
  "version": "1.0.0",

  // Marketplace description. 20-2000 chars.
  "description": "A brief description of what your app does and why it is useful.",

  // App type. One of: developer_mcp | local_skill | local_agent | hybrid
  "type": "developer_mcp",

  // --- Required for developer_mcp type ---

  // Your MCP server's public HTTPS URL. Must use https://. Must not be a private/local address.
  "mcp_url": "https://api.your-domain.com/mcp",

  // MCP tool declarations — must be a non-empty array for developer_mcp.
  "mcp": {
    "tools": [
      {
        "name": "tool_name",
        "description": "What this tool does"
      }
    ]
  },

  // --- Required for local_skill / local_agent types ---

  // Files to distribute when a user installs the app. Paths must be relative,
  // no '..' traversal, alphanumeric+dots+slashes only.
  "files": [
    { "src": "agent/my-agent.md", "dest": ".claude/agents/my-agent.md" }
  ],

  // --- Optional fields ---

  // Minimum Kronus version required to use this app.
  "kronus_min_version": "5.3.0",

  // Author info.
  "author": {
    "name": "Your Name",
    "url": "https://your-website.com"
  },

  // Pricing configuration.
  "pricing": {
    // One of: free | one_time | subscription | usage
    "model": "subscription",

    // Required for one_time and subscription; amount in USD cents.
    "price_cents": 999,

    // For subscription: billing_period is "monthly" or "yearly".
    "billing_period": "monthly"
  },

  // Marketplace categorization.
  "categories": ["productivity", "developer-tools"],
  "tags": ["automation", "api"],

  // Health check configuration (developer_mcp).
  // If omitted, Hub defaults to GET <mcp_url_base>/health every 300s.
  "health_check": {
    "endpoint": "https://api.your-domain.com/health",
    "interval_seconds": 300
  },

  // MCP transport details (used for local development + documentation).
  // For developer_mcp, the Hub only uses mcp_url — this section is informational.
  "mcp": {
    "transport": "streamable-http",
    "endpoint": "/mcp",
    "protocol_version": "2024-11-05"
  }
}
```

### Required vs optional fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Always | Slug format. Immutable after first publish. |
| `display_name` | Always | Shown in marketplace UI. |
| `version` | Always | Semver. Bump on every new publish. |
| `description` | Always | Min 20 chars. Shown in marketplace. |
| `type` | Always | Determines which other fields are required. |
| `mcp_url` | `developer_mcp` only | HTTPS. Not private/local. |
| `mcp.tools` | `developer_mcp` only | Non-empty array. |
| `files` | `local_skill`, `local_agent` | Non-empty array with `src`+`dest`. |
| `pricing` | No | Defaults to `free` if omitted. |
| `kronus_min_version` | No | Semver. Enforced on install. |
| `health_check` | No | Hub defaults to `/health` if omitted. |
| `categories`, `tags` | No | Improves discoverability. |

### Type-specific requirements

**`developer_mcp`** — Your server is deployed publicly. The Hub proxies all traffic to it.
- `mcp_url` must be HTTPS and publicly reachable at review time.
- `mcp.tools` must list at least one tool.
- Hub runs an `initialize` compliance check during submission and on every version update.

**`local_skill`** — A Markdown skill file installed to the user's `.claude/skills/` directory.
- `files` must list at least one entry with valid `src` and `dest`.
- `src` is the path within your submitted archive; `dest` is the install path on the user's machine.

**`local_agent`** — Same as `local_skill`, installed to `.claude/agents/`.

**`hybrid`** — A combination: typically a local agent/skill file that talks back to a remote MCP server.
- Must satisfy both `files` (for local component) and `mcp_url` + `mcp.tools` (for remote component).

### Pricing configuration

| Model | `price_cents` required | `billing_period` required | Notes |
|-------|----------------------|--------------------------|-------|
| `free` | No | No | No Stripe account needed |
| `one_time` | Yes | No | User pays once, permanent access |
| `subscription` | Yes | Yes (`monthly` or `yearly`) | Recurring charge |
| `usage` | No | No | Metered; Hub tracks calls |

For `subscription` and `one_time` apps you must complete Stripe Connect onboarding before your app can go live. See [Revenue & Payouts](#revenue--payouts).

### Real manifest examples

**smart-scraper** (`demo-apps/smart-scraper/kronus-app.json`) — a free `developer_mcp` app:

```json
{
  "name": "smart-scraper",
  "display_name": "Smart Scraper",
  "version": "0.1.0",
  "description": "AI-powered web scraping MCP server that extracts structured data from any URL",
  "type": "developer_mcp",
  "author": { "name": "Kronus", "url": "https://kronus.tech" },
  "mcp_url": "http://localhost:3200/mcp",
  "pricing": { "model": "free" },
  "kronus_min_version": "5.3.0",
  "mcp": {
    "tools": [
      { "name": "scrape_url", "description": "Scrape and extract structured data from a URL" },
      { "name": "scrape_batch", "description": "Scrape multiple URLs in parallel" },
      { "name": "extract_data", "description": "Extract data matching a user-defined schema" }
    ]
  },
  "categories": ["data", "scraping"],
  "tags": ["web", "html", "extraction"],
  "health_check": { "endpoint": "http://localhost:3200/health", "interval_seconds": 300 }
}
```

**code-analyzer** (`demo-apps/code-analyzer/kronus-app.json`) — a free `developer_mcp` app with extended metadata:

```json
{
  "name": "code-analyzer",
  "display_name": "Code Analyzer",
  "version": "0.1.0",
  "description": "Analyze local codebases via MCP. Provides language breakdowns, dependency graphs, code quality pattern detection, and architecture maps for any repository on the local filesystem.",
  "author": "kronus-tech",
  "category": "developer-tools",
  "tags": ["code-analysis", "dependencies", "architecture", "local"],
  "mcp": {
    "transport": "streamable-http",
    "endpoint": "/mcp",
    "protocol_version": "2024-11-05"
  },
  "server": {
    "port": 3201,
    "health_endpoint": "/health",
    "start_command": "bun run start"
  },
  "tools": [
    { "name": "analyze_repo", "description": "Analyze a local repository directory — file counts by language, top-level structure, key file presence." },
    { "name": "dependency_graph", "description": "Parse package.json / requirements.txt / go.mod and return a structured dependency list." },
    { "name": "find_patterns", "description": "Detect code quality patterns: large files, deep nesting, missing tests." },
    { "name": "architecture_map", "description": "Generate a text-based architecture diagram of a repository." }
  ],
  "permissions": {
    "filesystem": "read",
    "network": "none"
  },
  "pricing": { "model": "free" }
}
```

---

## Publishing Flow

### 1. Register as a developer

One-time setup. This registers your local Kronus instance with the Hub and stores credentials at `~/.kronus/identity.json`.

```bash
kronus connect
```

You will be prompted to create or log in to a Kronus account. Once connected your instance has a signed JWT that identifies you for all subsequent API calls.

### 2. Submit your app

```bash
kronus publish ./my-app/
```

The CLI reads `./my-app/kronus-app.json`, validates the manifest locally, then submits it to `POST /developer/apps` on the Hub API. The Hub performs:

1. **Manifest validation** — all required fields, correct types, slug format, semver format, description length, valid pricing model.
2. **SSRF guard** — for `developer_mcp` apps, the `mcp_url` is checked against a blocklist of private/local network ranges (loopback, RFC 1918, link-local). You cannot point the Hub at an internal address.
3. **MCP compliance test** — the Hub sends a live `initialize` JSON-RPC call to your `mcp_url` with a 10-second timeout. Your server must respond with a valid `2024-11-05` protocol response. If it times out or returns a non-2xx status, submission is rejected.
4. **Slug uniqueness check** — `name` must be globally unique across all apps.

On success, the Hub creates the app record with `status: "review"` and returns:

```json
{
  "app": { "id": "app_...", "slug": "my-app", "status": "review" },
  "message": "Submitted for review"
}
```

### 3. What happens during review

The Kronus team reviews submissions manually for:

- Content appropriateness and accurate description
- No malicious or deceptive tooling
- Pricing model alignment (free apps should not require subscription logic in the MCP server)
- Basic functionality (they will invoke your tools)

Automated checks already passed at submission time (manifest validation + MCP compliance). Manual review is a lighter-weight sanity check. Typical turnaround is 1-3 business days.

You will receive an email when your app is approved or rejected. Rejected apps include a reason. You can fix the issue and resubmit.

### 4. After approval

Once approved, `status` changes to `active`. Your app appears in the marketplace immediately. Users can install it with:

```bash
kronus install my-app
```

### 5. Updating your app

To publish a new version without going through full re-review:

```bash
# Bump version in kronus-app.json first, then:
kronus publish-version ./my-app/
```

This calls `POST /developer/apps/:id/versions` with the new version number and optional new `developer_mcp_url` and `changelog`. If the MCP URL changed, the Hub runs the compliance test again. Version updates do not require manual re-review unless the app type or pricing model changes.

To update metadata (description, icon) without a version bump:

```bash
kronus update-meta ./my-app/
```

This calls `PUT /developer/apps/:id` with only `description` or `icon_url`.

---

## Revenue & Payouts

### Revenue split

- **70% to you** / **30% to Kronus** on all paid transactions
- This applies to `one_time`, `subscription`, and `usage` pricing models
- Free apps generate no revenue (and need no Stripe setup)

### Stripe Connect onboarding

For paid apps you must connect a Stripe account before your app goes live:

```bash
kronus stripe-connect
```

This opens the Stripe Connect onboarding flow. You provide your business or personal details, bank account, and tax information. Kronus uses Stripe Connect's platform model — you are a connected account, Kronus is the platform. Stripe handles compliance, tax forms, and bank transfers.

### Monthly payout cycle

Payouts run on the 1st of each month for the previous month's earnings. Stripe transfers funds directly to your connected bank account.

You can check your payout history and usage stats at any time:

```bash
kronus payouts       # payout history + totals
kronus analytics     # call counts + bytes by app
```

These call `GET /developer/payouts` and `GET /developer/analytics` respectively.

### Minimum payout threshold

Minimum payout is **$25 USD**. If your balance is below $25 at the payout date, it carries over to the next month.

---

## App Types

### `developer_mcp` — Remote MCP server

You host the server. The Hub proxies traffic from users to you. This is the standard app type for tools that require external APIs, compute, or persistent state.

- **You control:** server runtime, dependencies, data storage, uptime
- **Hub provides:** auth, rate limiting, metering, billing, marketplace listing
- **User sees:** `mcp.kronus.tech/apps/your-app` (never your origin URL)
- **Requirement:** publicly reachable HTTPS endpoint

### `local_skill` — Downloadable skill file

A Markdown skill file that Claude Code downloads and installs locally. Good for prompt-engineering workflows, custom commands, or task templates that do not need a server.

- **You provide:** one or more `.md` files in the `files` array
- **Hub provides:** distribution, versioning, marketplace listing
- **User gets:** file installed to their `.claude/skills/` directory
- **No server required**

### `local_agent` — Downloadable agent file

Same as `local_skill`, installed to `.claude/agents/`. Good for custom agents that run entirely on the user's machine using their own Claude API key and tools.

- **You provide:** one or more `.md` agent definition files
- **User gets:** file installed to their `.claude/agents/` directory
- **No server required**

### `hybrid` — Local file + remote server

Combines a local agent/skill with a remote MCP server. The local file typically defines an agent that uses the remote MCP tools. Install deploys both the file and connects the MCP endpoint.

- **Must satisfy:** both `files` requirements (for local component) and `mcp_url` + `mcp.tools` (for remote component)
- **Use case:** an agent that has a tightly coupled remote backend providing data or compute

---

## Testing Your App

### Run locally

```bash
bun run dev
# or
node dist/index.js
# or whatever your start command is
```

Verify the two required endpoints respond:

```bash
# Health check
curl http://localhost:3200/health
# Expected: { "status": "ok", ... }

# MCP initialize
curl -X POST http://localhost:3200/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}'
# Expected: { "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "2024-11-05", ... } }

# MCP tools/list
curl -X POST http://localhost:3200/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2,"params":{}}'
# Expected: { "jsonrpc": "2.0", "id": 2, "result": { "tools": [...] } }
```

### Test a tool call

```bash
curl -X POST http://localhost:3200/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 3,
    "params": {
      "name": "scrape_url",
      "arguments": { "url": "https://example.com" }
    }
  }'
# Expected: { "jsonrpc": "2.0", "id": 3, "result": { "content": [...] } }
```

### Test MCP compliance (replicating Hub's check)

The Hub runs exactly this check during submission. If your server passes this, it passes the compliance gate:

```bash
curl -X POST https://your-production-url.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}' \
  --max-time 10 \
  -w "\nHTTP %{http_code}\n"
# Must return HTTP 200 within 10 seconds
```

### Test through the Hub gateway (local Hub)

If you are running the Hub locally (from `hub/`), you can test end-to-end gateway proxying:

```bash
# Start Hub locally
cd hub && bun run dev

# Submit your local app (note: Hub will try to reach your mcp_url)
curl -X POST http://localhost:3000/developer/apps \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d @your-app/kronus-app.json
```

---

## Best Practices

### Response time

The Hub's MCP compliance check uses a **10-second timeout**. Recurring health checks also time out at 10 seconds. Keep your `/mcp` and `/health` responses under 8 seconds to give yourself margin. For long-running operations, consider returning a job ID immediately and providing a polling or callback mechanism.

### Kronus request headers

The Hub Gateway injects two headers on every proxied request:

```
X-Kronus-User: krn_usr_xyz789
X-Kronus-Plan: pro
```

- `X-Kronus-User` contains the authenticated user's Kronus user ID. Use this for per-user personalization, data isolation, or audit logging.
- `X-Kronus-Plan` contains their subscription tier (`free`, `pro`, or `enterprise`). Use this to gate features or respond with different content for higher tiers.

Neither header is sent by users directly — they are injected only by the Hub. You can trust them.

### Error responses

Always return a valid JSON-RPC error envelope, not a bare HTTP error, when something goes wrong at the tool level:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32603,
    "message": "External API returned 429 — rate limit exceeded. Retry after 60s."
  }
}
```

Reserve non-2xx HTTP status codes for catastrophic failures (server crash, malformed request body). Claude Code interprets the `error` field in the JSON-RPC envelope as a tool-level failure message to relay to the user.

### HTTPS in production

`mcp_url` must use HTTPS. Local `http://` URLs are only valid for development. Use a valid TLS certificate from Let's Encrypt or your cloud provider — self-signed certificates will fail the compliance check.

### Idempotency

Tool calls may be retried by the client or by the Hub relay on transient failures. Design your tools to be safe to call more than once with the same arguments. If a tool has side effects, use a caller-supplied `idempotency_key` parameter and deduplicate on your end.

### Secrets and credentials

Never hardcode API keys or secrets in your MCP server code. Use environment variables injected at runtime by your hosting provider. Your source code may be reviewed during the app submission process.

### Uptime

The Hub stops routing traffic after 10 consecutive health check failures (~50 minutes of downtime). Set up uptime monitoring and alerting on your infrastructure. If your app becomes unreliable, users will leave negative reviews and install rates will drop before you even know there is a problem.

---

## Summary of validation rules

The following rules are enforced by the Hub at submission time (`hub/src/routes/developer.ts`):

| Rule | Detail |
|------|--------|
| `name` | Slug format: `[a-z0-9][a-z0-9-]{0,61}[a-z0-9]`. 1-63 chars. Globally unique. |
| `display_name` | 1-100 chars. |
| `version` | Strict semver: `MAJOR.MINOR.PATCH`. |
| `description` | 20-2000 chars. |
| `type` | One of `developer_mcp`, `local_skill`, `local_agent`, `hybrid`. |
| `mcp_url` | HTTPS only. Not private/local network. Passes `initialize` compliance test. |
| `mcp.tools` | Non-empty array (required for `developer_mcp`). |
| `files` | Non-empty array for `local_skill`/`local_agent`. Each entry needs `src` + `dest`. No `..`, no absolute paths. |
| `pricing.model` | One of `free`, `one_time`, `subscription`, `usage`. |
| `icon_url` | HTTPS only. Not private/local network. Max 2048 chars. |
| Version numbers | Cannot reuse a version number that already exists for the app. |
