/**
 * donkey-swift starter — Hono + PostgreSQL
 *
 * A working server you can copy, fill in your .env, and run.
 * Every donkey-swift service is wired with routes, middleware, and DB adapters.
 *
 * Setup:
 *   1. Copy this directory into your project
 *   2. cp env.example .env && fill in values
 *   3. npm install hono @hono/node-server postgres drizzle-orm donkey-swift
 *   4. npx tsx index.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import type { Context, Next } from "hono";

// ── donkey-swift imports ────────────────────────────────────────────────────

import { AuthService } from "donkey-swift/auth";
import { HealthService, dbCheck } from "donkey-swift/health";
import { SyncService } from "donkey-swift/sync";
import { EngageService } from "donkey-swift/engage";
import { NotifyService } from "donkey-swift/notify";
import { ChatService } from "donkey-swift/chat";
import { ReceiptService } from "donkey-swift/receipt";
import { AccountService } from "donkey-swift/account";
import { LifecycleService } from "donkey-swift/lifecycle";
import { FlagsService } from "donkey-swift/flags";
import { AnalyticsService } from "donkey-swift/analytics";
import { AttestService } from "donkey-swift/attest";
import { PromoService } from "donkey-swift/promo";
import { GrantService } from "donkey-swift/grants";
import { ConversionService } from "donkey-swift/conversion";
import { PaywallStore } from "donkey-swift/paywall";
import { LogBuffer, setupLogCapture } from "donkey-swift/logbuf";
import { Scheduler } from "donkey-swift/scheduler";
import { newProvider as newPushProvider } from "donkey-swift/push";
import { RateLimiter, extractBearerToken, safeEqual, resolveRequestId } from "donkey-swift/middleware";
import { ServiceError, errorToStatus } from "donkey-swift/errors";

// ── Local DB adapters (implement these with your schema) ────────────────────

// import { createDatabase, closeDatabase } from "./db/connection.js";
// import { createAuthDB } from "./db/auth.js";
// ... etc

// For this starter, we use placeholder DB adapters.
// Replace with your real implementations.

// ══════════════════════════════════════════════════════════════════════════════
// Config
// ══════════════════════════════════════════════════════════════════════════════

const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  appleBundleId: process.env.APPLE_BUNDLE_ID!,
  appleTeamId: process.env.APPLE_TEAM_ID || "",
  apnsKeyPath: process.env.APNS_KEY_PATH || "",
  apnsKeyId: process.env.APNS_KEY_ID || "",
  apnsTopic: process.env.APNS_TOPIC || process.env.APPLE_BUNDLE_ID || "",
  adminKey: process.env.ADMIN_KEY || "",
  isDev: process.env.NODE_ENV !== "production",
};

// ══════════════════════════════════════════════════════════════════════════════
// Database
// ══════════════════════════════════════════════════════════════════════════════

// TODO: Replace with your real DB setup:
// const { db, sql: pgClient } = createDatabase({ connectionString: config.databaseUrl });
// const pgdb = new PostgresDB(db);

// ══════════════════════════════════════════════════════════════════════════════
// Push Provider
// ══════════════════════════════════════════════════════════════════════════════

const push = await newPushProvider({
  keyPath: config.apnsKeyPath || undefined,
  keyId: config.apnsKeyId,
  teamId: config.appleTeamId,
  topic: config.apnsTopic,
  environment: config.isDev ? "sandbox" : "production",
});

// ══════════════════════════════════════════════════════════════════════════════
// Log Buffer
// ══════════════════════════════════════════════════════════════════════════════

const logBuffer = new LogBuffer(2000);
setupLogCapture(logBuffer);

// ══════════════════════════════════════════════════════════════════════════════
// Services — construct with config + DB adapter
// ══════════════════════════════════════════════════════════════════════════════

// TODO: Replace the DB adapter placeholders (authDB, engageDB, etc.)
// with your real implementations. See starters/postgres/ for Drizzle examples.

const auth = new AuthService({
  jwtSecret: config.jwtSecret,
  appleBundleId: config.appleBundleId,
  sessionExpirySec: 7 * 24 * 3600,
  productionEnv: !config.isDev,
}, null as any); // TODO: replace with your authDB

const health = new HealthService({
  checks: [
    // TODO: dbCheck("database", () => pgClient`SELECT 1`),
  ],
});

const engage = new EngageService({}, null as any);       // TODO: engageDB
const notify = new NotifyService(null as any, push);     // TODO: notifyDB
const chat = new ChatService(null as any, push, {        // TODO: chatDB
  parseToken: (t) => auth.parseSessionToken(t),
});
const sync = new SyncService(null as any, null as any, { // TODO: syncDB, entityHandler
  push,
  pushDebounceMs: 2500,
});
const receipt = new ReceiptService(null as any, {        // TODO: receiptDB
  bundleId: config.appleBundleId,
  environment: config.isDev ? "Sandbox" : "Production",
});
const account = new AccountService({}, null as any);     // TODO: accountDB
const lifecycle = new LifecycleService({
  promptCooldownDays: 3,
}, null as any, push);                                    // TODO: lifecycleDB
const flags = new FlagsService(null as any, { cacheTtlMs: 30_000 }); // TODO: flagsDB
const analytics = new AnalyticsService(null as any);     // TODO: analyticsDB
const attest = new AttestService(null as any);           // TODO: attestDB
const promo = new PromoService(null as any);             // TODO: promoDB
const grants = new GrantService(null as any);            // TODO: grantDB
const conversion = new ConversionService({}, null as any); // TODO: conversionDB
const paywall = new PaywallStore();

// ══════════════════════════════════════════════════════════════════════════════
// Hono App
// ══════════════════════════════════════════════════════════════════════════════

const app = new Hono();
const api = "/api/v1";
const adm = "/admin/api";

// ── Global error handler ────────────────────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof ServiceError) {
    return c.json({ error: err.message }, errorToStatus(err) as any);
  }
  console.error("unhandled error:", err);
  return c.json({ error: "internal error" }, 500);
});

// ── Middleware ───────────────────────────────────────────────────────────────

const rl = new RateLimiter(100, 60_000);

// CORS
app.use("*", cors({ origin: "*", credentials: true }));

// Request ID
app.use("*", async (c, next) => {
  c.header("X-Request-ID", resolveRequestId(c.req.header("x-request-id")));
  await next();
});

// Request logging (skip health probes)
app.use("*", async (c, next) => {
  if (c.req.path === "/health" || c.req.path === "/ready") return next();
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
});

// Rate limit on API routes
app.use("/api/*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rl.allow(ip)) return c.json({ error: "rate limit exceeded" }, 429);
  await next();
});

// ── Auth middleware ──────────────────────────────────────────────────────────

async function requireAuth(c: Context, next: Next) {
  const token = extractBearerToken(c.req.header("authorization")) || getCookie(c, "session");
  if (!token) return c.json({ error: "unauthorized" }, 401);
  try {
    c.set("userId", await auth.parseSessionToken(token));
    await next();
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
}

async function requireAdmin(c: Context, next: Next) {
  if (!config.adminKey) return c.json({ error: "admin not configured" }, 501);
  const key = c.req.header("x-admin-key") || getCookie(c, "admin_key");
  if (!key || !safeEqual(key, config.adminKey)) return c.json({ error: "forbidden" }, 403);
  await next();
}

function uid(c: Context): string { return c.get("userId") as string; }

// ══════════════════════════════════════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════════════════════════════════════

// ── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json(health.health()));
app.get("/ready", async (c) => {
  const result = await health.ready();
  return c.json(result, result.status === "ready" ? 200 : 503);
});

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post(`${api}/auth/apple`, async (c) => {
  const { identity_token, name } = await c.req.json();
  const result = await auth.authenticateWithApple(identity_token, name);
  setCookie(c, "session", result.token, { path: "/", httpOnly: true, secure: !config.isDev, sameSite: "Lax", maxAge: 7 * 24 * 3600 });
  return c.json(result);
});

app.get(`${api}/auth/me`, requireAuth, async (c) => c.json(await auth.getUser(uid(c))));

app.post(`${api}/auth/logout`, requireAuth, async (c) => {
  const token = extractBearerToken(c.req.header("authorization")) || getCookie(c, "session");
  await auth.logout(token);
  deleteCookie(c, "session", { path: "/" });
  return c.json({ status: "logged out" });
});

app.post(`${api}/auth/logout-all`, requireAuth, async (c) => {
  await auth.logoutAll(uid(c));
  deleteCookie(c, "session", { path: "/" });
  return c.json({ status: "all sessions revoked" });
});

// ── Engage ───────────────────────────────────────────────────────────────────

app.post(`${api}/events`, requireAuth, async (c) => {
  const { events } = await c.req.json();
  return c.json(await engage.trackEvents(uid(c), events));
});

app.put(`${api}/subscription`, requireAuth, async (c) => {
  return c.json(await engage.updateSubscription(uid(c), await c.req.json()));
});

app.post(`${api}/sessions`, requireAuth, async (c) => {
  return c.json(await engage.reportSession(uid(c), await c.req.json()));
});

app.get(`${api}/user/eligibility`, requireAuth, async (c) => {
  return c.json(await engage.getEligibility(uid(c)));
});

app.post(`${api}/feedback`, requireAuth, async (c) => {
  return c.json(await engage.submitFeedback(uid(c), await c.req.json()));
});

// ── Notifications ────────────────────────────────────────────────────────────

app.post(`${api}/notifications/devices`, requireAuth, async (c) => {
  return c.json(await notify.registerDevice(uid(c), await c.req.json()));
});

app.delete(`${api}/notifications/devices`, requireAuth, async (c) => {
  const { token } = await c.req.json();
  return c.json(await notify.disableDevice(uid(c), token));
});

app.get(`${api}/notifications/preferences`, requireAuth, async (c) => {
  return c.json(await notify.getPreferences(uid(c)));
});

app.put(`${api}/notifications/preferences`, requireAuth, async (c) => {
  return c.json(await notify.updatePreferences(uid(c), await c.req.json()));
});

// ── Chat ─────────────────────────────────────────────────────────────────────

app.get(`${api}/chat`, requireAuth, async (c) => {
  return c.json(await chat.getMessages(uid(c), {
    since_id: c.req.query("since_id") ? Number(c.req.query("since_id")) : undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    offset: c.req.query("offset") ? Number(c.req.query("offset")) : undefined,
  }));
});

app.post(`${api}/chat`, requireAuth, async (c) => {
  const { message, message_type } = await c.req.json();
  return c.json(await chat.sendMessage(uid(c), message, message_type), 201);
});

app.get(`${api}/chat/unread`, requireAuth, async (c) => {
  return c.json(await chat.getUnreadCount(uid(c)));
});

// ── Sync ─────────────────────────────────────────────────────────────────────

app.get(`${api}/sync/changes`, requireAuth, async (c) => {
  return c.json(await sync.getChanges(uid(c), {
    since: c.req.query("since"),
    deviceId: c.req.header("x-device-id") || c.req.query("device_id") || "",
    deviceToken: c.req.header("x-device-token") || "",
  }));
});

app.post(`${api}/sync/batch`, requireAuth, async (c) => {
  const body = await c.req.json();
  const deviceId = c.req.header("x-device-id") || c.req.query("device_id") || body.device_id || "";
  const deviceToken = c.req.header("x-device-token") || "";
  return c.json(await sync.syncBatch(uid(c), body.items, {
    deviceId,
    deviceToken,
    idempotencyKey: c.req.header("x-idempotency-key"),
  }));
});

app.delete(`${api}/sync/:entity_type/:id`, requireAuth, async (c) => {
  const deviceId = c.req.header("x-device-id") || c.req.query("device_id") || "";
  const deviceToken = c.req.header("x-device-token") || "";
  return c.json(await sync.deleteEntity(uid(c), c.req.param("entity_type"), c.req.param("id"), { deviceId, deviceToken }));
});

// ── Flags ────────────────────────────────────────────────────────────────────

app.get(`${api}/flags/:key`, requireAuth, async (c) => {
  return c.json(await flags.check(uid(c), c.req.param("key")));
});

app.post(`${api}/flags/check`, requireAuth, async (c) => {
  const { keys } = await c.req.json();
  return c.json(await flags.batchCheck(uid(c), keys));
});

// ── Receipt ──────────────────────────────────────────────────────────────────

app.post(`${api}/receipt/verify`, requireAuth, async (c) => {
  const { transaction } = await c.req.json();
  return c.json(await receipt.verifyReceipt(uid(c), transaction));
});

app.post(`${api}/receipt/webhook`, async (c) => {
  const { signedPayload } = await c.req.json();
  return c.json(await receipt.processWebhook(signedPayload));
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

app.get(`${api}/user/lifecycle`, requireAuth, async (c) => {
  return c.json(await lifecycle.evaluateUser(uid(c)));
});

app.post(`${api}/user/lifecycle/ack`, requireAuth, async (c) => {
  const { prompt_type, action } = await c.req.json();
  await lifecycle.ackPrompt(uid(c), prompt_type, action);
  return c.json({ status: "ok" });
});

// ── Account ──────────────────────────────────────────────────────────────────

app.delete(`${api}/account`, requireAuth, async (c) => {
  return c.json(await account.deleteAccount(uid(c)));
});

app.post(`${api}/account/anonymize`, requireAuth, async (c) => {
  return c.json(await account.anonymizeAccount(uid(c)));
});

app.get(`${api}/account/export`, requireAuth, async (c) => {
  const data = await account.exportData(uid(c));
  c.header("Content-Disposition", "attachment; filename=account-data.json");
  return c.json(data);
});

// ── Attest ───────────────────────────────────────────────────────────────────

app.post(`${api}/attest/challenge`, requireAuth, async (c) => {
  return c.json(await attest.createChallenge(uid(c)));
});

app.post(`${api}/attest/verify`, requireAuth, async (c) => {
  return c.json(await attest.verifyAttestation(uid(c), await c.req.json()));
});

// ── Paywall ──────────────────────────────────────────────────────────────────

app.get(`${api}/paywall/config`, (c) => {
  const locale = c.req.query("locale") ?? "en";
  const cfg = paywall.get(locale);
  return cfg ? c.json(cfg) : c.json({ error: "not found" }, 404);
});

// ── Promo ────────────────────────────────────────────────────────────────────

app.post(`${api}/promo/redeem`, requireAuth, async (c) => {
  const { code } = await c.req.json();
  return c.json(await promo.redeemCode(uid(c), code));
});

// Influencer portal (token-based, no user auth)
app.get(`${api}/promo/portal/:token`, async (c) => {
  return c.json(await promo.getInfluencerPortal(c.req.param("token")));
});

// ── Grants ───────────────────────────────────────────────────────────────────

app.get(`${api}/user/premium`, requireAuth, async (c) => {
  return c.json({ granted: await grants.isGrantedPremium(uid(c)) });
});

// ── Conversion ───────────────────────────────────────────────────────────────

app.post(`${api}/conversion/dismissal`, requireAuth, async (c) => {
  await conversion.recordDismissal(uid(c));
  return c.json({ status: "recorded" });
});

app.get(`${api}/conversion/offer`, requireAuth, async (c) => {
  const offer = await conversion.getActiveOffer(uid(c));
  return c.json(offer ? { has_offer: true, ...offer } : { has_offer: false });
});

app.post(`${api}/conversion/redeem`, requireAuth, async (c) => {
  await conversion.redeemOffer(uid(c));
  return c.json({ status: "redeemed" });
});

// ══════════════════════════════════════════════════════════════════════════════
// Admin Routes
// ══════════════════════════════════════════════════════════════════════════════

// ── Admin: Chat ──────────────────────────────────────────────────────────────

app.get(`${adm}/chat`, requireAdmin, async (c) => {
  return c.json(await chat.adminListChats(Number(c.req.query("limit") || 100)));
});

app.get(`${adm}/chat/:user_id`, requireAdmin, async (c) => {
  return c.json(await chat.adminGetMessages(c.req.param("user_id")));
});

app.post(`${adm}/chat/:user_id`, requireAdmin, async (c) => {
  const { message, message_type } = await c.req.json();
  return c.json(await chat.adminReply(c.req.param("user_id"), message, message_type), 201);
});

// ── Admin: Flags ─────────────────────────────────────────────────────────────

app.get(`${adm}/flags`, requireAdmin, async (c) => c.json(await flags.listFlags()));
app.post(`${adm}/flags`, requireAdmin, async (c) => c.json(await flags.createFlag(await c.req.json()), 201));
app.put(`${adm}/flags/:key`, requireAdmin, async (c) => c.json(await flags.updateFlag(c.req.param("key"), await c.req.json())));
app.delete(`${adm}/flags/:key`, requireAdmin, async (c) => c.json(await flags.deleteFlag(c.req.param("key"))));

// ── Admin: Analytics ─────────────────────────────────────────────────────────

app.get(`${adm}/analytics/dau`, requireAdmin, async (c) => c.json(await analytics.getDau(c.req.query("since"))));
app.get(`${adm}/analytics/events`, requireAdmin, async (c) => c.json(await analytics.getEvents({ since: c.req.query("since"), event: c.req.query("event") })));
app.get(`${adm}/analytics/mrr`, requireAdmin, async (c) => c.json(await analytics.getMrr()));
app.get(`${adm}/analytics/summary`, requireAdmin, async (c) => c.json(await analytics.getSummary()));
app.get(`${adm}/analytics/retention`, requireAdmin, async (c) => c.json(await analytics.getRetention({ since: c.req.query("since"), days: c.req.query("days") })));

// ── Admin: Logs ──────────────────────────────────────────────────────────────

app.get(`${adm}/logs`, requireAdmin, (c) => {
  return c.json(logBuffer.queryLogs({
    limit: Number(c.req.query("limit") || 500),
    filter: c.req.query("filter"),
  }));
});

// ── Admin: Promo ─────────────────────────────────────────────────────────────

app.get(`${adm}/promo/codes`, requireAdmin, async (c) => c.json(await promo.listCodes()));
app.post(`${adm}/promo/codes`, requireAdmin, async (c) => c.json(await promo.createCode(await c.req.json()), 201));
app.put(`${adm}/promo/codes/:code`, requireAdmin, async (c) => c.json(await promo.updateCode(c.req.param("code"), await c.req.json())));
app.post(`${adm}/promo/codes/:code/deactivate`, requireAdmin, async (c) => c.json(await promo.deactivateCode(c.req.param("code"))));

app.get(`${adm}/promo/influencers`, requireAdmin, async (c) => c.json(await promo.listInfluencers()));
app.post(`${adm}/promo/influencers`, requireAdmin, async (c) => c.json(await promo.createInfluencer(await c.req.json()), 201));
app.get(`${adm}/promo/influencers/:id/stats`, requireAdmin, async (c) => c.json(await promo.getInfluencerStats(c.req.param("id"))));

// ── Admin: Grants ────────────────────────────────────────────────────────────

app.get(`${adm}/grants`, requireAdmin, async (c) => c.json(await grants.listAllActiveGrants()));
app.post(`${adm}/grants`, requireAdmin, async (c) => c.json(await grants.grantPremium(await c.req.json()), 201));
app.get(`${adm}/grants/:user_id`, requireAdmin, async (c) => c.json(await grants.listGrants(c.req.param("user_id"))));
app.delete(`${adm}/grants/:grant_id`, requireAdmin, async (c) => c.json(await grants.revokeGrant(c.req.param("grant_id"))));

// ── Admin: Paywall ───────────────────────────────────────────────────────────

app.put(`${adm}/paywall/config`, requireAdmin, async (c) => {
  const locale = c.req.query("locale") ?? "en";
  const cfg = await c.req.json();
  paywall.set(locale, cfg);
  return c.json({ status: "updated", locale });
});

// ══════════════════════════════════════════════════════════════════════════════
// Start Server
// ══════════════════════════════════════════════════════════════════════════════

console.log(`Starting server on port ${config.port}...`);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
  console.log(`Admin panel: http://localhost:${info.port}${adm}`);
  console.log(`Environment: ${config.isDev ? "development" : "production"}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  rl.destroy();
  sync.close();
  // TODO: await closeDatabase(pgClient);
  process.exit(0);
});
