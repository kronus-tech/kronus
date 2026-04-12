export interface Config {
  readonly PORT: number;
  readonly NODE_ENV: string;
  readonly LOG_LEVEL: string;
  readonly DATABASE_URL: string;
  readonly REDIS_URL: string;
  readonly HUB_URL: string;
  readonly RELAY_URL: string;
  readonly JWT_PRIVATE_KEY: string | undefined;
  readonly JWT_PUBLIC_KEY: string | undefined;
  readonly STRIPE_SECRET_KEY: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET: string | undefined;
  readonly ADMIN_API_KEY: string | undefined;
}

const REQUIRED_VARS = ["DATABASE_URL", "REDIS_URL"] as const;

export function loadConfig(): Readonly<Config> {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    const value = process.env[key];
    if (value === undefined || value === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Copy hub/.env.example to hub/.env and fill in the values.`
    );
  }

  const config: Config = {
    PORT: Number(process.env["PORT"] ?? 3100),
    NODE_ENV: process.env["NODE_ENV"] ?? "development",
    LOG_LEVEL: process.env["LOG_LEVEL"] ?? "info",
    DATABASE_URL: process.env["DATABASE_URL"] as string,
    REDIS_URL: process.env["REDIS_URL"] as string,
    HUB_URL: process.env["HUB_URL"] ?? "http://localhost:3100",
    RELAY_URL: process.env["RELAY_URL"] ?? "ws://localhost:3100",
    JWT_PRIVATE_KEY: process.env["JWT_PRIVATE_KEY"],
    JWT_PUBLIC_KEY: process.env["JWT_PUBLIC_KEY"],
    STRIPE_SECRET_KEY: process.env["STRIPE_SECRET_KEY"],
    STRIPE_WEBHOOK_SECRET: process.env["STRIPE_WEBHOOK_SECRET"],
    ADMIN_API_KEY: process.env["ADMIN_API_KEY"],
  };

  return Object.freeze(config);
}

let _config: Readonly<Config> | undefined;

export function getConfig(): Readonly<Config> {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Lazy-loaded singleton — import and call getConfig() to access
export const config = {
  get(): Readonly<Config> {
    return getConfig();
  },
};
