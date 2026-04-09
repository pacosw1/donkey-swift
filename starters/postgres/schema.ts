import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  serial,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  varchar,
} from "drizzle-orm/pg-core";

// ── users (auth) ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  appleSub: text("apple_sub").unique().notNull(),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── user_subscriptions (engage) ──────────────────────────────────────────────

export const userSubscriptions = pgTable("user_subscriptions", {
  userId: text("user_id").primaryKey(),
  productId: text("product_id").notNull().default(""),
  status: text("status").notNull().default("free"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  originalTransactionId: text("original_transaction_id").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  currencyCode: text("currency_code").notNull().default("USD"),
});

// ── user_activity (engage) ───────────────────────────────────────────────────

export const userActivity = pgTable(
  "user_activity",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    event: text("event").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_activity_user_event").on(table.userId, table.event, table.createdAt),
  ]
);

// ── user_sessions (engage) ───────────────────────────────────────────────────

export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationS: integer("duration_s").default(0),
    appVersion: text("app_version").notNull().default(""),
    osVersion: text("os_version").notNull().default(""),
    country: text("country").notNull().default(""),
  },
  (table) => [
    index("idx_user_sessions_user").on(table.userId, table.startedAt),
  ]
);

// ── user_feedback (engage) ───────────────────────────────────────────────────

export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull().default("general"),
  message: text("message").notNull(),
  appVersion: text("app_version").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── feature_flags (flags) ────────────────────────────────────────────────────

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  rolloutPct: integer("rollout_pct").notNull().default(100),
  description: text("description").notNull().default(""),
  // v1 typed-value columns (still read by the legacy getValue() path)
  value: text("value"),
  valueType: text("value_type").notNull().default("boolean"),
  // v2 targeting engine columns — all json so the service can read them back
  // as Condition trees / Variant arrays without any schema migration per flag.
  defaultValue: jsonb("default_value").notNull().default(false),
  rules: jsonb("rules").notNull().default([]),
  variants: jsonb("variants"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlagOverrides = pgTable(
  "feature_flag_overrides",
  {
    flagKey: text("flag_key").notNull(),
    userId: text("user_id").notNull(),
    enabled: boolean("enabled").notNull(),
  },
  (table) => [primaryKey({ columns: [table.flagKey, table.userId] })]
);

// ── verified_transactions (receipt) ──────────────────────────────────────────

export const verifiedTransactions = pgTable(
  "verified_transactions",
  {
    transactionId: text("transaction_id").primaryKey(),
    originalTransactionId: text("original_transaction_id").notNull(),
    userId: text("user_id").notNull(),
    productId: text("product_id").notNull(),
    status: text("status").notNull(),
    purchaseDate: timestamp("purchase_date", { withTimezone: true }).notNull(),
    expiresDate: timestamp("expires_date", { withTimezone: true }),
    environment: text("environment").notNull().default("Production"),
    priceCents: integer("price_cents").notNull().default(0),
    currencyCode: text("currency_code").notNull().default("USD"),
    notificationType: text("notification_type").notNull().default(""),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_verified_tx_orig").on(table.originalTransactionId),
    index("idx_verified_tx_user").on(table.userId, table.verifiedAt),
  ]
);

// ── tombstones (sync) ────────────────────────────────────────────────────────

export const tombstones = pgTable(
  "tombstones",
  {
    entityType: varchar("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    userId: text("user_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.entityType, table.entityId, table.userId] }),
    index("idx_tombstones_user_deleted").on(table.userId, table.deletedAt),
  ]
);

// ── user_attest_keys (attest) ────────────────────────────────────────────────

export const userAttestKeys = pgTable("user_attest_keys", {
  userId: text("user_id").primaryKey(),
  keyId: text("key_id").notNull(),
  publicKey: text("public_key").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── attest_challenges (attest) ──────────────────────────────────────────────

export const attestChallenges = pgTable("attest_challenges", {
  nonce: text("nonce").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ── chat_messages (chat) ─────────────────────────────────────────────────────

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    sender: text("sender").notNull().default("user"),
    message: text("message").notNull(),
    messageType: text("message_type").notNull().default("text"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chat_messages_user").on(table.userId, table.createdAt),
  ]
);

// ── user_device_tokens (notify) ──────────────────────────────────────────────

export const userDeviceTokens = pgTable(
  "user_device_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    token: text("token").notNull(),
    platform: text("platform").notNull().default("ios"),
    deviceModel: text("device_model").notNull().default(""),
    osVersion: text("os_version").notNull().default(""),
    appVersion: text("app_version").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    apnsTopic: text("apns_topic"),
  },
  (table) => [
    uniqueIndex("user_device_tokens_user_id_token_key").on(table.userId, table.token),
  ]
);

// ── user_notification_preferences (notify) ───────────────────────────────────

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    userId: text("user_id").primaryKey(),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    intervalSeconds: integer("interval_seconds").notNull().default(3600),
    wakeHour: integer("wake_hour").notNull().default(8),
    sleepHour: integer("sleep_hour").notNull().default(22),
    timezone: text("timezone").notNull().default("America/New_York"),
    stopAfterGoal: boolean("stop_after_goal").notNull().default(true),
  }
);

// ── influencers (promo) ───────────────────────────────────────────────────

export const influencers = pgTable("influencers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  portalToken: text("portal_token").notNull().unique(),
  commissionType: text("commission_type").notNull().default("revenue_share"),
  commissionValue: integer("commission_value").notNull().default(20),
  commissionCurrency: text("commission_currency").notNull().default("USD"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── promo_codes (promo) ─────────────────────────────────────────────────

export const promoCodes = pgTable("promo_codes", {
  code: text("code").primaryKey(),
  influencerId: text("influencer_id").notNull(),
  type: text("type").notNull().default("discount"),
  discountPct: integer("discount_pct"),
  grantDays: integer("grant_days"),
  maxRedemptions: integer("max_redemptions").notNull().default(0),
  redeemedCount: integer("redeemed_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── promo_redemptions (promo) ───────────────────────────────────────────

export const promoRedemptions = pgTable("promo_redemptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  code: text("code").notNull(),
  influencerId: text("influencer_id").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  purchaseAmountCents: integer("purchase_amount_cents"),
  commissionCents: integer("commission_cents"),
}, (table) => [
  index("idx_promo_redemptions_user").on(table.userId),
  index("idx_promo_redemptions_influencer").on(table.influencerId),
]);

// ── premium_grants (grants) ─────────────────────────────────────────────

export const premiumGrants = pgTable("premium_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  grantedBy: text("granted_by").notNull(),
  reason: text("reason").notNull(),
  productId: text("product_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("idx_premium_grants_user").on(table.userId),
]);

// ── conversion_offers (conversion) ──────────────────────────────────────

export const conversionOffers = pgTable("conversion_offers", {
  userId: text("user_id").primaryKey(),
  discountPct: integer("discount_pct").notNull(),
  productId: text("product_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  trigger: text("trigger").notNull(),
  redeemed: boolean("redeemed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── conversion_dismissals (conversion) ──────────────────────────────────

export const conversionDismissals = pgTable("conversion_dismissals", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_conversion_dismissals_user").on(table.userId, table.createdAt),
]);

// ── notification_deliveries (notify) ─────────────────────────────────────────

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull().default("reminder"),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("sent"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notification_deliveries_user").on(table.userId, table.sentAt),
  ]
);
