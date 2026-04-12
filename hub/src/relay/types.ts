// Message sent from a client to the relay for forwarding
export interface RelayMessage {
  target: string;       // instance_id (krn_inst_xxx) or app target (app:slug)
  payload: unknown;     // MCP JSON-RPC message
  request_id?: string;  // optional correlation ID for request/response
}

// Message forwarded from relay to the target
export interface RelayResponse {
  source: string;       // sender's instance_id
  payload: unknown;     // MCP JSON-RPC message
  request_id?: string;  // echo back the correlation ID
}

// Error sent back to sender
export interface RelayError {
  error: {
    code: string;
    message: string;
  };
  request_id?: string;
}

// Custom WebSocket close codes
export const RelayCloseCode = {
  AUTH_FAILED: 4001,
  RATE_LIMITED: 4002,
  INVALID_MESSAGE: 4003,
  INTERNAL_ERROR: 4004,
  CONNECTION_LIMIT: 4005,
} as const;

export type RelayCloseCodeType = (typeof RelayCloseCode)[keyof typeof RelayCloseCode];

// Info stored per connection
export interface ConnectionInfo {
  instanceId: string;
  userId: string;
  plan: string;
  connectedAt: Date;
}

// Rate limit tiers per plan
export const RATE_LIMITS = {
  free: { callsPerMin: 10, callsPerDay: 100, maxConnections: 1 },
  pro: { callsPerMin: 60, callsPerDay: 5000, maxConnections: 5 },
  enterprise: { callsPerMin: 300, callsPerDay: 50000, maxConnections: 20 },
} as const;

export type PlanTier = keyof typeof RATE_LIMITS;

// Helper to get rate limits for a plan
export function getRateLimits(plan: string): (typeof RATE_LIMITS)[PlanTier] {
  if (plan in RATE_LIMITS) {
    return RATE_LIMITS[plan as PlanTier];
  }
  return RATE_LIMITS.free;
}
