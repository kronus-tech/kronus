import { describe, it, expect } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import {
  genKronusId,
  users,
  instances,
  apps,
  app_versions,
  subscriptions,
  usage_events,
  reviews,
  payouts,
  usersRelations,
  instancesRelations,
  appsRelations,
  appVersionsRelations,
  subscriptionsRelations,
  reviewsRelations,
  payoutsRelations,
} from "../../../src/db/schema.js";

// ---------------------------------------------------------------------------
// genKronusId
// ---------------------------------------------------------------------------

describe("genKronusId — return format", () => {
  it("returns a string", () => {
    // Arrange + Act
    const id = genKronusId("usr");

    // Assert
    expect(typeof id).toBe("string");
  });

  it("starts with 'krn_'", () => {
    // Arrange + Act
    const id = genKronusId("usr");

    // Assert
    expect(id.startsWith("krn_")).toBe(true);
  });

  it("includes the given prefix after 'krn_'", () => {
    // Arrange + Act
    const id = genKronusId("usr");

    // Assert
    expect(id.startsWith("krn_usr_")).toBe(true);
  });

  it("suffix after prefix is exactly 16 characters", () => {
    // Arrange + Act
    const id = genKronusId("usr");

    // The format is krn_<prefix>_<16-char suffix>
    const suffix = id.slice("krn_usr_".length);

    // Assert
    expect(suffix).toHaveLength(16);
  });

  it("total format is krn_<prefix>_<16chars>", () => {
    // Arrange + Act
    const id = genKronusId("abc");

    // Assert — prefix is correct and suffix (after "krn_abc_") is 16 chars
    expect(id.startsWith("krn_abc_")).toBe(true);
    const suffix = id.slice("krn_abc_".length);
    expect(suffix).toHaveLength(16);
  });
});

describe("genKronusId — uniqueness", () => {
  it("two consecutive calls produce different IDs", () => {
    // Arrange + Act
    const id1 = genKronusId("usr");
    const id2 = genKronusId("usr");

    // Assert
    expect(id1).not.toBe(id2);
  });

  it("1000 calls produce no collisions", () => {
    // Arrange
    const ids = new Set<string>();

    // Act
    for (let i = 0; i < 1000; i++) {
      ids.add(genKronusId("usr"));
    }

    // Assert
    expect(ids.size).toBe(1000);
  });
});

describe("genKronusId — all defined prefixes", () => {
  const prefixes = ["usr", "inst", "app", "ver", "sub", "rev", "pay"] as const;

  for (const prefix of prefixes) {
    it(`prefix '${prefix}' produces id starting with 'krn_${prefix}_'`, () => {
      // Arrange + Act
      const id = genKronusId(prefix);

      // Assert
      expect(id.startsWith(`krn_${prefix}_`)).toBe(true);
    });

    it(`prefix '${prefix}' suffix is 16 characters`, () => {
      // Arrange + Act
      const id = genKronusId(prefix);
      const suffix = id.slice(`krn_${prefix}_`.length);

      // Assert
      expect(suffix).toHaveLength(16);
    });
  }
});

// ---------------------------------------------------------------------------
// users table — column presence
// ---------------------------------------------------------------------------

describe("users table — columns", () => {
  const columns = getTableColumns(users);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'email' column", () => {
    expect(columns).toHaveProperty("email");
  });

  it("has 'name' column", () => {
    expect(columns).toHaveProperty("name");
  });

  it("has 'password_hash' column", () => {
    expect(columns).toHaveProperty("password_hash");
  });

  it("has 'plan' column", () => {
    expect(columns).toHaveProperty("plan");
  });

  it("has 'stripe_customer_id' column", () => {
    expect(columns).toHaveProperty("stripe_customer_id");
  });

  it("has 'created_at' column", () => {
    expect(columns).toHaveProperty("created_at");
  });

  it("has 'updated_at' column", () => {
    expect(columns).toHaveProperty("updated_at");
  });

  it("has exactly 8 columns", () => {
    expect(Object.keys(columns)).toHaveLength(8);
  });

  it("'plan' column has default value 'free'", () => {
    expect(columns.plan.default).toBe("free");
  });
});

// ---------------------------------------------------------------------------
// instances table — column presence
// ---------------------------------------------------------------------------

describe("instances table — columns", () => {
  const columns = getTableColumns(instances);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'user_id' column", () => {
    expect(columns).toHaveProperty("user_id");
  });

  it("has 'public_key' column", () => {
    expect(columns).toHaveProperty("public_key");
  });

  it("has 'machine_fingerprint' column", () => {
    expect(columns).toHaveProperty("machine_fingerprint");
  });

  it("has 'kronus_version' column", () => {
    expect(columns).toHaveProperty("kronus_version");
  });

  it("has 'os' column", () => {
    expect(columns).toHaveProperty("os");
  });

  it("has 'last_heartbeat' column", () => {
    expect(columns).toHaveProperty("last_heartbeat");
  });

  it("has 'status' column", () => {
    expect(columns).toHaveProperty("status");
  });

  it("has 'created_at' column", () => {
    expect(columns).toHaveProperty("created_at");
  });

  it("'status' column has default value 'active'", () => {
    expect(columns.status.default).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// apps table — column presence
// ---------------------------------------------------------------------------

describe("apps table — columns", () => {
  const columns = getTableColumns(apps);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'slug' column", () => {
    expect(columns).toHaveProperty("slug");
  });

  it("has 'name' column", () => {
    expect(columns).toHaveProperty("name");
  });

  it("has 'description' column", () => {
    expect(columns).toHaveProperty("description");
  });

  it("has 'type' column", () => {
    expect(columns).toHaveProperty("type");
  });

  it("has 'developer_id' column", () => {
    expect(columns).toHaveProperty("developer_id");
  });

  it("has 'developer_mcp_url' column", () => {
    expect(columns).toHaveProperty("developer_mcp_url");
  });

  it("has 'pricing_model' column", () => {
    expect(columns).toHaveProperty("pricing_model");
  });

  it("has 'price_cents' column", () => {
    expect(columns).toHaveProperty("price_cents");
  });

  it("has 'status' column", () => {
    expect(columns).toHaveProperty("status");
  });

  it("has 'manifest_json' column", () => {
    expect(columns).toHaveProperty("manifest_json");
  });

  it("has 'download_url' column", () => {
    expect(columns).toHaveProperty("download_url");
  });

  it("has 'icon_url' column", () => {
    expect(columns).toHaveProperty("icon_url");
  });

  it("has 'created_at' column", () => {
    expect(columns).toHaveProperty("created_at");
  });

  it("has 'updated_at' column", () => {
    expect(columns).toHaveProperty("updated_at");
  });

  it("'pricing_model' column has default value 'free'", () => {
    expect(columns.pricing_model.default).toBe("free");
  });

  it("'status' column has default value 'draft'", () => {
    expect(columns.status.default).toBe("draft");
  });

  it("'price_cents' column has default value 0", () => {
    expect(columns.price_cents.default).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// app_versions table — column presence
// ---------------------------------------------------------------------------

describe("app_versions table — columns", () => {
  const columns = getTableColumns(app_versions);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'app_id' column", () => {
    expect(columns).toHaveProperty("app_id");
  });

  it("has 'version' column", () => {
    expect(columns).toHaveProperty("version");
  });

  it("has 'changelog' column", () => {
    expect(columns).toHaveProperty("changelog");
  });

  it("has 'download_url' column", () => {
    expect(columns).toHaveProperty("download_url");
  });

  it("has 'developer_mcp_url' column", () => {
    expect(columns).toHaveProperty("developer_mcp_url");
  });

  it("has 'kronus_min_version' column", () => {
    expect(columns).toHaveProperty("kronus_min_version");
  });

  it("has 'published_at' column", () => {
    expect(columns).toHaveProperty("published_at");
  });
});

// ---------------------------------------------------------------------------
// subscriptions table — column presence
// ---------------------------------------------------------------------------

describe("subscriptions table — columns", () => {
  const columns = getTableColumns(subscriptions);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'user_id' column", () => {
    expect(columns).toHaveProperty("user_id");
  });

  it("has 'app_id' column", () => {
    expect(columns).toHaveProperty("app_id");
  });

  it("has 'stripe_subscription_id' column", () => {
    expect(columns).toHaveProperty("stripe_subscription_id");
  });

  it("has 'status' column", () => {
    expect(columns).toHaveProperty("status");
  });

  it("has 'current_period_start' column", () => {
    expect(columns).toHaveProperty("current_period_start");
  });

  it("has 'current_period_end' column", () => {
    expect(columns).toHaveProperty("current_period_end");
  });

  it("has 'created_at' column", () => {
    expect(columns).toHaveProperty("created_at");
  });

  it("'status' column has default value 'active'", () => {
    expect(columns.status.default).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// usage_events table — column presence
// ---------------------------------------------------------------------------

describe("usage_events table — columns", () => {
  const columns = getTableColumns(usage_events);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'instance_id' column", () => {
    expect(columns).toHaveProperty("instance_id");
  });

  it("has 'app_id' column", () => {
    expect(columns).toHaveProperty("app_id");
  });

  it("has 'event_type' column", () => {
    expect(columns).toHaveProperty("event_type");
  });

  it("has 'payload_bytes' column", () => {
    expect(columns).toHaveProperty("payload_bytes");
  });

  it("has 'timestamp' column", () => {
    expect(columns).toHaveProperty("timestamp");
  });
});

// ---------------------------------------------------------------------------
// reviews table — column presence
// ---------------------------------------------------------------------------

describe("reviews table — columns", () => {
  const columns = getTableColumns(reviews);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'user_id' column", () => {
    expect(columns).toHaveProperty("user_id");
  });

  it("has 'app_id' column", () => {
    expect(columns).toHaveProperty("app_id");
  });

  it("has 'rating' column", () => {
    expect(columns).toHaveProperty("rating");
  });

  it("has 'comment' column", () => {
    expect(columns).toHaveProperty("comment");
  });

  it("has 'created_at' column", () => {
    expect(columns).toHaveProperty("created_at");
  });
});

// ---------------------------------------------------------------------------
// payouts table — column presence
// ---------------------------------------------------------------------------

describe("payouts table — columns", () => {
  const columns = getTableColumns(payouts);

  it("has 'id' column", () => {
    expect(columns).toHaveProperty("id");
  });

  it("has 'developer_id' column", () => {
    expect(columns).toHaveProperty("developer_id");
  });

  it("has 'amount_cents' column", () => {
    expect(columns).toHaveProperty("amount_cents");
  });

  it("has 'commission_cents' column", () => {
    expect(columns).toHaveProperty("commission_cents");
  });

  it("has 'stripe_transfer_id' column", () => {
    expect(columns).toHaveProperty("stripe_transfer_id");
  });

  it("has 'period_start' column", () => {
    expect(columns).toHaveProperty("period_start");
  });

  it("has 'period_end' column", () => {
    expect(columns).toHaveProperty("period_end");
  });

  it("has 'status' column", () => {
    expect(columns).toHaveProperty("status");
  });

  it("has 'created_at' column", () => {
    expect(columns).toHaveProperty("created_at");
  });

  it("'status' column has default value 'pending'", () => {
    expect(columns.status.default).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Column data types — spot checks for critical columns
// ---------------------------------------------------------------------------

describe("column data types — critical fields", () => {
  it("users.id is a text column", () => {
    const columns = getTableColumns(users);
    expect(columns.id.columnType).toBe("PgText");
  });

  it("reviews.rating is a smallint column", () => {
    const columns = getTableColumns(reviews);
    expect(columns.rating.columnType).toBe("PgSmallInt");
  });

  it("usage_events.id is a bigserial column", () => {
    const columns = getTableColumns(usage_events);
    expect(columns.id.columnType).toBe("PgBigSerial64");
  });

  it("apps.manifest_json is a jsonb column", () => {
    const columns = getTableColumns(apps);
    expect(columns.manifest_json.columnType).toBe("PgJsonb");
  });

  it("payouts.amount_cents is an integer column", () => {
    const columns = getTableColumns(payouts);
    expect(columns.amount_cents.columnType).toBe("PgInteger");
  });

  it("payouts.commission_cents is an integer column", () => {
    const columns = getTableColumns(payouts);
    expect(columns.commission_cents.columnType).toBe("PgInteger");
  });

  it("users.created_at is a timestamp column", () => {
    const columns = getTableColumns(users);
    expect(columns.created_at.columnType).toBe("PgTimestamp");
  });
});

// ---------------------------------------------------------------------------
// Relations — exports exist and are defined
// ---------------------------------------------------------------------------

describe("relations — exports are defined", () => {
  it("usersRelations is defined", () => {
    expect(usersRelations).toBeDefined();
  });

  it("instancesRelations is defined", () => {
    expect(instancesRelations).toBeDefined();
  });

  it("appsRelations is defined", () => {
    expect(appsRelations).toBeDefined();
  });

  it("appVersionsRelations is defined", () => {
    expect(appVersionsRelations).toBeDefined();
  });

  it("subscriptionsRelations is defined", () => {
    expect(subscriptionsRelations).toBeDefined();
  });

  it("reviewsRelations is defined", () => {
    expect(reviewsRelations).toBeDefined();
  });

  it("payoutsRelations is defined", () => {
    expect(payoutsRelations).toBeDefined();
  });
});

describe("relations — structural integrity", () => {
  it("usersRelations.dbName matches 'users' table name", () => {
    // Relations carry the table reference they are defined on
    expect(usersRelations.table).toBe(users);
  });

  it("appsRelations.table is the apps table", () => {
    expect(appsRelations.table).toBe(apps);
  });

  it("instancesRelations.table is the instances table", () => {
    expect(instancesRelations.table).toBe(instances);
  });

  it("appVersionsRelations.table is the app_versions table", () => {
    expect(appVersionsRelations.table).toBe(app_versions);
  });

  it("subscriptionsRelations.table is the subscriptions table", () => {
    expect(subscriptionsRelations.table).toBe(subscriptions);
  });

  it("reviewsRelations.table is the reviews table", () => {
    expect(reviewsRelations.table).toBe(reviews);
  });

  it("payoutsRelations.table is the payouts table", () => {
    expect(payoutsRelations.table).toBe(payouts);
  });
});

// ---------------------------------------------------------------------------
// Table exports — all 8 tables are exported and truthy
// ---------------------------------------------------------------------------

describe("table exports — all 8 tables are exported", () => {
  it("users is exported", () => {
    expect(users).toBeDefined();
  });

  it("instances is exported", () => {
    expect(instances).toBeDefined();
  });

  it("apps is exported", () => {
    expect(apps).toBeDefined();
  });

  it("app_versions is exported", () => {
    expect(app_versions).toBeDefined();
  });

  it("subscriptions is exported", () => {
    expect(subscriptions).toBeDefined();
  });

  it("usage_events is exported", () => {
    expect(usage_events).toBeDefined();
  });

  it("reviews is exported", () => {
    expect(reviews).toBeDefined();
  });

  it("payouts is exported", () => {
    expect(payouts).toBeDefined();
  });
});
