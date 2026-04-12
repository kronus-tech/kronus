import type { ServerWebSocket } from "bun";
import type { ConnectionInfo } from "./types.js";
import { getRateLimits } from "./types.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("relay:connections");

interface Connection {
  ws: ServerWebSocket<ConnectionInfo>;
  info: ConnectionInfo;
}

const connections = new Map<string, Connection>();

export function registerConnection(
  instanceId: string,
  ws: ServerWebSocket<ConnectionInfo>,
  info: ConnectionInfo
): boolean {
  // If this instance already has a connection, close and replace it
  const existing = connections.get(instanceId);
  if (existing) {
    logger.info("Replacing existing connection", { instanceId });
    existing.ws.close(1000, "Replaced by new connection");
    connections.delete(instanceId);
  }

  // Check concurrent connection limit (after removing the replaced one)
  const limits = getRateLimits(info.plan);
  const userConnections = getConnectionsByUserId(info.userId);

  if (userConnections.length >= limits.maxConnections) {
    logger.warn("Connection limit reached", {
      userId: info.userId,
      plan: info.plan,
      current: userConnections.length,
      max: limits.maxConnections,
    });
    return false;
  }

  connections.set(instanceId, { ws, info });
  logger.info("Connection registered", { instanceId, userId: info.userId });
  return true;
}

export function unregisterConnection(instanceId: string): void {
  const existed = connections.delete(instanceId);
  if (existed) {
    logger.info("Connection unregistered", { instanceId });
  }
}

export function getConnection(instanceId: string): Connection | undefined {
  return connections.get(instanceId);
}

export function getConnectionCount(): number {
  return connections.size;
}

export function getConnectionsByUserId(userId: string): Connection[] {
  const result: Connection[] = [];
  for (const conn of connections.values()) {
    if (conn.info.userId === userId) {
      result.push(conn);
    }
  }
  return result;
}

// For testing — clears all connections without sending close frames
export function clearConnections(): void {
  connections.clear();
}
