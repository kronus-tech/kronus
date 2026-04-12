import {
  pgTable,
  text,
  integer,
  smallint,
  bigserial,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function genKronusId(prefix: string): string {
  return `krn_${prefix}_${nanoid(16)}`;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => genKronusId("usr")),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  password_hash: text("password_hash").notNull(),
  plan: text("plan").notNull().default("free"),
  stripe_customer_id: text("stripe_customer_id"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const instances = pgTable(
  "instances",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => genKronusId("inst")),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    public_key: text("public_key").notNull(),
    machine_fingerprint: text("machine_fingerprint"),
    kronus_version: text("kronus_version"),
    os: text("os"),
    last_heartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("instances_user_id_idx").on(t.user_id)]
);

export const apps = pgTable(
  "apps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => genKronusId("app")),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(),
    developer_id: text("developer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    developer_mcp_url: text("developer_mcp_url"),
    pricing_model: text("pricing_model").notNull().default("free"),
    price_cents: integer("price_cents").notNull().default(0),
    status: text("status").notNull().default("draft"),
    manifest_json: jsonb("manifest_json").notNull(),
    download_url: text("download_url"),
    icon_url: text("icon_url"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("apps_slug_idx").on(t.slug),
    index("apps_developer_id_idx").on(t.developer_id),
    index("apps_status_idx").on(t.status),
  ]
);

export const app_versions = pgTable(
  "app_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => genKronusId("ver")),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    changelog: text("changelog"),
    download_url: text("download_url"),
    developer_mcp_url: text("developer_mcp_url"),
    kronus_min_version: text("kronus_min_version"),
    published_at: timestamp("published_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("app_versions_app_id_version_idx").on(t.app_id, t.version),
  ]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => genKronusId("sub")),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    stripe_subscription_id: text("stripe_subscription_id"),
    status: text("status").notNull().default("active"),
    current_period_start: timestamp("current_period_start", {
      withTimezone: true,
    }),
    current_period_end: timestamp("current_period_end", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_user_id_app_id_idx").on(t.user_id, t.app_id),
  ]
);

export const usage_events = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    instance_id: text("instance_id").notNull(),
    app_id: text("app_id").notNull(),
    event_type: text("event_type").notNull(),
    payload_bytes: integer("payload_bytes"),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("usage_events_instance_app_idx").on(t.instance_id, t.app_id),
    index("usage_events_timestamp_idx").on(t.timestamp),
  ]
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => genKronusId("rev")),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    app_id: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    rating: smallint("rating")
      .notNull()
      .$type<1 | 2 | 3 | 4 | 5>(),
    comment: text("comment"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("reviews_user_id_app_id_idx").on(t.user_id, t.app_id),
    {
      name: "reviews_rating_check",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle check constraint requires sql tag
      check: sql`${t.rating} >= 1 AND ${t.rating} <= 5`,
    } as unknown as Parameters<typeof pgTable>[2][number],
  ]
);

export const payouts = pgTable(
  "payouts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => genKronusId("pay")),
    developer_id: text("developer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount_cents: integer("amount_cents").notNull(),
    commission_cents: integer("commission_cents").notNull(),
    stripe_transfer_id: text("stripe_transfer_id"),
    period_start: timestamp("period_start", { withTimezone: true }).notNull(),
    period_end: timestamp("period_end", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("payouts_developer_id_idx").on(t.developer_id)]
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  instances: many(instances),
  apps: many(apps),
  subscriptions: many(subscriptions),
  reviews: many(reviews),
  payouts: many(payouts),
}));

export const instancesRelations = relations(instances, ({ one }) => ({
  user: one(users, {
    fields: [instances.user_id],
    references: [users.id],
  }),
}));

export const appsRelations = relations(apps, ({ one, many }) => ({
  developer: one(users, {
    fields: [apps.developer_id],
    references: [users.id],
  }),
  versions: many(app_versions),
  subscriptions: many(subscriptions),
  reviews: many(reviews),
}));

export const appVersionsRelations = relations(app_versions, ({ one }) => ({
  app: one(apps, {
    fields: [app_versions.app_id],
    references: [apps.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.user_id],
    references: [users.id],
  }),
  app: one(apps, {
    fields: [subscriptions.app_id],
    references: [apps.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  user: one(users, {
    fields: [reviews.user_id],
    references: [users.id],
  }),
  app: one(apps, {
    fields: [reviews.app_id],
    references: [apps.id],
  }),
}));

export const payoutsRelations = relations(payouts, ({ one }) => ({
  developer: one(users, {
    fields: [payouts.developer_id],
    references: [users.id],
  }),
}));
