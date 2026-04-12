import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hash } from "@node-rs/argon2";
import * as schema from "./schema.js";
import { genKronusId } from "./schema.js";

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

const NODE_ENV = process.env["NODE_ENV"];
if (NODE_ENV === "production") {
  console.error("ERROR: seed.ts must not run in production");
  process.exit(1);
}

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required to run seeds");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

// ---------------------------------------------------------------------------
// Seed IDs (stable so reruns are idempotent via onConflictDoNothing)
// ---------------------------------------------------------------------------

const userId = genKronusId("usr");
const instanceId = genKronusId("inst");
const appId = genKronusId("app");
const versionId = genKronusId("ver");
const subscriptionId = genKronusId("sub");
const reviewId = genKronusId("rev");

// ---------------------------------------------------------------------------
// Seed rows
// ---------------------------------------------------------------------------

const devPasswordHash = await hash("dev-password-do-not-use-in-prod");

const seedUser: typeof schema.users.$inferInsert = {
  id: userId,
  email: "dev@kronus.dev",
  name: "Kronus Dev",
  password_hash: devPasswordHash,
  plan: "free",
};

const seedInstance: typeof schema.instances.$inferInsert = {
  id: instanceId,
  user_id: userId,
  public_key: "dev-public-key-placeholder",
  machine_fingerprint: "dev-machine-fingerprint",
  kronus_version: "5.3.0",
  os: "darwin",
  status: "active",
};

const seedApp: typeof schema.apps.$inferInsert = {
  id: appId,
  slug: "test-scraper",
  name: "Test Scraper",
  description: "A test MCP app for local development",
  type: "developer_mcp",
  developer_id: userId,
  developer_mcp_url: "https://mcp.example.dev/test-scraper",
  pricing_model: "free",
  price_cents: 0,
  status: "published",
  manifest_json: {
    name: "test-scraper",
    version: "0.1.0",
    tools: [{ name: "scrape_url", description: "Scrape a URL" }],
  },
};

const seedVersion: typeof schema.app_versions.$inferInsert = {
  id: versionId,
  app_id: appId,
  version: "0.1.0",
  changelog: "Initial release",
  developer_mcp_url: "https://mcp.example.dev/test-scraper",
  kronus_min_version: "5.3.0",
};

const seedSubscription: typeof schema.subscriptions.$inferInsert = {
  id: subscriptionId,
  user_id: userId,
  app_id: appId,
  status: "active",
};

const seedReview: typeof schema.reviews.$inferInsert = {
  id: reviewId,
  user_id: userId,
  app_id: appId,
  rating: 5,
  comment: "Great test app!",
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  console.log("Seeding database...\n");

  await db
    .insert(schema.users)
    .values(seedUser)
    .onConflictDoNothing({ target: schema.users.email });
  console.log(`  users       → ${seedUser.email}`);

  await db
    .insert(schema.instances)
    .values(seedInstance)
    .onConflictDoNothing({ target: schema.instances.id });
  console.log(`  instances   → ${seedInstance.id}`);

  await db
    .insert(schema.apps)
    .values(seedApp)
    .onConflictDoNothing({ target: schema.apps.slug });
  console.log(`  apps        → ${seedApp.slug}`);

  await db
    .insert(schema.app_versions)
    .values(seedVersion)
    .onConflictDoNothing({ target: schema.app_versions.id });
  console.log(`  app_versions → ${seedVersion.version}`);

  await db
    .insert(schema.subscriptions)
    .values(seedSubscription)
    .onConflictDoNothing({ target: schema.subscriptions.id });
  console.log(`  subscriptions → user=${seedUser.email} app=${seedApp.slug}`);

  await db
    .insert(schema.reviews)
    .values(seedReview)
    .onConflictDoNothing({ target: schema.reviews.id });
  console.log(`  reviews     → rating=${seedReview.rating}`);

  console.log("\nSeed complete.");
}

seed()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void sql.end();
  });
