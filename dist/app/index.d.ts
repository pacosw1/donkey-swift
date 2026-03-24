import { Hono } from "hono";
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
import type { Scheduler } from "../scheduler/index.js";
import type { NotifyScheduler } from "../notify/index.js";
import type { LogBuffer } from "../logbuf/index.js";
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
    authConfig: AuthConfig;
    adminConfig: AdminConfig;
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
    scheduler?: Scheduler;
    notifyScheduler?: NotifyScheduler;
}
export interface AppResources {
    app: Hono;
    /** Call to clean up rate limiters, intervals, etc. */
    shutdown(): void;
}
export declare function createApp(cfg: AppConfig): AppResources;
//# sourceMappingURL=index.d.ts.map