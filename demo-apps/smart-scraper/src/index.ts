import { scrapeUrl } from "./tools/scrape-url.js";
import { scrapeBatch } from "./tools/scrape-batch.js";
import { extractData } from "./tools/extract-data.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolDefinition,
  ScrapeUrlParams,
  ScrapeBatchParams,
  ExtractDataParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS: McpToolDefinition[] = [
  {
    name: "scrape_url",
    description:
      "Scrape and extract structured data from a single URL. Returns title, description, headings, links, and text content.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to scrape",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "scrape_batch",
    description:
      "Scrape multiple URLs in parallel (up to 10). Returns per-URL results including successes and failures.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "List of URLs to scrape (max 10)",
          maxItems: 10,
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "extract_data",
    description:
      "Extract data from a URL matching a user-defined schema. Map output keys to built-in selectors: title, description, text, headings, links, url, status, content_type.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to extract data from",
        },
        schema: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Map of output field name to selector (e.g. { "page_title": "title", "summary": "description" })',
        },
      },
      required: ["url", "schema"],
    },
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC error codes (MCP-standard)
// ---------------------------------------------------------------------------

const RPC_PARSE_ERROR = -32700;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function successResponse(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

// ---------------------------------------------------------------------------
// Tool call params validation helpers
// ---------------------------------------------------------------------------

function isScrapeUrlParams(v: unknown): v is ScrapeUrlParams {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>)["url"] === "string"
  );
}

function isScrapeBatchParams(v: unknown): v is ScrapeBatchParams {
  if (typeof v !== "object" || v === null) return false;
  const urls = (v as Record<string, unknown>)["urls"];
  return Array.isArray(urls) && urls.every((u) => typeof u === "string");
}

function isExtractDataParams(v: unknown): v is ExtractDataParams {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  if (typeof rec["url"] !== "string") return false;
  if (typeof rec["schema"] !== "object" || rec["schema"] === null) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main JSON-RPC dispatcher
// ---------------------------------------------------------------------------

async function handleJsonRpc(body: unknown): Promise<JsonRpcResponse> {
  // Basic structural validation
  if (typeof body !== "object" || body === null) {
    return errorResponse(null, RPC_PARSE_ERROR, "Invalid JSON-RPC request");
  }

  const req = body as Partial<JsonRpcRequest>;
  const id = req.id ?? null;

  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return errorResponse(id, RPC_PARSE_ERROR, "Invalid JSON-RPC envelope");
  }

  const method = req.method;

  try {
    // -----------------------------------------------------------------------
    // MCP lifecycle methods
    // -----------------------------------------------------------------------

    if (method === "initialize") {
      return successResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "smart-scraper", version: "0.1.0" },
      });
    }

    if (method === "tools/list") {
      return successResponse(id, { tools: TOOLS });
    }

    // -----------------------------------------------------------------------
    // Tool calls
    // -----------------------------------------------------------------------

    if (method === "tools/call") {
      const params = req.params as Record<string, unknown> | undefined;
      const toolName = params?.["name"];
      const toolInput = params?.["arguments"];

      if (typeof toolName !== "string") {
        return errorResponse(id, RPC_INVALID_PARAMS, "tools/call requires params.name");
      }

      if (toolName === "scrape_url") {
        if (!isScrapeUrlParams(toolInput)) {
          return errorResponse(id, RPC_INVALID_PARAMS, "scrape_url requires { url: string }");
        }
        const data = await scrapeUrl(toolInput.url);
        return successResponse(id, {
          content: [{ type: "text", text: JSON.stringify(data) }],
        });
      }

      if (toolName === "scrape_batch") {
        if (!isScrapeBatchParams(toolInput)) {
          return errorResponse(id, RPC_INVALID_PARAMS, "scrape_batch requires { urls: string[] }");
        }
        const data = await scrapeBatch(toolInput.urls);
        return successResponse(id, {
          content: [{ type: "text", text: JSON.stringify(data) }],
        });
      }

      if (toolName === "extract_data") {
        if (!isExtractDataParams(toolInput)) {
          return errorResponse(
            id,
            RPC_INVALID_PARAMS,
            "extract_data requires { url: string, schema: Record<string, string> }"
          );
        }
        const data = await extractData(
          toolInput.url,
          toolInput.schema as Record<string, string>
        );
        return successResponse(id, {
          content: [{ type: "text", text: JSON.stringify(data) }],
        });
      }

      return errorResponse(id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${toolName}`);
    }

    // -----------------------------------------------------------------------
    // Notifications (fire-and-forget, no response needed but return empty ok)
    // -----------------------------------------------------------------------

    if (method === "notifications/initialized") {
      return successResponse(id, {});
    }

    return errorResponse(id, RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(id, RPC_INTERNAL_ERROR, message);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const PORT = Number(process.env["PORT"] ?? 3200);

const server = Bun.serve({
  port: PORT,

  async fetch(req): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        name: "smart-scraper",
        version: "0.1.0",
      });
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          errorResponse(null, RPC_PARSE_ERROR, "Could not parse request body as JSON"),
          { status: 400 }
        );
      }

      const result = await handleJsonRpc(body);
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`smart-scraper MCP server running on port ${server.port}`);
