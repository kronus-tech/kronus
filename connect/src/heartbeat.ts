import { loadIdentity } from "./identity.js";
import { getAccessToken } from "./token-manager.js";
import { listInstalledApps } from "./app-manager.js";
import { VERSION } from "./index.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function startHeartbeat(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (heartbeatInterval !== null) return;

  heartbeatInterval = setInterval(() => {
    sendHeartbeat().catch(() => {
      // Graceful degradation — Hub unreachable, will retry next interval
    });
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

export function isHeartbeatRunning(): boolean {
  return heartbeatInterval !== null;
}

async function sendHeartbeat(): Promise<void> {
  const identity = await loadIdentity();
  if (!identity) return; // Not connected — skip silently

  const token = await getAccessToken();
  const installed = await listInstalledApps();

  const response = await fetch(`${identity.hub_url}/instances/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kronus_version: VERSION,
      installed_apps: installed.map((a) => a.slug),
    }),
  });

  if (!response.ok) {
    throw new Error(`Heartbeat failed: ${response.status} ${response.statusText}`);
  }
}
