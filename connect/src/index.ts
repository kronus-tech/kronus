export const VERSION = "5.3.0-dev";

export {
  generateIdentityKeypair,
  saveIdentity,
  loadIdentity,
  deleteIdentity,
  getMachineFingerprint,
  getIdentityPath,
  getKronusDir,
} from "./identity.js";

export {
  getAccessToken,
  refreshAccessToken,
  onTokenRefreshed,
} from "./token-manager.js";

export { RelayClient, type ConnectionState } from "./relay-client.js";

export {
  installApp,
  uninstallApp,
  updateApps,
  listInstalledApps,
} from "./app-manager.js";

export {
  startHeartbeat,
  stopHeartbeat,
  isHeartbeatRunning,
} from "./heartbeat.js";

export async function getStatus(): Promise<Record<string, unknown>> {
  const { loadIdentity } = await import("./identity.js");
  const identity = await loadIdentity();
  if (!identity) {
    return { connected: false, version: VERSION, message: "Not connected to Kronus Hub" };
  }
  return {
    connected: true,
    version: VERSION,
    instance_id: identity.instance_id,
    hub_url: identity.hub_url,
    user_id: identity.user_id,
    registered_at: identity.registered_at,
  };
}
