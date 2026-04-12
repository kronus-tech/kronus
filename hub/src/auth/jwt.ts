import * as jose from "jose";
import { getConfig } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import { getRedis } from "../lib/redis.js";

const logger = createLogger("auth");

export interface AccessTokenPayload {
  sub: string;
  instance_id?: string;
  plan: string;
  capabilities: string[];
  app_access: string[];
  scopes: string[];
}

export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
}

let signingKey: jose.KeyLike;
let verifyKey: jose.KeyLike;
let publicJwk: jose.JWK;

export async function initializeKeys(): Promise<void> {
  const config = getConfig();

  if (config.JWT_PRIVATE_KEY && config.JWT_PUBLIC_KEY) {
    const privateJwkRaw = JSON.parse(
      Buffer.from(config.JWT_PRIVATE_KEY, "base64url").toString()
    ) as jose.JWK;
    const publicJwkRaw = JSON.parse(
      Buffer.from(config.JWT_PUBLIC_KEY, "base64url").toString()
    ) as jose.JWK;

    signingKey = (await jose.importJWK(privateJwkRaw, "EdDSA")) as jose.KeyLike;
    verifyKey = (await jose.importJWK(publicJwkRaw, "EdDSA")) as jose.KeyLike;
    publicJwk = publicJwkRaw;

    logger.info("JWT keys loaded from environment");
  } else {
    logger.warn(
      "JWT keys not configured — generating ephemeral keys. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY for production."
    );

    const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA");
    signingKey = privateKey as jose.KeyLike;
    verifyKey = publicKey as jose.KeyLike;
    publicJwk = await jose.exportJWK(publicKey);
  }

  if (!publicJwk.kid) {
    publicJwk.kid = "kronus-hub-1";
  }
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const config = getConfig();

  return new jose.SignJWT({ ...payload } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
    .setIssuer(config.HUB_URL)
    .setAudience("kronus-mesh")
    .setIssuedAt()
    .setJti(crypto.randomUUID()) // HUB-23: unique token ID for revocation
    .setExpirationTime("1h")
    .sign(signingKey);
}

export async function signRefreshToken(userId: string): Promise<string> {
  const config = getConfig();

  return new jose.SignJWT({ sub: userId, type: "refresh" } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
    .setIssuer(config.HUB_URL)
    .setAudience("kronus-mesh")
    .setIssuedAt()
    .setJti(crypto.randomUUID()) // HUB-23: unique token ID for revocation
    .setExpirationTime("30d")
    .sign(signingKey);
}

// HUB-23: Revoke a token by its jti — stores in Redis with auto-expiry
export async function revokeToken(jti: string, expiresAt: Date): Promise<void> {
  const redis = getRedis();
  const ttlSecs = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
  await redis.setex(`jwt:revoked:${jti}`, ttlSecs, "1");
}

export async function verifyToken(token: string): Promise<jose.JWTPayload> {
  const config = getConfig();

  const { payload } = await jose.jwtVerify(token, verifyKey, {
    issuer: config.HUB_URL,
    audience: "kronus-mesh",
  });

  // HUB-23: Check revocation blocklist
  const jti = payload.jti;
  if (jti) {
    const redis = getRedis();
    const revoked = await redis.get(`jwt:revoked:${jti}`);
    if (revoked) {
      throw new Error("Token has been revoked");
    }
  }

  return payload;
}

export function getPublicJwk(): jose.JWK {
  return publicJwk;
}

export function isInitialized(): boolean {
  return signingKey !== undefined;
}
