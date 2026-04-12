// SECURITY: private_key, access_token, refresh_token are sensitive.
// Phase 1 implementation MUST encrypt private_key at rest and
// ensure tokens are never logged or serialized to unprotected storage.
export interface Identity {
  instance_id: string;
  hub_url: string;
  public_key: string;
  private_key: string;
  access_token: string;
  refresh_token: string;
  registered_at: string;
  user_id: string;
}

export interface InstalledApp {
  slug: string;
  name: string;
  type: "developer_mcp" | "local_skill" | "local_agent";
  version: string;
  installed_at: string;
  gateway_url?: string;
}

export interface ConnectConfig {
  hub_url: string;
  relay_url: string;
  identity_path: string;
  installed_apps_path: string;
}
