import { Hono } from "hono";
import { requireAuth, requireAdmin, cors, rateLimit, requestLog, version, RateLimiter } from "../middleware/index.js";
import { handleGetConfig, handleUpdateConfig } from "../paywall/index.js";
import { handleAdminLogs } from "../logbuf/index.js";
import { openApiSpec } from "./openapi.js";
// ── Create App ──────────────────────────────────────────────────────────────
export function createApp(cfg) {
    const app = new Hono();
    // Global middleware
    app.use("*", cors(cfg.corsOrigins ?? "*"));
    app.use("*", version(cfg.apiVersion, cfg.minimumVersion));
    app.use("*", requestLog("/health", "/ready"));
    const auth = requireAuth(cfg.authConfig);
    const admin = requireAdmin(cfg.adminConfig);
    // ── OpenAPI ──
    app.get("/api/openapi.json", (c) => c.json(openApiSpec()));
    // ── Health ──
    app.get("/health", cfg.health.handleHealth);
    app.get("/ready", cfg.health.handleReady);
    // ── Auth ──
    const authRl = new RateLimiter(10, 60_000);
    app.post("/api/v1/auth/apple", rateLimit(authRl), cfg.auth.handleAppleAuth);
    app.get("/api/v1/auth/me", auth, cfg.auth.handleMe);
    app.post("/api/v1/auth/logout", cfg.auth.handleLogout);
    // ── Engage ──
    if (cfg.engage) {
        const e = cfg.engage;
        app.post("/api/v1/events", auth, e.handleTrackEvents);
        app.put("/api/v1/subscription", auth, e.handleUpdateSubscription);
        app.post("/api/v1/sessions", auth, e.handleSessionReport);
        app.get("/api/v1/user/eligibility", auth, e.handleGetEligibility);
        app.post("/api/v1/feedback", auth, e.handleSubmitFeedback);
    }
    // ── Notifications ──
    if (cfg.notify) {
        const n = cfg.notify;
        app.post("/api/v1/notifications/devices", auth, n.handleRegisterDevice);
        app.delete("/api/v1/notifications/devices", auth, n.handleDisableDevice);
        app.get("/api/v1/notifications/preferences", auth, n.handleGetPrefs);
        app.put("/api/v1/notifications/preferences", auth, n.handleUpdatePrefs);
        app.post("/api/v1/notifications/opened", auth, n.handleNotificationOpened);
    }
    // ── Chat ──
    if (cfg.chat) {
        const ch = cfg.chat;
        app.get("/api/v1/chat", auth, ch.handleGetChat);
        app.post("/api/v1/chat", auth, ch.handleSendChat);
        app.get("/api/v1/chat/unread", auth, ch.handleUnreadCount);
        // Admin chat
        app.get("/admin/api/chat", admin, ch.handleAdminListChats);
        app.get("/admin/api/chat/:user_id", admin, ch.handleAdminGetChat);
        app.post("/admin/api/chat/:user_id", admin, ch.handleAdminReplyChat);
    }
    // ── Sync ──
    if (cfg.sync) {
        const s = cfg.sync;
        app.get("/api/v1/sync/changes", auth, s.handleSyncChanges);
        app.post("/api/v1/sync/batch", auth, s.handleSyncBatch);
        app.delete("/api/v1/sync/:entity_type/:id", auth, s.handleSyncDelete);
    }
    // ── Flags ──
    if (cfg.flags) {
        const f = cfg.flags;
        app.get("/api/v1/flags/:key", auth, f.handleCheck);
        app.post("/api/v1/flags/check", auth, f.handleBatchCheck);
        app.get("/admin/api/flags", admin, f.handleAdminList);
        app.post("/admin/api/flags", admin, f.handleAdminCreate);
        app.put("/admin/api/flags/:key", admin, f.handleAdminUpdate);
        app.delete("/admin/api/flags/:key", admin, f.handleAdminDelete);
    }
    // ── Receipts ──
    if (cfg.receipt) {
        const r = cfg.receipt;
        app.post("/api/v1/receipt/verify", auth, r.handleVerifyReceipt);
        app.post("/api/v1/receipt/webhook", r.handleWebhook); // No auth — Apple calls directly
    }
    // ── Lifecycle ──
    if (cfg.lifecycle) {
        const l = cfg.lifecycle;
        app.get("/api/v1/user/lifecycle", auth, l.handleGetLifecycle);
        app.post("/api/v1/user/lifecycle/ack", auth, l.handleAckPrompt);
    }
    // ── Account ──
    if (cfg.account) {
        const a = cfg.account;
        app.delete("/api/v1/account", auth, a.handleDeleteAccount);
        app.post("/api/v1/account/anonymize", auth, a.handleAnonymizeAccount);
        app.get("/api/v1/account/export", auth, a.handleExportData);
    }
    // ── Attest ──
    if (cfg.attest) {
        const at = cfg.attest;
        app.post("/api/v1/attest/challenge", auth, at.handleChallenge);
        app.post("/api/v1/attest/verify", auth, at.handleVerify);
    }
    // ── Paywall ──
    if (cfg.paywallStore) {
        app.get("/api/v1/paywall/config", handleGetConfig(cfg.paywallStore));
        app.put("/admin/api/paywall/config", admin, handleUpdateConfig(cfg.paywallStore));
    }
    // ── Analytics ──
    if (cfg.analytics) {
        const an = cfg.analytics;
        app.get("/admin/api/analytics/dau", admin, an.handleDAU);
        app.get("/admin/api/analytics/events", admin, an.handleEvents);
        app.get("/admin/api/analytics/mrr", admin, an.handleMRR);
        app.get("/admin/api/analytics/summary", admin, an.handleSummary);
    }
    // ── Logs ──
    if (cfg.logBuffer) {
        app.get("/admin/api/logs", admin, handleAdminLogs(cfg.logBuffer));
    }
    return app;
}
//# sourceMappingURL=index.js.map