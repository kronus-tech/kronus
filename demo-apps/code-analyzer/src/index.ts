import { safeAnalyzeRepo } from "./tools/analyze-repo.js";
import { safeDependencyGraph } from "./tools/dependency-graph.js";
import { safeFindPatterns } from "./tools/find-patterns.js";
import { safeArchitectureMap } from "./tools/architecture-map.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpTool,
  McpToolsListResult,
  McpToolCallParams,
  McpToolCallResult,
} from "./types.js";

const NAME = "code-analyzer";
const VERSION = "0.1.0";
const PORT = Number(process.env["PORT"] ?? 3201);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: McpTool[] = [
  {
    name: "analyze_repo",
    description:
      "Analyze a local repository directory. Returns file counts by language/extension, top-level structure, and key file presence (package.json, tsconfig, Dockerfile, README).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the repository root directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "dependency_graph",
    description:
      "Parse dependency files in a repository (package.json, requirements.txt, go.mod) and return a structured list of all dependencies with their versions, package manager, and type (runtime/dev/peer).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the repository root directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "find_patterns",
    description:
      "Scan a repository for code quality patterns. Supported pattern types: 'large_files' (files over 100KB), 'deep_nesting' (paths deeper than 6 levels), 'no_tests' (no test or spec files found). Defaults to checking all patterns.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the repository root directory.",
        },
        pattern_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["large_files", "deep_nesting", "no_tests"],
          },
          description:
            "Which pattern types to check. Omit to run all patterns.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "architecture_map",
    description:
      "Generate a text-based architecture diagram of a repository. Shows the top-level directory structure with one level of sub-entries, skipping build artifacts and dependency directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the repository root directory.",
        },
      },
      required: ["path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function callTool(
  params: McpToolCallParams
): Promise<McpToolCallResult> {
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const path = args["path"];

  switch (params.name) {
    case "analyze_repo": {
      const result = await safeAnalyzeRepo(path);
      if ("error" in result) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "dependency_graph": {
      const result = await safeDependencyGraph(path);
      if ("error" in result) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "find_patterns": {
      const patternTypes = args["pattern_types"];
      const result = await safeFindPatterns(path, patternTypes);
      if ("error" in result) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "architecture_map": {
      const result = await safeArchitectureMap(path);
      if (typeof result === "object" && "error" in result) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: result as string }],
      };
    }

    default:
      return {
        content: [
          { type: "text", text: `Error: unknown tool '${params.name}'` },
        ],
        isError: true,
      };
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC handler
// ---------------------------------------------------------------------------

async function handleJsonRpc(
  body: unknown
): Promise<JsonRpcResponse<unknown>> {
  const req = body as JsonRpcRequest;
  const id = req?.id ?? null;

  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid Request" },
    };
  }

  try {
    switch (req.method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: NAME, version: VERSION },
          },
        };
      }

      case "tools/list": {
        const result: McpToolsListResult = { tools: TOOLS };
        return { jsonrpc: "2.0", id, result };
      }

      case "tools/call": {
        const params = req.params as McpToolCallParams;
        if (!params?.name) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params: missing tool name" },
          };
        }
        const result = await callTool(params);
        return { jsonrpc: "2.0", id, result };
      }

      case "notifications/initialized":
      case "ping": {
        return { jsonrpc: "2.0", id, result: {} };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message },
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", name: NAME, version: VERSION });
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error: invalid JSON" },
          },
          { status: 400 }
        );
      }

      const response = await handleJsonRpc(body);
      return Response.json(response);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(
  `[${NAME}] v${VERSION} listening on http://localhost:${server.port}`
);
