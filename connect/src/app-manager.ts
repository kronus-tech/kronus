import { join, dirname } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { loadIdentity, getKronusDir } from "./identity.js";
import { getAccessToken } from "./token-manager.js";
import type { InstalledApp } from "./types.js";

function getInstalledAppsFile(): string {
  return join(getKronusDir(), "installed-apps.json");
}

// Read the installed apps registry
export async function listInstalledApps(): Promise<InstalledApp[]> {
  try {
    const data = await readFile(getInstalledAppsFile(), "utf-8");
    return JSON.parse(data) as InstalledApp[];
  } catch {
    return [];
  }
}

// Save registry
async function saveInstalledApps(apps: InstalledApp[]): Promise<void> {
  await mkdir(getKronusDir(), { recursive: true });
  await writeFile(getInstalledAppsFile(), JSON.stringify(apps, null, 2));
}

interface HubInstallResponse {
  install_type: string;
  gateway_url?: string;
  access_token?: string;
  download_url?: string;
  app: {
    slug: string;
    name: string;
    type: string;
  };
}

interface HubErrorResponse {
  error?: {
    message?: string;
  };
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body
  ) {
    const err = (body as HubErrorResponse).error;
    if (typeof err?.message === "string") return err.message;
  }
  return fallback;
}

// Install an app from the marketplace
export async function installApp(slug: string): Promise<InstalledApp> {
  const identity = await loadIdentity();
  if (!identity) throw new Error("Not connected — run 'kronus connect' first");

  const token = await getAccessToken();

  const response = await fetch(`${identity.hub_url}/apps/${slug}/install`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const msg = extractErrorMessage(body, response.statusText);
    throw new Error(`Install failed: ${msg}`);
  }

  const data = (await response.json()) as HubInstallResponse;

  const installed: InstalledApp = {
    slug: data.app.slug,
    name: data.app.name,
    type: data.app.type as InstalledApp["type"],
    version: "latest",
    installed_at: new Date().toISOString(),
    gateway_url: data.gateway_url,
  };

  // For developer_mcp apps: register the gateway endpoint in .claude/mcp.json
  if (
    data.install_type === "gateway" &&
    data.gateway_url !== undefined &&
    data.access_token !== undefined
  ) {
    await addToMcpJson(slug, data.gateway_url, data.access_token);
  }

  // Save to registry, replacing any existing entry for this slug
  const apps = await listInstalledApps();
  const filtered = apps.filter((a) => a.slug !== slug);
  filtered.push(installed);
  await saveInstalledApps(filtered);

  return installed;
}

// Uninstall an app
export async function uninstallApp(slug: string): Promise<void> {
  await removeFromMcpJson(slug);

  const apps = await listInstalledApps();
  const filtered = apps.filter((a) => a.slug !== slug);
  await saveInstalledApps(filtered);
}

// Update all installed apps (reinstall each to pull latest version)
export async function updateApps(): Promise<string[]> {
  const identity = await loadIdentity();
  if (!identity) throw new Error("Not connected — run 'kronus connect' first");

  const installed = await listInstalledApps();
  const updated: string[] = [];

  for (const app of installed) {
    try {
      await installApp(app.slug);
      updated.push(app.slug);
    } catch {
      // Graceful degradation — skip failed updates and continue
    }
  }

  return updated;
}

// --- mcp.json helpers ---

interface McpServerEntry {
  type: string;
  url: string;
  headers: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

async function getMcpJsonPath(): Promise<string> {
  // KRONUS_MCP_JSON_PATH override for safe testing without touching ~/.claude/mcp.json
  if (process.env["KRONUS_MCP_JSON_PATH"]) {
    return process.env["KRONUS_MCP_JSON_PATH"];
  }
  const { homedir } = await import("os");
  return join(homedir(), ".claude", "mcp.json");
}

async function readMcpJson(): Promise<McpConfig> {
  const path = await getMcpJsonPath();
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as McpConfig;
  } catch {
    return { mcpServers: {} };
  }
}

async function writeMcpJson(config: McpConfig): Promise<void> {
  const path = await getMcpJsonPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2));
}

async function addToMcpJson(
  slug: string,
  gatewayUrl: string,
  token: string
): Promise<void> {
  const config = await readMcpJson();
  const servers: Record<string, McpServerEntry> = config.mcpServers ?? {};

  servers[`kronus:${slug}`] = {
    type: "http",
    url: gatewayUrl,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  config.mcpServers = servers;
  await writeMcpJson(config);
}

async function removeFromMcpJson(slug: string): Promise<void> {
  const config = await readMcpJson();
  const servers: Record<string, McpServerEntry> = config.mcpServers ?? {};

  delete servers[`kronus:${slug}`];
  config.mcpServers = servers;
  await writeMcpJson(config);
}
