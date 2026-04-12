// ---------------------------------------------------------------------------
// Scrape result types
// ---------------------------------------------------------------------------

export interface ScrapeLink {
  text: string;
  href: string;
}

export interface ScrapeMeta {
  content_type: string | null;
  status: number;
}

export interface ScrapeResult {
  url: string;
  title: string;
  description: string | null;
  headings: string[];
  links: ScrapeLink[];
  text_content: string;
  meta: ScrapeMeta;
}

export interface BatchResultItem {
  url: string;
  status: "fulfilled" | "rejected";
  data: ScrapeResult | null;
  error: string | null;
}

export interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  results: BatchResultItem[];
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// MCP tool definition
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Tool call params
// ---------------------------------------------------------------------------

export interface ScrapeUrlParams {
  url: string;
}

export interface ScrapeBatchParams {
  urls: string[];
}

export interface ExtractDataParams {
  url: string;
  schema: Record<string, string>;
}
