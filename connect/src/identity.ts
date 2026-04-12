import * as jose from "jose";
import { join } from "path";
import { homedir, hostname, platform } from "os";
import type { Identity } from "./types.js";

const KRONUS_DIR = join(homedir(), ".kronus");
const IDENTITY_PATH = join(KRONUS_DIR, "identity.json");

export async function generateIdentityKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", { extractable: true });
  const pubJwk = await jose.exportJWK(publicKey);
  const privJwk = await jose.exportJWK(privateKey);
  return {
    publicKey: JSON.stringify(pubJwk),
    privateKey: JSON.stringify(privJwk),
  };
}

export async function saveIdentity(identity: Identity): Promise<void> {
  const { mkdir, writeFile } = await import("fs/promises");
  await mkdir(KRONUS_DIR, { recursive: true });
  const data = JSON.stringify(identity, null, 2);
  await writeFile(IDENTITY_PATH, data, { mode: 0o600 });
}

export async function loadIdentity(): Promise<Identity | null> {
  const { readFile } = await import("fs/promises");
  try {
    const data = await readFile(IDENTITY_PATH, "utf-8");
    return JSON.parse(data) as Identity;
  } catch {
    return null;
  }
}

export async function deleteIdentity(): Promise<void> {
  const { unlink } = await import("fs/promises");
  try {
    await unlink(IDENTITY_PATH);
  } catch {
    // File doesn't exist — that's fine
  }
}

export function getMachineFingerprint(): string {
  return `${hostname()}-${platform()}`;
}

export function getIdentityPath(): string {
  return IDENTITY_PATH;
}

export function getKronusDir(): string {
  return KRONUS_DIR;
}
