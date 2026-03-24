import { Hono } from "hono";
import { requireAuth, requireAdmin, cors, rateLimit, requestLog, requestId, version, RateLimiter } from "../middleware/index.js";
import type { AuthConfig, AdminConfig } from "../middleware/index.js";
import type { AuthService } from "../auth/index.js";
import type { EngageService } from "../engage/index.js";
import type { NotifyService } from "../notify/index.js";
import type { ChatService } from "../chat/index.js";
import type { SyncService } from "../sync/index.js";
import type { FlagsService } from "../flags/index.js";
import type { ReceiptService } from "../receipt/index.js";
import type { LifecycleService } from "../lifecycle/index.js";
import type { AccountService } from "../account/index.js";
import type { AnalyticsService } from "../analytics/index.js";
import type { AttestService } from "../attest/index.js";
import type { HealthService } from "../health/index.js";
import type { PaywallStore } from "../paywall/index.js";
import { handleGetConfig, handleUpdateConfig } from "../paywall/index.js";
import type { Scheduler } from "../scheduler/index.js";
import type { NotifyScheduler } from "../notify/index.js";
import type { LogBuffer } from "../logbuf/index.js";
import { handleAdminLogs } from "../logbuf/index.js";
import { openApiSpec } from "./openapi.js";

// ── App Config ──────────────────────────────────────────────────────────────

export interface AppConfig {
  /** API version string (e.g. "1.0.0") */
  apiVersion: string;
  /** Minimum supported client version */
  minimumVersion: string;
  /** Allowed CORS origins ("*" for all) */
  corsOrigins?: string;
  /** API route prefix (default: "/api/v1") */
  apiPrefix?: string;
  /** Admin route prefix (default: "/admin/api") */
  adminPrefix?: string;

  // Auth
  authConfig: AuthConfig;
  adminConfig: AdminConfig;

  // Services
  auth: AuthService;
  engage?: EngageService;
  notify?: NotifyService;
  chat?: ChatService;
  sync?: SyncService;
  flags?: FlagsService;
  receipt?: ReceiptService;
  lifecycle?: LifecycleService;
  account?: AccountService;
  analytics?: AnalyticsService;
  attest?: AttestService;
  health: HealthService;
  paywallStore?: PaywallStore;
  logBuffer?: LogBuffer;

  /** Maximum request body size in bytes (default: 1MB). */
  maxBodySize?: number;

  // Optional references for centralized shutdown
  scheduler?: Scheduler;
  notifyScheduler?: NotifyScheduler;
}

// ── Body Size Middleware ─────────────────────────────────────────────────────

function bodyLimit(maxBytes: number) {
  return async (c: { req: { header: (name: string) => string | undefined }; json: (data: unknown, status: number) => Response }, next: () => Promise<void>) => {
    const contentLength = c.req.header("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return c.json({ error: `request body too large (max ${Math.floor(maxBytes / 1024)}KB)` }, 413);
    }
    await next();
  };
}

// ── Create App ──────────────────────────────────────────────────────────────

export interface AppResources {
  app: Hono;
  /** Call to clean up rate limiters, intervals, etc. */
  shutdown(): void;
}

export function createApp(cfg: AppConfig): AppResources {
  const app = new Hono();

  const api = cfg.apiPrefix ?? "/api/v1";
  const adm = cfg.adminPrefix ?? "/admin/api";
  const maxBody = cfg.maxBodySize ?? 1_048_576; // 1MB default

  // Track rate limiters for cleanup
  const rateLimiters: RateLimiter[] = [];
  function rl(rate: number, windowMs: number): RateLimiter {
    const limiter = new RateLimiter(rate, windowMs);
    rateLimiters.push(limiter);
    return limiter;
  }

  // Global middleware
  app.use("*", requestId());
  app.use("*", cors(cfg.corsOrigins ?? "*"));
  app.use("*", version(cfg.apiVersion, cfg.minimumVersion));
  app.use("*", requestLog("/health", "/ready"));
  app.use("*", bodyLimit(maxBody) as never);

  const auth = requireAuth(cfg.authConfig);
  const admin = requireAdmin(cfg.adminConfig);

  // Rate limiter tiers
  const authRl = rl(10, 60_000);        // auth: 10/min
  const writeRl = rl(60, 60_000);       // writes: 60/min
  const bulkRl = rl(30, 60_000);        // bulk ops: 30/min
  const sensitiveRl = rl(5, 60_000);    // sensitive ops: 5/min
  const webhookRl = rl(120, 60_000);    // webhooks: 120/min (Apple can burst)
  const adminRl = rl(60, 60_000);       // admin writes: 60/min

  // ── OpenAPI ──
  app.get("/api/openapi.json", (c) => c.json(openApiSpec()));

  // ── Health ──
  app.get("/health", cfg.health.handleHealth);
  app.get("/ready", cfg.health.handleReady);

  // ── Auth ──
  app.post(`${api}/auth/apple`, rateLimit(authRl), cfg.auth.handleAppleAuth);
  app.get(`${api}/auth/me`, auth, cfg.auth.handleMe);
  app.post(`${api}/auth/logout`, auth, rateLimit(writeRl), cfg.auth.handleLogout);

  // ── Engage ──
  if (cfg.engage) {
    const e = cfg.engage;
    app.post(`${api}/events`, auth, rateLimit(bulkRl), e.handleTrackEvents);
    app.put(`${api}/subscription`, auth, rateLimit(writeRl), e.handleUpdateSubscription);
    app.post(`${api}/sessions`, auth, rateLimit(writeRl), e.handleSessionReport);
    app.get(`${api}/user/eligibility`, auth, e.handleGetEligibility);
    app.post(`${api}/feedback`, auth, rateLimit(writeRl), e.handleSubmitFeedback);
  }

  // ── Notifications ──
  if (cfg.notify) {
    const n = cfg.notify;
    app.post(`${api}/notifications/devices`, auth, rateLimit(writeRl), n.handleRegisterDevice);
    app.delete(`${api}/notifications/devices`, auth, rateLimit(writeRl), n.handleDisableDevice);
    app.get(`${api}/notifications/preferences`, auth, n.handleGetPrefs);
    app.put(`${api}/notifications/preferences`, auth, rateLimit(writeRl), n.handleUpdatePrefs);
    app.post(`${api}/notifications/opened`, auth, rateLimit(writeRl), n.handleNotificationOpened);
  }

  // ── Chat ──
  if (cfg.chat) {
    const ch = cfg.chat;
    app.get(`${api}/chat`, auth, ch.handleGetChat);
    app.post(`${api}/chat`, auth, rateLimit(writeRl), ch.handleSendChat);
    app.get(`${api}/chat/unread`, auth, ch.handleUnreadCount);
    // Admin chat
    app.get(`${adm}/chat`, admin, ch.handleAdminListChats);
    app.get(`${adm}/chat/:user_id`, admin, ch.handleAdminGetChat);
    app.post(`${adm}/chat/:user_id`, admin, rateLimit(adminRl), ch.handleAdminReplyChat);
  }

  // ── Sync ──
  if (cfg.sync) {
    const s = cfg.sync;
    app.get(`${api}/sync/changes`, auth, s.handleSyncChanges);
    app.post(`${api}/sync/batch`, auth, rateLimit(bulkRl), s.handleSyncBatch);
    app.delete(`${api}/sync/:entity_type/:id`, auth, rateLimit(writeRl), s.handleSyncDelete);
  }

  // ── Flags ──
  if (cfg.flags) {
    const f = cfg.flags;
    app.get(`${api}/flags/:key`, auth, f.handleCheck);
    app.post(`${api}/flags/check`, auth, f.handleBatchCheck);
    app.get(`${adm}/flags`, admin, f.handleAdminList);
    app.post(`${adm}/flags`, admin, rateLimit(adminRl), f.handleAdminCreate);
    app.put(`${adm}/flags/:key`, admin, rateLimit(adminRl), f.handleAdminUpdate);
    app.delete(`${adm}/flags/:key`, admin, rateLimit(adminRl), f.handleAdminDelete);
  }

  // ── Receipts ──
  if (cfg.receipt) {
    const r = cfg.receipt;
    app.post(`${api}/receipt/verify`, auth, rateLimit(writeRl), r.handleVerifyReceipt);
    app.post(`${api}/receipt/webhook`, rateLimit(webhookRl), r.handleWebhook);
  }

  // ── Lifecycle ──
  if (cfg.lifecycle) {
    const l = cfg.lifecycle;
    app.get(`${api}/user/lifecycle`, auth, l.handleGetLifecycle);
    app.post(`${api}/user/lifecycle/ack`, auth, rateLimit(writeRl), l.handleAckPrompt);
  }

  // ── Account ──
  if (cfg.account) {
    const a = cfg.account;
    app.delete(`${api}/account`, auth, rateLimit(sensitiveRl), a.handleDeleteAccount);
    app.post(`${api}/account/anonymize`, auth, rateLimit(sensitiveRl), a.handleAnonymizeAccount);
    app.get(`${api}/account/export`, auth, rateLimit(sensitiveRl), a.handleExportData);
  }

  // ── Attest ──
  if (cfg.attest) {
    const at = cfg.attest;
    app.post(`${api}/attest/challenge`, auth, rateLimit(writeRl), at.handleChallenge);
    app.post(`${api}/attest/verify`, auth, rateLimit(writeRl), at.handleVerify);
    app.post(`${api}/attest/assert`, auth, rateLimit(writeRl), at.handleAssert);
  }

  // ── Paywall ──
  if (cfg.paywallStore) {
    app.get(`${api}/paywall/config`, handleGetConfig(cfg.paywallStore));
    app.put(`${adm}/paywall/config`, admin, rateLimit(adminRl), handleUpdateConfig(cfg.paywallStore));
  }

  // ── Analytics ──
  if (cfg.analytics) {
    const an = cfg.analytics;
    app.get(`${adm}/analytics/dau`, admin, an.handleDAU);
    app.get(`${adm}/analytics/events`, admin, an.handleEvents);
    app.get(`${adm}/analytics/mrr`, admin, an.handleMRR);
    app.get(`${adm}/analytics/summary`, admin, an.handleSummary);
  }

  // ── Logs ──
  if (cfg.logBuffer) {
    app.get(`${adm}/logs`, admin, handleAdminLogs(cfg.logBuffer));
  }

  return {
    app,
    shutdown() {
      for (const limiter of rateLimiters) limiter.destroy();
      cfg.sync?.close?.();
      cfg.scheduler?.stop();
      cfg.notifyScheduler?.stop();
    },
  };
}
