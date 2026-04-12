// brain-mcp Phase 2 — MCP Server with stdio transport
// brain-mcp Phase 3 — HTTP server for UI (Bun.serve, same process)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

import { getDb, closeDb } from "./db.js";
import { loadConfig } from "./config.js";
import { Indexer } from "./indexer.js";
import { BrainWatcher } from "./watcher.js";

import { brainSearch, type SearchParams } from "./tools/search.js";
import { brainGraph, type GraphParams } from "./tools/graph.js";
import { brainBacklinks, type BacklinksParams } from "./tools/backlinks.js";
import { brainOutlinks, type OutlinksParams } from "./tools/outlinks.js";
import { brainTags, type TagsParams } from "./tools/tags.js";
import { brainRecent, type RecentParams } from "./tools/recent.js";
import { brainCreate, type CreateParams } from "./tools/create.js";
import { brainUpdate, type UpdateParams } from "./tools/update.js";
import { brainOrphans, type OrphansParams } from "./tools/orphans.js";
import { brainClusters, type ClustersParams } from "./tools/clusters.js";
import { brainMap, type MapParams } from "./tools/map.js";
import { brainPath, type PathParams } from "./tools/path.js";
import { brainSuggest, type SuggestParams } from "./tools/suggest.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const config = loadConfig();
const db = getDb();
const indexer = new Indexer(db, config.brainRoots);

// Initial scan — log to stderr so it doesn't pollute MCP JSON-RPC on stdout
const scanResult = indexer.initialScan();
console.error(
  `[brain] Initial scan: ${scanResult.indexed} indexed, ${scanResult.skipped} unchanged, ${scanResult.removed} removed`
);

// Start file watcher for incremental updates
const watcher = new BrainWatcher();
watcher.start(config.brainRoots, indexer);

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "brain-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "brain_search",
      description:
        "Search your notes and memories. Finds relevant content across everything you've saved. Leave query empty to see recent notes.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          filters: {
            type: "object",
            properties: {
              para_type: {
                type: "string",
                enum: ["project", "area", "resource", "archive", "inbox"],
                description: "Filter by category: project (active work), area (ongoing topics), resource (reference material), archive (completed)",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Only show notes with ALL of these tags",
              },
              status: {
                type: "string",
                description: "Filter by status (active, done, someday, etc.)",
              },
              source: {
                type: "string",
                enum: ["personal", "project"],
                description: "Filter by where it came from: 'personal' (your notes) or 'project' (memories from AI conversations)",
              },
            },
          },
          limit: {
            type: "number",
            description: "How many results to show (default 10, max 50)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "brain_graph",
      description:
        "See how a note connects to other notes — what it links to, what links to it, and related topics.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the note (e.g. Projects/my-note.md)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "brain_backlinks",
      description: "Find all notes that reference a specific note — see where it's mentioned.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the note" },
        },
        required: ["path"],
      },
    },
    {
      name: "brain_outlinks",
      description:
        "See what a note references — all the other notes and topics it connects to.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the note" },
        },
        required: ["path"],
      },
    },
    {
      name: "brain_tags",
      description:
        "Browse notes by tag. Without a specific tag, shows all tags and how many notes use each one.",
      inputSchema: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Tag to browse (leave empty to see all tags)" },
          limit: { type: "number", description: "How many results (default 100)" },
        },
      },
    },
    {
      name: "brain_recent",
      description: "See recently changed notes. Filter by time period, category, or source.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Only show notes changed in the last N days",
          },
          para_type: {
            type: "string",
            enum: ["project", "area", "resource", "archive", "inbox"],
            description: "Filter by category",
          },
          source: {
            type: "string",
            enum: ["personal", "project"],
            description: "Filter: 'personal' (your notes) or 'project' (AI conversation memories)",
          },
          limit: { type: "number", description: "How many results (default 20, max 100)" },
        },
      },
    },
    {
      name: "brain_create",
      description:
        "Create a new note. Saves it to your knowledge base and makes it searchable immediately.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Where to save it (e.g. Projects/new-idea.md or Cases/smith-v-jones.md)",
          },
          title: { type: "string", description: "Title of the note" },
          content: {
            type: "string",
            description: "The note content in markdown",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for organizing (e.g. ['urgent', 'client-a'])",
          },
          para_type: {
            type: "string",
            enum: ["project", "area", "resource", "archive", "inbox"],
            description: "Category (usually auto-detected from the folder)",
          },
          status: { type: "string", description: "Status (e.g. active, draft, done)" },
        },
        required: ["path", "title"],
      },
    },
    {
      name: "brain_update",
      description:
        "Edit an existing note — change its title, content, tags, or status. Preserves anything you don't change.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the note to edit" },
          title: { type: "string", description: "New title" },
          content: {
            type: "string",
            description: "Replace the entire content",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replace tags",
          },
          status: { type: "string", description: "Update status" },
          append: {
            type: "string",
            description: "Add text to the end (instead of replacing everything)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "brain_orphans",
      description:
        "Find notes that aren't connected to anything else — isolated ideas that might need linking.",
      inputSchema: {
        type: "object",
        properties: {
          para_type: {
            type: "string",
            enum: ["project", "area", "resource", "archive", "inbox"],
            description: "Filter by category",
          },
          source: {
            type: "string",
            enum: ["personal", "project"],
            description: "Filter: 'personal' or 'project'",
          },
          limit: { type: "number", description: "How many results (default 50, max 200)" },
        },
      },
    },
    {
      name: "brain_clusters",
      description:
        "Find groups of related notes that are connected to each other. Shows the biggest clusters first.",
      inputSchema: {
        type: "object",
        properties: {
          min_size: {
            type: "number",
            description: "Minimum group size to show (default 2)",
          },
          limit: {
            type: "number",
            description: "How many groups to show (default 20, max 100)",
          },
        },
      },
    },
    {
      name: "brain_map",
      description:
        "See an overview of everything in your knowledge base — how many notes, how they're organized, top topics, and overall health.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "brain_path",
      description:
        "Find how two notes are connected — trace the path of links between them.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Starting note path",
          },
          target: {
            type: "string",
            description: "Destination note path",
          },
        },
        required: ["source", "target"],
      },
    },
    {
      name: "brain_suggest",
      description:
        "Find notes related to a specific note — based on shared topics, links, and references.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the note you want suggestions for" },
          limit: { type: "number", description: "How many suggestions (default 10, max 50)" },
        },
        required: ["path"],
      },
    },
  ],
}));

// ─── Tool Dispatch ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "brain_search":
        result = brainSearch(db, args as SearchParams);
        break;

      case "brain_graph":
        result = brainGraph(db, args as GraphParams);
        break;

      case "brain_backlinks":
        result = brainBacklinks(db, args as BacklinksParams);
        break;

      case "brain_outlinks":
        result = brainOutlinks(db, args as OutlinksParams);
        break;

      case "brain_tags":
        result = brainTags(db, args as TagsParams);
        break;

      case "brain_recent":
        result = brainRecent(db, args as RecentParams);
        break;

      case "brain_create":
        result = brainCreate(db, args as CreateParams, config.brainRoot);
        break;

      case "brain_update":
        result = brainUpdate(db, args as UpdateParams, config.brainRoot);
        break;

      case "brain_orphans":
        result = brainOrphans(db, args as OrphansParams);
        break;

      case "brain_clusters":
        result = brainClusters(db, args as ClustersParams);
        break;

      case "brain_map":
        result = brainMap(db, args as MapParams);
        break;

      case "brain_path":
        result = brainPath(db, args as PathParams);
        break;

      case "brain_suggest":
        result = brainSuggest(db, args as SuggestParams);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// ─── Start stdio transport ────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[brain] MCP server ready on stdio");

// ─── HTTP server for UI (runs alongside MCP stdio) ────────────────────────────

// Resolve the ui/ directory relative to this source file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uiDir = join(__dirname, "..", "ui");

// Allow brain UI (:4242) and daemon dashboard (:8420) origins
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${config.uiPort}`,
  "http://localhost:8420",
]);

const uiServer = Bun.serve({
  port: config.uiPort,
  hostname: "127.0.0.1",

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // CORS: allow brain UI + daemon dashboard origins
    const origin = req.headers.get("origin");
    const corsOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : `http://localhost:${config.uiPort}`;
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    // Reject unknown cross-origin requests
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── REST API ──────────────────────────────────────────────────────────────

    if (url.pathname === "/api/graph") {
      const nodes = db
        .query(
          "SELECT id, path, title, para_type, tags, word_count, modified_at, status, source_root FROM nodes"
        )
        .all();
      const edges = db
        .query("SELECT source_id, target_id, edge_type FROM edges")
        .all();
      return Response.json({ nodes, edges }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/node") {
      const path = url.searchParams.get("path");
      if (!path) {
        return Response.json(
          { error: "path required" },
          { status: 400, headers: corsHeaders }
        );
      }
      try {
        const result = brainGraph(db, { path });
        return Response.json(result, { headers: corsHeaders });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 404, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      const result = brainSearch(db, { query: q });
      return Response.json(result, { headers: corsHeaders });
    }

    if (url.pathname === "/api/map") {
      const result = brainMap(db, {});
      return Response.json(result, { headers: corsHeaders });
    }

    if (url.pathname === "/api/tags") {
      const result = brainTags(db, {});
      return Response.json(result, { headers: corsHeaders });
    }

    if (url.pathname === "/api/path") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      if (!from || !to) {
        return Response.json(
          { error: "from and to are required" },
          { status: 400, headers: corsHeaders }
        );
      }
      try {
        const result = brainPath(db, { source: from, target: to } as PathParams);
        return Response.json(result, { headers: corsHeaders });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 404, headers: corsHeaders }
        );
      }
    }

    if (url.pathname === "/api/open") {
      const path = url.searchParams.get("path");
      if (!path) {
        return Response.json(
          { error: "path required" },
          { status: 400, headers: corsHeaders }
        );
      }
      // BRAIN-010: Validate path against ALL configured roots (not just personal)
      let validRoot: string | null = null;
      for (const root of config.brainRoots) {
        const resolvedRoot = resolve(root.path);
        const abs = resolve(resolvedRoot, path);
        if (abs.startsWith(resolvedRoot + "/")) {
          validRoot = resolvedRoot;
          break;
        }
      }
      if (!validRoot) {
        return Response.json(
          { error: "invalid path" },
          { status: 400, headers: corsHeaders }
        );
      }
      const abs = resolve(validRoot, path);
      Bun.spawn(["open", abs]);
      return Response.json({ opened: path }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/content") {
      const notePath = url.searchParams.get("path");
      if (!notePath) {
        return Response.json(
          { error: "path required" },
          { status: 400, headers: corsHeaders }
        );
      }
      // Look up the node to find its source_root
      interface ContentRow { source_root: string; content: string }
      const row = db
        .query<ContentRow, [string]>(
          "SELECT source_root, content FROM nodes WHERE path = ?"
        )
        .get(notePath);
      if (!row) {
        return Response.json(
          { error: "note not found" },
          { status: 404, headers: corsHeaders }
        );
      }
      // Try to read the raw file for full content (DB content may be stripped)
      const root = config.brainRoots.find(r => r.label === row.source_root);
      let rawContent = row.content;
      if (root) {
        const abs = resolve(root.path, notePath);
        if (abs.startsWith(resolve(root.path) + "/")) {
          try {
            const file = Bun.file(abs);
            if (await file.exists()) {
              rawContent = await file.text();
            }
          } catch { /* fall back to DB content */ }
        }
      }
      return Response.json({ path: notePath, content: rawContent }, { headers: corsHeaders });
    }

    // ── Static files ──────────────────────────────────────────────────────────

    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(uiDir, filePath));

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.error(`[brain] UI at http://localhost:${uiServer.port}`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = (): void => {
  console.error("[brain] Shutting down...");
  watcher.stop();
  closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
