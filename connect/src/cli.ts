#!/usr/bin/env bun

import { Command } from "commander";
import { join } from "path";
import { readFile } from "fs/promises";
import {
  generateIdentityKeypair,
  getMachineFingerprint,
  saveIdentity,
  loadIdentity,
  deleteIdentity,
  getIdentityPath,
} from "./identity.js";
import { getAccessToken } from "./token-manager.js";
import {
  installApp,
  uninstallApp,
  updateApps,
  listInstalledApps,
} from "./app-manager.js";
import type { Identity } from "./types.js";

const VERSION = "5.3.0-dev";

const program = new Command();

program
  .name("kronus")
  .description("Kronus Connect — connect your Kronus instance to the marketplace")
  .version(VERSION);

// kronus connect
program
  .command("connect")
  .description("Register this instance with Kronus Hub")
  .action(async () => {
    const { createInterface } = await import("readline");

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    try {
      const hubUrl = (await question("Hub URL (default: http://localhost:3100): ")).trim() || "http://localhost:3100";
      const email = (await question("Email: ")).trim();
      const password = (await question("Password (input will be visible): ")).trim();

      // Step 1: Authenticate with Hub
      let loginData: { access_token: string; refresh_token: string; user: { id: string } };
      try {
        const loginRes = await fetch(`${hubUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        if (!loginRes.ok) {
          const errText = await loginRes.text();
          console.error(`Login failed: ${errText}`);
          rl.close();
          process.exit(1);
        }

        loginData = await loginRes.json() as { access_token: string; refresh_token: string; user: { id: string } };
      } catch (err) {
        console.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
        rl.close();
        process.exit(1);
      }

      const { access_token, refresh_token, user } = loginData;

      // Step 2: Generate local Ed25519 keypair
      const keys = await generateIdentityKeypair();
      const machine_fingerprint = getMachineFingerprint();

      // Step 3: Register instance with Hub
      let registerData: { instance: { id: string; registered_at: string }; access_token: string };
      try {
        const registerRes = await fetch(`${hubUrl}/instances/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`,
          },
          body: JSON.stringify({
            public_key: keys.publicKey,
            machine_fingerprint,
            kronus_version: VERSION,
            os: process.platform,
          }),
        });

        if (!registerRes.ok) {
          const errText = await registerRes.text();
          console.error(`Instance registration failed: ${errText}`);
          rl.close();
          process.exit(1);
        }

        registerData = await registerRes.json() as { instance: { id: string; created_at?: string }; access_token: string };
      } catch (err) {
        console.error(`Instance registration failed: ${err instanceof Error ? err.message : String(err)}`);
        rl.close();
        process.exit(1);
      }

      const { instance, access_token: newAccessToken } = registerData;

      // Step 4: Persist identity
      const identity: Identity = {
        instance_id: instance.id,
        hub_url: hubUrl,
        public_key: keys.publicKey,
        private_key: keys.privateKey,
        access_token: newAccessToken,
        refresh_token,
        registered_at: instance.created_at ?? new Date().toISOString(),
        user_id: user.id,
      };

      await saveIdentity(identity);
      console.log(`Connected! Instance ID: ${instance.id}`);
    } finally {
      rl.close();
    }
  });

// kronus disconnect
program
  .command("disconnect")
  .description("Remove instance registration")
  .action(async () => {
    const identity = await loadIdentity();

    if (!identity) {
      console.log("Not connected");
      process.exit(0);
    }

    try {
      const res = await fetch(`${identity.hub_url}/instances/${identity.instance_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${identity.access_token}` },
      });

      if (!res.ok) {
        console.warn(`Warning: could not deregister instance on Hub (status ${res.status}) — continuing with local cleanup`);
      }
    } catch (err) {
      console.warn(`Warning: could not reach Hub — continuing with local cleanup (${err instanceof Error ? err.message : String(err)})`);
    }

    await deleteIdentity();
    console.log("Disconnected from Kronus Hub");
  });

// kronus status
program
  .command("status")
  .description("Show connection status")
  .action(async () => {
    const identity = await loadIdentity();

    if (!identity) {
      console.log("Not connected to Kronus Hub");
      process.exit(0);
    }

    console.log(`Instance ID:     ${identity.instance_id}`);
    console.log(`Hub URL:         ${identity.hub_url}`);
    console.log(`User ID:         ${identity.user_id}`);
    console.log(`Connected since: ${identity.registered_at}`);
    console.log(`Identity file:   ${getIdentityPath()}`);
  });

interface MarketplaceApp {
  slug: string;
  name: string;
  type: string;
  pricing_model: string;
}

interface AppsListResponse {
  apps: MarketplaceApp[];
}

// kronus apps (base — list available marketplace apps)
const appsCommand = program
  .command("apps")
  .description("List available marketplace apps")
  .action(async () => {
    const identity = await loadIdentity();
    if (!identity) {
      console.error("Not connected — run 'kronus connect' first");
      process.exit(1);
    }

    let token: string;
    try {
      token = await getAccessToken();
    } catch (err) {
      console.error(`Authentication error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const res = await fetch(`${identity.hub_url}/apps`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`Failed to fetch apps: ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const data = (await res.json()) as AppsListResponse;

    if (data.apps.length === 0) {
      console.log("No apps available in the marketplace.");
      return;
    }

    console.log(`${"SLUG".padEnd(25)} ${"TYPE".padEnd(15)} PRICING`);
    console.log(`${"-".repeat(25)} ${"-".repeat(15)} ${"-".repeat(10)}`);
    for (const app of data.apps) {
      console.log(`  ${app.slug.padEnd(23)} ${app.type.padEnd(15)} ${app.pricing_model}`);
    }
  });

// kronus apps search <query>
appsCommand
  .command("search <query>")
  .description("Search marketplace")
  .action(async (query: string) => {
    const identity = await loadIdentity();
    if (!identity) {
      console.error("Not connected — run 'kronus connect' first");
      process.exit(1);
    }

    let token: string;
    try {
      token = await getAccessToken();
    } catch (err) {
      console.error(`Authentication error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const res = await fetch(
      `${identity.hub_url}/apps?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      console.error(`Search failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const data = (await res.json()) as AppsListResponse;

    if (data.apps.length === 0) {
      console.log(`No apps found for "${query}".`);
      return;
    }

    console.log(`${"SLUG".padEnd(25)} ${"TYPE".padEnd(15)} PRICING`);
    console.log(`${"-".repeat(25)} ${"-".repeat(15)} ${"-".repeat(10)}`);
    for (const app of data.apps) {
      console.log(`  ${app.slug.padEnd(23)} ${app.type.padEnd(15)} ${app.pricing_model}`);
    }
  });

// kronus apps update
appsCommand
  .command("update")
  .description("Update all installed apps")
  .action(async () => {
    let updated: string[];
    try {
      updated = await updateApps();
    } catch (err) {
      console.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (updated.length === 0) {
      console.log("No apps to update.");
    } else {
      console.log(`Updated ${updated.length} app${updated.length === 1 ? "" : "s"}:`);
      for (const slug of updated) {
        console.log(`  ${slug}`);
      }
    }
  });

// kronus install <app>
program
  .command("install <app>")
  .description("Install an app from the marketplace")
  .action(async (app: string) => {
    let installed;
    try {
      installed = await installApp(app);
    } catch (err) {
      console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    console.log(`Installed ${installed.name} (${installed.slug})`);
    if (installed.gateway_url !== undefined) {
      console.log(`  Gateway: ${installed.gateway_url}`);
      console.log(`  MCP entry added to ~/.claude/mcp.json as "kronus:${installed.slug}"`);
    }
  });

// kronus uninstall <app>
program
  .command("uninstall <app>")
  .description("Remove an installed app")
  .action(async (app: string) => {
    try {
      await uninstallApp(app);
    } catch (err) {
      console.error(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    console.log(`Uninstalled ${app}`);
  });

// kronus usage
program
  .command("usage")
  .description("Show installed apps and usage stats")
  .action(async () => {
    const installed = await listInstalledApps();

    if (installed.length === 0) {
      console.log("No apps installed. Run 'kronus apps' to browse the marketplace.");
      return;
    }

    console.log(`Installed apps: ${installed.length}`);
    console.log();
    for (const app of installed) {
      console.log(`  ${app.slug} (${app.type}) — installed ${app.installed_at}`);
      if (app.gateway_url !== undefined) {
        console.log(`    Gateway: ${app.gateway_url}`);
      }
    }
  });

interface AppManifest {
  name: string;
  slug?: string;
  [key: string]: unknown;
}

interface PublishResponse {
  app?: { slug?: string };
  message?: string;
}

// kronus publish <dir>
program
  .command("publish <dir>")
  .description("Submit an app to the marketplace (developer)")
  .action(async (dir: string) => {
    const manifestPath = join(dir, "kronus-app.json");

    let manifestData: string;
    let manifest: AppManifest;
    try {
      manifestData = await readFile(manifestPath, "utf-8");
      manifest = JSON.parse(manifestData) as AppManifest;
    } catch (err) {
      console.error(`Could not read ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const identity = await loadIdentity();
    if (!identity) {
      console.error("Not connected — run 'kronus connect' first");
      process.exit(1);
    }

    let token: string;
    try {
      token = await getAccessToken();
    } catch (err) {
      console.error(`Authentication error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const res = await fetch(`${identity.hub_url}/developer/apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: manifestData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.error(`Publish failed (${res.status}): ${errText}`);
      process.exit(1);
    }

    const data = (await res.json()) as PublishResponse;
    console.log(`Submitted "${manifest.name}" for review`);
    if (data.message !== undefined) {
      console.log(`  ${data.message}`);
    }
  });

program.parse();
