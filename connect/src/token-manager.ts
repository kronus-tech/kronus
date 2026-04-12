import { decodeJwt } from "jose";
import { loadIdentity, saveIdentity } from "./identity.js";
import type { Identity } from "./types.js";

export type TokenRefreshedCallback = (newAccessToken: string) => void;

let _onTokenRefreshed: TokenRefreshedCallback | null = null;

export function onTokenRefreshed(callback: TokenRefreshedCallback): void {
  _onTokenRefreshed = callback;
}

/**
 * Returns a valid access token, auto-refreshing if less than 5 minutes remain.
 * Throws if no identity is stored (user has not run 'kronus connect').
 */
export async function getAccessToken(): Promise<string> {
  const identity = await loadIdentity();
  if (!identity) {
    throw new Error("Not connected — run 'kronus connect' first");
  }

  try {
    const claims = decodeJwt(identity.access_token);
    const exp = claims.exp;
    if (exp !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      const timeRemaining = exp - now;
      if (timeRemaining > 300) {
        return identity.access_token;
      }
    }
  } catch {
    // Token is corrupt or unparseable — fall through to refresh
  }

  return refreshAccessToken(identity);
}

/**
 * Exchanges the stored refresh token for a new access token,
 * persists the updated identity, and notifies any registered listener.
 */
export async function refreshAccessToken(identity: Identity): Promise<string> {
  const response = await fetch(`${identity.hub_url}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: identity.refresh_token }),
  });

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { access_token: string };

  const updatedIdentity: Identity = {
    ...identity,
    access_token: data.access_token,
  };
  await saveIdentity(updatedIdentity);

  if (_onTokenRefreshed) {
    _onTokenRefreshed(data.access_token);
  }

  return data.access_token;
}
