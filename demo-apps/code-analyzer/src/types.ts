// Shared types for code-analyzer MCP server

// --- analyze_repo ---

export interface AnalysisResult {
  path: string;
  file_count: number;
  languages: Array<[string, number]>; // [extension, count] sorted by count desc
  top_level_items: string[];
  has_package_json: boolean;
  has_tsconfig: boolean;
  has_dockerfile: boolean;
  has_readme: boolean;
}

// --- dependency_graph ---

export type DependencyType = "runtime" | "dev" | "peer";

export interface Dependency {
  name: string;
  version: string;
  manager: string;
  type: DependencyType;
}

export interface DepGraph {
  managers: string[];
  dependencies: Dependency[];
}

// --- find_patterns ---

export type PatternType =
  | "large_files"
  | "deep_nesting"
  | "no_tests";

export interface PatternFinding {
  type: PatternType | string;
  file: string;
  detail: string;
}

export interface PatternResult {
  path: string;
  patterns_checked: string[];
  findings: PatternFinding[];
}

// --- JSON-RPC ---

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

// --- MCP protocol types ---

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolsListResult {
  tools: McpTool[];
}

export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpContent {
  type: "text";
  text: string;
}

export interface McpToolCallResult {
  content: McpContent[];
  isError?: boolean;
}
