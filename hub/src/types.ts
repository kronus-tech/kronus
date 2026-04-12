declare const __kronusId: unique symbol;

export type KronusId = string & { readonly [__kronusId]: true };

export type Plan = "free" | "pro" | "enterprise";

export type AppType =
  | "developer_mcp"
  | "local_skill"
  | "local_agent"
  | "hybrid";
