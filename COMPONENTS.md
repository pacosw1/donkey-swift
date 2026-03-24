# Donkey-Swift — Package API Catalog

Shared TypeScript packages for iOS app backends. Interface-based DB, Hono handlers, zero database dependency.

## httputil

JSON request/response helpers for raw `Request`/`Response` objects.

### Functions

```typescript
function jsonResponse(status: number, data: unknown): Response
function errorResponse(status: number, message: string): Response
async function decodeJson<T>(request: Request): Promise<T>
function getClientIp(request: Request): string
```

---

## middleware

Hono middleware for auth, admin, CORS, rate limiting, logging, and versioning.

### Types

```typescript
interface AuthConfig {
  parseToken: (token: string) => Promise<string>;
  cookieName?: string;        // default: "session"
}

interface AdminConfig {
  adminKey?: string;
  adminEmail?: string;
  parseToken?: (token: string) => Promise<string>;
  getUserEmail?: (userId: string) => Promise<string>;
  adminCookieName?: string;   // default: "admin_session"
  adminKeyCookieName?: string; // default: "admin_key"
}

class RateLimiter {
  constructor(rate: number, windowMs: number)
  allow(ip: string): boolean
  destroy(): void
}
```

### Functions

```typescript
function requireAuth(cfg: AuthConfig): MiddlewareHandler
function requireAdmin(cfg: AdminConfig): MiddlewareHandler
function cors(allowedOrigins: string): MiddlewareHandler
function rateLimit(rl: RateLimiter): MiddlewareHandler
function requestId(): MiddlewareHandler
function requestLog(...skipPaths: string[]): MiddlewareHandler
function version(current: string, minimum: string): MiddlewareHandler
```

---

## migrate

SQL migration runner. Migrations should be idempotent (IF NOT EXISTS).

### Types

```typescript
interface Migration {
  name: string;
  sql: string;
}

interface SqlExecutor {
  execute(sql: string): Promise<void>;
}
```

### Service

```typescript
class MigrationRunner {
  constructor(db: SqlExecutor)
  add(...migrations: Migration[]): void
  async run(): Promise<void>
}
```

---

## health

Liveness and readiness probes.

### Types

```typescript
interface Check {
  name: string;
  fn: () => Promise<void>;
}

interface HealthConfig {
  checks?: Check[];
}
```

### Service

```typescript
class HealthService {
  constructor(cfg: HealthConfig)
  handleHealth: (c: Context) => Promise<Response>   // GET /health
  handleReady: (c: Context) => Promise<Response>     // GET /ready
}
```

### Functions

```typescript
function dbCheck(name: string, queryFn: () => Promise<unknown>): Check
function urlCheck(name: string, url: string, timeoutMs?: number): Check
function storageCheck(name: string, headFn: () => Promise<unknown>): Check
function pushCheck(name: string, tokenFn: () => Promise<unknown>): Check
```

---

## logbuf

Ring-buffer log capture for admin panels.

### Service

```typescript
class LogBuffer {
  constructor(capacity: number)
  write(text: string): void
  getLines(n?: number): string[]
}
```

### Functions

```typescript
function setupLogCapture(buf: LogBuffer): () => void
function handleAdminLogs(buf: LogBuffer): (c: Context) => Promise<Response>
```

---

## scheduler

Periodic background task runner using `setInterval`.

### Types

```typescript
interface Task {
  name: string;
  run: (signal: AbortSignal) => Promise<void>;
}

interface TaskConfig {
  task: Task;
  every?: number;      // run every N ticks (1 = every tick, 96 = daily at 15min intervals)
  runFirst?: boolean;   // run immediately on first tick
}

interface SchedulerConfig {
  intervalMs?: number;  // default: 15 minutes
  tasks?: TaskConfig[];
}
```

### Service

```typescript
class Scheduler {
  constructor(cfg: SchedulerConfig)
  addTask(tc: TaskConfig): void
  tickCount(): number
  start(): void
  stop(): void
}
```

### Functions

```typescript
function funcTask(name: string, fn: (signal: AbortSignal) => Promise<void>): Task
```

---

## auth

Apple Sign-In verification, JWT session management, optional server-side session store for revocation and multi-device management.

### DB Interfaces

```typescript
interface AuthDB {
  upsertUserByAppleSub(id: string, appleSub: string, email: string, name: string): Promise<User>;
  userById(id: string): Promise<User>;
}

/**
 * Optional server-side session store. Enables session revocation and multi-device management.
 * If not provided, sessions are stateless JWTs (no revocation support).
 */
interface SessionDB {
  createSession(userId: string, jti: string, expiresAt: Date): Promise<void>;
  isSessionValid(jti: string): Promise<boolean>;
  revokeSession(jti: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  activeSessions?(userId: string): Promise<Array<{ jti: string; createdAt: Date | string }>>;
}
```

### Types

```typescript
interface User {
  id: string;
  apple_sub: string;
  email: string;
  name: string;
  created_at: Date | string;
  last_login_at: Date | string;
}

interface AuthConfig {
  jwtSecret: string;
  appleBundleId: string;
  appleWebClientId?: string;
  sessionExpirySec?: number;       // default: 7 days
  productionEnv?: boolean;
  cookieName?: string;             // default: "session"
  sessionDB?: SessionDB;           // optional server-side session store
  appleClientSecret?: string;      // JWT for Sign in with Apple web flow
  appleRedirectUri?: string;       // redirect URI for Apple web flow
}
```

### Service

```typescript
class AuthService {
  constructor(cfg: AuthConfig, db: AuthDB)
  async verifyAppleIdToken(tokenString: string): Promise<{ sub: string; email: string; emailVerified: boolean }>
  async createSessionToken(userId: string): Promise<string>
  async parseSessionToken(tokenStr: string): Promise<string>
  handleAppleAuth: (c: Context) => Promise<Response>       // POST   /api/v1/auth/apple
  handleWebAuth: (c: Context) => Promise<Response>         // POST   /api/v1/auth/apple/web
  handleMe: (c: Context) => Promise<Response>              // GET    /api/v1/auth/me
  handleLogout: (c: Context) => Promise<Response>          // POST   /api/v1/auth/logout
  handleLogoutAll: (c: Context) => Promise<Response>       // POST   /api/v1/auth/logout-all
  handleListSessions: (c: Context) => Promise<Response>    // GET    /api/v1/auth/sessions
  handleRevokeSession: (c: Context) => Promise<Response>   // DELETE /api/v1/auth/sessions/:jti
}
```

---

## engage

Event tracking, subscription management, sessions, feedback, and paywall eligibility.

### DB Interface

```typescript
interface EngageDB {
  trackEvents(userId: string, events: EventInput[]): Promise<void>;
  updateSubscription(userId: string, productId: string, status: string, expiresAt: Date | string | null): Promise<void>;
  updateSubscriptionDetails(userId: string, originalTransactionId: string, priceCents: number, currencyCode: string): Promise<void>;
  getSubscription(userId: string): Promise<UserSubscription | null>;
  isProUser(userId: string): Promise<boolean>;
  getEngagementData(userId: string): Promise<EngagementData>;
  startSession(userId: string, sessionId: string, appVersion: string, osVersion: string, country: string): Promise<void>;
  endSession(userId: string, sessionId: string, durationS: number): Promise<void>;
  saveFeedback(userId: string, feedbackType: string, message: string, appVersion: string): Promise<void>;
}
```

### Types

```typescript
interface EventInput {
  event: string;
  metadata: string;
  timestamp: string;
}

interface UserSubscription {
  user_id: string;
  product_id: string;
  status: string;
  expires_at: Date | string | null;
  started_at: Date | string | null;
  updated_at: Date | string;
}

interface EngagementData {
  days_active: number;
  total_logs: number;
  current_streak: number;
  subscription_status: string;
  paywall_shown_count: number;
  last_paywall_date: string;
  goals_completed_total: number;
}

type EventHook = (userId: string, events: EventInput[]) => void;

interface EngageConfig {
  paywallTrigger?: (data: EngagementData) => string;
}
```

### Service

```typescript
class EngageService {
  constructor(cfg: EngageConfig, db: EngageDB)
  registerEventHook(hook: EventHook): void
  handleTrackEvents: (c: Context) => Promise<Response>         // POST /api/v1/events
  handleUpdateSubscription: (c: Context) => Promise<Response>  // PUT  /api/v1/subscription
  handleSessionReport: (c: Context) => Promise<Response>       // POST /api/v1/sessions
  handleGetEligibility: (c: Context) => Promise<Response>      // GET  /api/v1/user/eligibility
  handleSubmitFeedback: (c: Context) => Promise<Response>      // POST /api/v1/feedback
}
```

### Functions

```typescript
const VALID_STATUSES: string[]
const VALID_FEEDBACK_TYPES: string[]
function defaultPaywallTrigger(data: EngagementData): string
```

---

## notify

Push notification device registration, preferences, delivery scheduling with concurrent processing and goal-based suppression.

### DB Interface

```typescript
interface NotifyDB {
  upsertDeviceToken(dt: DeviceToken): Promise<void>;
  disableDeviceToken(userId: string, token: string): Promise<void>;
  enabledDeviceTokens(userId: string): Promise<DeviceToken[]>;
  ensureNotificationPreferences(userId: string): Promise<void>;
  getNotificationPreferences(userId: string): Promise<NotificationPreferences>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<void>;
  allUsersWithNotificationsEnabled(): Promise<string[]>;
  lastNotificationDelivery(userId: string): Promise<NotificationDelivery | null>;
  recordNotificationDelivery(userId: string, kind: string, title: string, body: string): Promise<void>;
  trackNotificationOpened(userId: string, notificationId: string): Promise<void>;
}
```

### Types

```typescript
interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  device_model: string;
  os_version: string;
  app_version: string;
  enabled: boolean;
  last_seen_at: Date | string;
}

interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean;
  interval_seconds: number;
  wake_hour: number;
  sleep_hour: number;
  timezone: string;
  stop_after_goal: boolean;
}

interface NotificationDelivery {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  sent_at: Date | string;
}

type TickFunc = (userId: string, prefs: NotificationPreferences, tokens: DeviceToken[], push: PushProvider) => Promise<void>;

/** Checks whether a user has completed their daily goal. Used by stop_after_goal. */
type GoalCheckFunc = (userId: string) => Promise<boolean>;

interface NotifySchedulerConfig {
  intervalMs?: number;
  tickFunc: TickFunc;        // required — use exampleTick() as a reference
  extraTick?: () => Promise<void>;
  goalCheck?: GoalCheckFunc; // skip notification when goal is met (if stop_after_goal enabled)
  concurrency?: number;      // max concurrent user evaluations per tick (default: 50)
}
```

### Service

```typescript
class NotifyService {
  constructor(db: NotifyDB, push: PushProvider)
  handleRegisterDevice: (c: Context) => Promise<Response>       // POST   /api/v1/notifications/devices
  handleDisableDevice: (c: Context) => Promise<Response>        // DELETE /api/v1/notifications/devices
  handleGetPrefs: (c: Context) => Promise<Response>             // GET    /api/v1/notifications/preferences
  handleUpdatePrefs: (c: Context) => Promise<Response>          // PUT    /api/v1/notifications/preferences
  handleNotificationOpened: (c: Context) => Promise<Response>   // POST   /api/v1/notifications/opened
}

class NotifyScheduler {
  constructor(db: NotifyDB, push: PushProvider, cfg: NotifySchedulerConfig)
  start(): void
  stop(): void
}
```

### Functions

```typescript
function exampleTick(userId: string, prefs: NotificationPreferences, tokens: DeviceToken[], push: PushProvider): Promise<void>
function getHourInTimezone(date: Date, timezone: string): number
```

---

## push

Apple Push Notification service (APNs) provider with JWT-based authentication, HTTP/2 transport, rich payload support, and bad token detection.

### Types

```typescript
/** Result of a push send attempt. */
interface PushResult {
  success: boolean;
  reason?: string;       // APNs error reason (e.g. "BadDeviceToken", "Unregistered")
  statusCode?: number;
}

/** Callback invoked when a device token is invalid. Use to disable the token in your DB. */
type BadTokenHandler = (deviceToken: string, reason: string) => void;

interface PushProvider {
  send(deviceToken: string, title: string, body: string): Promise<void>;
  sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
  sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
  sendRich?(deviceToken: string, payload: APNsPayload): Promise<PushResult>;
}

interface APNsAlert {
  title: string;
  subtitle?: string;
  body: string;
  "title-loc-key"?: string;
  "title-loc-args"?: string[];
  "loc-key"?: string;
  "loc-args"?: string[];
  "launch-image"?: string;
}

interface APNsSound {
  name?: string;       // default: "default"
  critical?: 0 | 1;
  volume?: number;
}

interface APNsAps {
  alert?: APNsAlert | string;
  badge?: number;
  sound?: string | APNsSound;
  "content-available"?: number;
  "mutable-content"?: number;
  category?: string;
  "thread-id"?: string;
  "target-content-id"?: string;
  "interruption-level"?: "passive" | "active" | "time-sensitive" | "critical";
  "relevance-score"?: number;
  "filter-criteria"?: string;
  "stale-date"?: number;
  timestamp?: number;                       // Live Activities
  event?: string;                           // Live Activities (update, end)
  "content-state"?: Record<string, unknown>; // Live Activities
  "dismissal-date"?: number;                // Live Activities
}

interface APNsPayload {
  aps: APNsAps;
  [key: string]: unknown;  // custom data merged into top-level payload
}

interface APNsHeaders {
  pushType?: string;       // alert, background, voip, liveactivity, etc.
  priority?: string;       // "10" immediate, "5" power-saving, "1" background
  expiration?: string;     // 0 = deliver now or not at all
  collapseId?: string;     // coalescing notifications
  topic?: string;          // override APNs topic
}

interface PushConfig {
  keyPath?: string;                          // path to .p8 key file
  keyId: string;
  teamId: string;
  topic: string;                             // bundle ID
  environment?: "sandbox" | "production";
  onBadToken?: BadTokenHandler;              // called when APNs reports bad token
}
```

### Service

```typescript
class APNsProvider implements PushProvider {
  static async create(cfg: PushConfig): Promise<APNsProvider>
  close(): void
  async send(deviceToken: string, title: string, body: string): Promise<void>
  async sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>
  async sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>
  async sendRich(deviceToken: string, payload: APNsPayload, headers?: APNsHeaders): Promise<PushResult>
}

class LogProvider implements PushProvider { /* logs to console, sendRich returns { success: true } */ }
class NoopProvider implements PushProvider { /* no-op, sendRich returns { success: true } */ }
```

### Functions

```typescript
async function newProvider(cfg: PushConfig): Promise<PushProvider>
function alertPayload(opts: {
  title: string; body: string; subtitle?: string; badge?: number; sound?: string;
  category?: string; threadId?: string;
  interruptionLevel?: "passive" | "active" | "time-sensitive" | "critical";
  relevanceScore?: number; mutableContent?: boolean; data?: Record<string, string>;
}): APNsPayload
function criticalAlertPayload(opts: {
  title: string; body: string; soundName?: string; volume?: number; data?: Record<string, string>;
}): APNsPayload
function liveActivityPayload(opts: {
  event: "update" | "end"; contentState: Record<string, unknown>; timestamp: number;
  dismissalDate?: number; alert?: { title: string; body: string }; sound?: string;
}): APNsPayload
```

---

## chat

In-app support chat with WebSocket real-time delivery and push fallback.

### DB Interface

```typescript
interface ChatDB {
  /** Returns messages ordered by created_at DESC (newest first). */
  getChatMessages(userId: string, limit: number, offset: number): Promise<ChatMessage[]>;
  getChatMessagesSince(userId: string, sinceId: number): Promise<ChatMessage[]>;
  sendChatMessage(userId: string, sender: string, message: string, messageType: string): Promise<ChatMessage>;
  markChatRead(userId: string, reader: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;
  adminListChatThreads(limit: number): Promise<ChatThread[]>;
  enabledDeviceTokens(userId: string): Promise<string[]>;
}
```

### Types

```typescript
interface ChatMessage {
  id: number;
  user_id: string;
  sender: string;
  message: string;
  message_type: string;
  read_at: string | null;
  created_at: Date | string;
}

interface ChatThread {
  user_id: string;
  user_name: string;
  user_email: string;
  last_message: string;
  last_sender: string;
  unread_count: number;
  last_message_at: string;
}

interface ChatConfig {
  parseToken: (token: string) => Promise<string>;
  adminAuth?: (req: Request) => boolean | Promise<boolean>;
  adminDisplayName?: string;   // default: "Support" — used in push notification titles
}

interface WSConn { /* WebSocket connection wrapper */ }
class Hub { /* WebSocket connection hub for real-time delivery */ }

interface WSEvent {
  type: string;
  payload?: unknown;
}
```

### Service

```typescript
class ChatService {
  constructor(db: ChatDB, push: PushProvider, cfg: ChatConfig)
  handleGetChat: (c: Context) => Promise<Response>          // GET  /api/v1/chat
  handleSendChat: (c: Context) => Promise<Response>         // POST /api/v1/chat
  handleUnreadCount: (c: Context) => Promise<Response>      // GET  /api/v1/chat/unread
  handleAdminListChats: (c: Context) => Promise<Response>   // GET  /admin/api/chat
  handleAdminGetChat: (c: Context) => Promise<Response>     // GET  /admin/api/chat/:user_id
  handleAdminReplyChat: (c: Context) => Promise<Response>   // POST /admin/api/chat/:user_id
  handleWSConnection(ws: WebSocket, userId: string, role: "user" | "admin"): () => void
  getHub(): Hub
}
```

---

## email

Email sending interface with template rendering. Interface-only — implement your own provider (e.g. SMTP via nodemailer, SES, Resend).

### Types

```typescript
interface EmailProvider {
  send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>;
}

interface SMTPConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  from: string;
  fromName?: string;
}

interface EmailTemplate {
  subject: string;
  html?: string;
  text?: string;
}
```

### Service

```typescript
class LogProvider implements EmailProvider { /* logs to console */ }
class NoopProvider implements EmailProvider { /* no-op */ }

class Renderer {
  register(name: string, template: EmailTemplate): void
  render(name: string, data: Record<string, string>): { subject: string; html: string; text: string }
}
```

---

## sync

Offline-first delta sync with version-based conflict detection, idempotency, and silent push.

### DB Interface

```typescript
interface SyncDB {
  serverTime(): Promise<Date | string>;
  tombstones(userId: string, since: Date | string): Promise<DeletedEntry[]>;
  recordTombstone(userId: string, entityType: string, entityId: string): Promise<void>;
}

interface EntityHandler {
  changedSince(userId: string, since: Date | string, excludeDeviceId: string): Promise<Record<string, unknown>>;
  batchUpsert(userId: string, deviceId: string, items: BatchItem[]): Promise<{ items: BatchResponseItem[]; errors: BatchError[] }>;
  delete(userId: string, entityType: string, entityId: string): Promise<void>;
}

interface DeviceTokenStore {
  enabledTokensForUser(userId: string): Promise<DeviceInfo[]>;
}
```

### Types

```typescript
interface DeletedEntry {
  entity_type: string;
  entity_id: string;
  deleted_at: Date | string;
}

interface BatchItem {
  client_id: string;
  entity_type: string;
  entity_id?: string;
  version: number;
  fields: Record<string, unknown>;
}

interface BatchResponseItem {
  client_id: string;
  server_id: string;
  version: number;
}

interface BatchError {
  client_id: string;
  error: string;
  is_conflict?: boolean;
  server_version?: number;
}

interface BatchResponse {
  items: BatchResponseItem[];
  errors: BatchError[];
  synced_at: Date | string;
}

interface DeviceInfo {
  deviceId: string;
  token: string;
}

interface SyncConfig {
  push?: PushProvider;
  deviceTokens?: DeviceTokenStore;
  idempotencyTtlMs?: number;  // default: 24h
}
```

### Service

```typescript
class SyncService {
  constructor(db: SyncDB, handler: EntityHandler, cfg?: SyncConfig)
  close(): void
  handleSyncChanges: (c: Context) => Promise<Response>   // GET    /api/v1/sync/changes
  handleSyncBatch: (c: Context) => Promise<Response>     // POST   /api/v1/sync/batch
  handleSyncDelete: (c: Context) => Promise<Response>    // DELETE /api/v1/sync/:entity_type/:id
}
```

---

## storage

Object storage interface. Interface-only — implement with S3, R2, GCS, or any provider.

### Types

```typescript
interface StorageProvider {
  configured(): boolean;
  put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string }>;
}

interface StorageConfig {
  region?: string;
  bucket: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}
```

### Service

```typescript
class NoopStorageProvider implements StorageProvider {
  configured(): boolean   // returns false
  put(): Promise<void>    // throws "storage not configured"
  get(): Promise<...>     // throws "storage not configured"
}
```

---

## receipt

StoreKit 2 server-side receipt verification with JWS chain-of-trust validation and App Store Server Notifications V2 webhook.

### DB Interface

```typescript
interface ReceiptDB {
  upsertSubscription(userId: string, productId: string, originalTransactionId: string, status: string, expiresAt: Date | string | null, priceCents: number, currencyCode: string): Promise<void>;
  userIdByTransactionId(originalTransactionId: string): Promise<string>;
  storeTransaction(t: VerifiedTransaction): Promise<void>;
}
```

### Types

```typescript
interface TransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate: number;
  expiresDate: number;
  type: string;
  inAppOwnershipType: string;
  environment: string;
  price: number;
  currency: string;
  offerType?: number;
  revocationDate?: number;
  appAccountToken?: string;
}

interface VerifiedTransaction {
  transaction_id: string;
  original_transaction_id: string;
  user_id: string;
  product_id: string;
  status: string;
  purchase_date: Date | string;
  expires_date: Date | string | null;
  environment: string;
  price_cents: number;
  currency_code: string;
  notification_type?: string;
}

interface VerifyResponse {
  verified: boolean;
  status: string;
  product_id: string;
  transaction_id: string;
  expires_at: Date | null;
}

interface ReceiptConfig {
  bundleId?: string;
  environment?: string;
  priceToCents?: (priceMilliunits: number, currency: string) => number;
}

/** All possible subscription status strings. */
const SUBSCRIPTION_STATUSES: readonly ["active", "expired", "cancelled", "trial", "free", "refunded", "revoked", "grace_period", "billing_retry_failed", "price_increase_pending"]
type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number]
```

### Service

```typescript
class ReceiptService {
  constructor(db: ReceiptDB, cfg: ReceiptConfig)
  handleVerifyReceipt: (c: Context) => Promise<Response>   // POST /api/v1/receipt/verify
  handleWebhook: (c: Context) => Promise<Response>         // POST /api/v1/receipt/webhook
}
```

### Webhook Notification Types Handled

`SUBSCRIBED`, `DID_RENEW`, `EXPIRED`, `REFUND`, `REVOKE`, `DID_CHANGE_RENEWAL_STATUS`, `DID_FAIL_TO_RENEW`, `GRACE_PERIOD_EXPIRED`, `OFFER_REDEEMED`, `PRICE_INCREASE`, `RENEWAL_EXTENDED`, `REFUND_DECLINED`, `REFUND_REVERSED`, `TEST`

---

## appstore

App Store Server API v2 client for server-to-server operations (transaction history, subscription management, notification replay).

### Types

```typescript
interface AppStoreConfig {
  privateKey: string;                          // path to .p8 file or PEM string
  keyId: string;                               // from App Store Connect
  issuerId: string;                            // your team's UUID
  bundleId: string;
  environment?: "sandbox" | "production";      // default: "production"
}

interface TransactionHistoryResponse {
  signedTransactions: string[];
  revision: string;
  hasMore: boolean;
  bundleId: string;
  environment: string;
}

interface SubscriptionStatusResponse {
  data: SubscriptionGroupStatus[];
  bundleId: string;
  environment: string;
}

interface SubscriptionGroupStatus {
  subscriptionGroupIdentifier: string;
  lastTransactions: LastTransaction[];
}

interface LastTransaction {
  originalTransactionId: string;
  status: number;
  signedTransactionInfo: string;
  signedRenewalInfo: string;
}

interface NotificationHistoryResponse {
  notificationHistory: NotificationHistoryEntry[];
  hasMore: boolean;
  paginationToken?: string;
}

interface NotificationHistoryEntry {
  signedPayload: string;
  sendAttempts: SendAttempt[];
}

interface SendAttempt {
  attemptDate: number;
  sendAttemptResult: string;
}

interface OrderLookupResponse {
  status: number;
  signedTransactions: string[];
}

interface ExtendSubscriptionResponse {
  requestIdentifier: string;
}

interface MassExtendResponse {
  requestIdentifier: string;
}

/** StoreKit 2 subscription status codes. */
const SUBSCRIPTION_STATUS_CODES: { 1: "active"; 2: "expired"; 3: "billing_retry"; 4: "grace_period"; 5: "revoked" }
```

### Service

```typescript
class AppStoreServerClient {
  constructor(cfg: AppStoreConfig)
  async getTransactionHistory(transactionId: string, opts?: {
    revision?: string; sort?: "ASCENDING" | "DESCENDING"; productTypes?: string[];
  }): Promise<TransactionHistoryResponse>
  async getAllTransactionHistory(transactionId: string, opts?: {
    sort?: "ASCENDING" | "DESCENDING"; productTypes?: string[];
  }): Promise<string[]>
  async getSubscriptionStatuses(transactionId: string): Promise<SubscriptionStatusResponse>
  async extendSubscription(originalTransactionId: string, extendByDays: number, extendReasonCode: 0 | 1 | 2 | 3, requestIdentifier: string): Promise<ExtendSubscriptionResponse>
  async massExtendSubscriptions(productId: string, extendByDays: number, extendReasonCode: 0 | 1 | 2 | 3, requestIdentifier: string): Promise<MassExtendResponse>
  async getNotificationHistory(startDate: Date, endDate: Date, opts?: {
    paginationToken?: string; notificationType?: string; notificationSubtype?: string;
  }): Promise<NotificationHistoryResponse>
  async lookupOrder(orderId: string): Promise<OrderLookupResponse>
  async requestTestNotification(): Promise<{ testNotificationToken: string }>
  async getTestNotificationStatus(testNotificationToken: string): Promise<{ signedPayload: string; sendAttempts: SendAttempt[] }>
}

class AppStoreError extends Error {
  readonly statusCode: number;
  readonly body: string;
}
```

---

## paywall

Server-driven paywall content with locale fallback and versioning.

### Types

```typescript
interface Feature {
  emoji: string;
  color: string;
  text: string;
  bold: string;
}

interface Review {
  title: string;
  username: string;
  time_label: string;
  description: string;
  rating: number;
}

interface PaywallConfig {
  headline: string;
  headline_accent: string;
  subtitle: string;
  member_count: string;
  rating: string;
  features: Feature[];
  reviews: Review[];
  footer_text: string;
  trial_text: string;
  cta_text: string;
  version: number;
}
```

### Service

```typescript
class PaywallStore {
  constructor(initial?: Record<string, PaywallConfig>)
  get(locale: string): PaywallConfig | null
  set(locale: string, config: PaywallConfig): void
}
```

### Functions

```typescript
function handleGetConfig(store: PaywallStore): (c: Context) => Promise<Response>      // GET /api/v1/paywall/config
function handleUpdateConfig(store: PaywallStore): (c: Context) => Promise<Response>   // PUT /admin/api/paywall/config
```

---

## attest

Apple App Attest device verification with CBOR attestation parsing, certificate chain validation, and assertion signature verification.

### DB Interface

```typescript
interface AttestDB {
  storeAttestKey(userId: string, keyId: string, publicKey: string): Promise<void>;
  getAttestKey(userId: string): Promise<{ keyId: string; publicKey: string }>;
  storeChallenge(nonce: string, userId: string, expiresAt: Date): Promise<void>;
  consumeChallenge(nonce: string, userId: string): Promise<boolean>;
}
```

### Types

```typescript
interface AttestConfig {
  appId?: string;             // Apple App ID (teamId.bundleId)
  challengeTtlSec?: number;   // default: 300 (5 minutes)
  production?: boolean;
}
```

### Service

```typescript
class AttestService {
  constructor(db?: AttestDB, cfg?: AttestConfig)
  generateHexNonce(): string
  handleChallenge: (c: Context) => Promise<Response>                 // POST /api/v1/attest/challenge
  handleVerify: (c: Context) => Promise<Response>                    // POST /api/v1/attest/verify
  handleAssert: (c: Context) => Promise<Response>                    // POST /api/v1/attest/assert
  requireAttest: (c: Context, next: () => Promise<void>) => Promise<Response>  // middleware
}
```

---

## account

Account deletion, anonymization, and GDPR data export.

### DB Interface

```typescript
interface AccountDB {
  getUserEmail(userId: string): Promise<string>;
  deleteUserData(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  anonymizeUser(userId: string): Promise<void>;
  exportUserData(userId: string): Promise<UserDataExport>;
  /** Optional transaction wrapper — if provided, account deletion runs atomically. */
  withTransaction?<T>(fn: () => Promise<T>): Promise<T>;
}
```

### Types

```typescript
interface AppCleanup {
  deleteAppData(userId: string): Promise<void>;
}

interface AppExporter {
  exportAppData(userId: string): Promise<unknown>;
}

interface UserDataExport {
  user: unknown;
  subscription?: unknown;
  events?: unknown;
  sessions?: unknown;
  feedback?: unknown;
  chat_messages?: unknown;
  device_tokens?: unknown;
  notification_preferences?: unknown;
  transactions?: unknown;
  app_data?: unknown;
}

interface AccountConfig {
  onDelete?: (userId: string, email: string) => void;
}
```

### Service

```typescript
class AccountService {
  constructor(cfg: AccountConfig, db: AccountDB, opts?: { cleanup?: AppCleanup; exporter?: AppExporter })
  handleDeleteAccount: (c: Context) => Promise<Response>      // DELETE /api/v1/account
  handleAnonymizeAccount: (c: Context) => Promise<Response>   // POST   /api/v1/account/anonymize
  handleExportData: (c: Context) => Promise<Response>         // GET    /api/v1/account/export
}
```

---

## flags

Feature flags with percentage rollout, per-user overrides, typed values, and optional in-memory cache.

### DB Interface

```typescript
interface FlagsDB {
  upsertFlag(flag: Flag): Promise<void>;
  getFlag(key: string): Promise<Flag | null>;
  listFlags(): Promise<Flag[]>;
  deleteFlag(key: string): Promise<void>;
  getUserOverride(key: string, userId: string): Promise<boolean | null>;
  setUserOverride(key: string, userId: string, enabled: boolean): Promise<void>;
  deleteUserOverride(key: string, userId: string): Promise<void>;
  /** Optional: fetch multiple flags in one query. Falls back to sequential getFlag if not provided. */
  getFlags?(keys: string[]): Promise<Flag[]>;
}
```

### Types

```typescript
interface Flag {
  key: string;
  enabled: boolean;
  rollout_pct: number;
  description: string;
  value?: string | null;                                        // typed value (string, number, or JSON)
  value_type?: "boolean" | "string" | "number" | "json";
  created_at: Date;
  updated_at: Date;
}

interface FlagsConfig {
  cacheTtlMs?: number;  // in-memory cache TTL in ms (default: 0 = no cache)
}
```

### Service

```typescript
class FlagsService {
  constructor(db: FlagsDB, cfg?: FlagsConfig)
  async isEnabled(key: string, userId: string): Promise<boolean>
  async getValue(key: string, userId: string): Promise<string | number | Record<string, unknown> | null>
  invalidate(key: string): void
  clearCache(): void
  handleCheck: (c: Context) => Promise<Response>                  // GET    /api/v1/flags/:key
  handleBatchCheck: (c: Context) => Promise<Response>             // POST   /api/v1/flags/check
  handleAdminList: (c: Context) => Promise<Response>              // GET    /admin/api/flags
  handleAdminCreate: (c: Context) => Promise<Response>            // POST   /admin/api/flags
  handleAdminUpdate: (c: Context) => Promise<Response>            // PUT    /admin/api/flags/:key
  handleAdminDelete: (c: Context) => Promise<Response>            // DELETE /admin/api/flags/:key (returns 404 for missing)
  handleAdminSetOverride: (c: Context) => Promise<Response>       // POST   /admin/api/flags/:key/overrides
  handleAdminDeleteOverride: (c: Context) => Promise<Response>    // DELETE /admin/api/flags/:key/overrides/:user_id
}
```

---

## lifecycle

User lifecycle stage classification, engagement scoring with configurable weights, and contextual prompts with fatigue prevention.

### DB Interface

```typescript
interface LifecycleDB {
  userCreatedAndLastActive(userId: string): Promise<{ createdAt: Date | string; lastActiveAt: Date | string }>;
  countSessions(userId: string): Promise<number>;
  countRecentSessions(userId: string, since: Date | string): Promise<number>;
  countDistinctEventDays(userId: string, eventName: string, since: Date | string): Promise<number>;
  isProUser(userId: string): Promise<boolean>;
  lastPrompt(userId: string): Promise<{ promptType: string; promptAt: Date | string } | null>;
  countPrompts(userId: string, promptType: string, since: Date | string): Promise<number>;
  recordPrompt(userId: string, event: string, metadata: string): Promise<void>;
  enabledDeviceTokens(userId: string): Promise<string[]>;
}
```

### Types

```typescript
type Stage = "new" | "activated" | "engaged" | "monetized" | "loyal" | "at_risk" | "dormant" | "churned";
type PromptType = "review" | "paywall" | "winback" | "milestone";

interface AhaMomentRule {
  name: string;
  description: string;
  eventName: string;
  threshold: number;
  windowDays: number;
}

interface EngagementScore {
  user_id: string;
  stage: Stage;
  score: number;
  days_since_active: number;
  total_sessions: number;
  aha_reached: boolean;
  is_pro: boolean;
  created_days_ago: number;
  prompt?: Prompt | null;
}

interface Prompt {
  type: PromptType;
  title: string;
  body: string;
  reason: string;
}

interface StageContext {
  score: number;
  daysSinceActive: number;
  createdDaysAgo: number;
  ahaReached: boolean;
  isPro: boolean;
}

interface StageRule {
  name: string;
  stage: Stage;
  matches: (ctx: StageContext) => boolean;
}

interface ScoreWeights {
  recentSessionsMax?: number;          // default: 40
  recentSessionsPerSession?: number;   // default: 6
  ahaBonus?: number;                   // default: 20
  proBonus?: number;                   // default: 20
  activeTodayBonus?: number;           // default: 10
  activeRecentBonus?: number;          // default: 5
  totalSessionsMax?: number;           // default: 10
  totalSessionsDivisor?: number;       // default: 3
}

interface LifecycleConfig {
  ahaMomentRules?: AhaMomentRule[];
  customStages?: StageRule[];
  promptBuilder?: (userId: string, es: EngagementScore) => Promise<Prompt | null>;
  promptCooldownDays?: number;                    // default: 3
  maxPromptsPerType?: Record<PromptType, number>; // per 30-day window
  scoreWeights?: ScoreWeights;
}
```

### Service

```typescript
class LifecycleService {
  constructor(cfg: LifecycleConfig, db: LifecycleDB, push: PushProvider)
  async evaluateUser(userId: string): Promise<EngagementScore>
  calculateScore(recentSessions: number, ahaReached: boolean, isPro: boolean, daysSinceActive: number, totalSessions: number): number
  async evaluateNotifications(userIds: string[]): Promise<void>
  handleGetLifecycle: (c: Context) => Promise<Response>   // GET  /api/v1/user/lifecycle
  handleAckPrompt: (c: Context) => Promise<Response>      // POST /api/v1/user/lifecycle/ack
}
```

---

## analytics

Admin analytics dashboards (DAU, events, MRR, summary, retention, revenue).

### DB Interface

```typescript
interface AnalyticsDB {
  dauTimeSeries(since: Date | string): Promise<DAURow[]>;
  eventCounts(since: Date | string, event?: string): Promise<EventRow[]>;
  subscriptionBreakdown(): Promise<SubStats[]>;
  newSubscriptions30d(): Promise<number>;
  churnedSubscriptions30d(): Promise<number>;
  dauToday(): Promise<number>;
  mau(): Promise<number>;
  totalUsers(): Promise<number>;
  activeSubscriptions(): Promise<number>;
  mrrCents?(): Promise<number>;
  revenueSeries?(since: Date | string): Promise<RevenueRow[]>;
  retentionCohort?(cohortSince: Date | string, days: number[]): Promise<RetentionRow[]>;
  trialConversionRate?(since: Date | string): Promise<number>;
}
```

### Types

```typescript
interface DAURow { date: string; dau: number; }
interface EventRow { date: string; event: string; count: number; unique_users: number; }
interface SubStats { status: string; count: number; }
interface RevenueRow { date: string; revenue_cents: number; }
interface RetentionRow { cohort_date: string; day: number; retained_pct: number; users: number; }
```

### Service

```typescript
class AnalyticsService {
  constructor(db: AnalyticsDB)
  handleDAU: (c: Context) => Promise<Response>         // GET /admin/api/analytics/dau
  handleEvents: (c: Context) => Promise<Response>      // GET /admin/api/analytics/events
  handleMRR: (c: Context) => Promise<Response>         // GET /admin/api/analytics/mrr (includes mrr_cents when available)
  handleSummary: (c: Context) => Promise<Response>     // GET /admin/api/analytics/summary (includes trial_conversion_rate when available)
  handleRetention: (c: Context) => Promise<Response>   // GET /admin/api/analytics/retention
  handleRevenue: (c: Context) => Promise<Response>     // GET /admin/api/analytics/revenue
}
```

---

## app

Hono app factory that wires all services and middleware into a single router.

### Types

```typescript
interface AppConfig {
  apiVersion: string;
  minimumVersion: string;
  corsOrigins?: string;
  apiPrefix?: string;    // default: "/api/v1"
  adminPrefix?: string;  // default: "/admin/api"
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
  maxBodySize?: number;       // default: 1MB
  scheduler?: Scheduler;
  notifyScheduler?: NotifyScheduler;
}

interface AppResources {
  app: Hono;
  /** Clean up rate limiters, schedulers, intervals. */
  shutdown(): void;
}
```

### Functions

```typescript
function createApp(cfg: AppConfig): AppResources
function openApiSpec(): Record<string, unknown>
```

### Routes Wired

**Auth** (always mounted):
- `POST /api/v1/auth/apple` — mobile Sign in with Apple
- `POST /api/v1/auth/apple/web` — web Sign in with Apple (OAuth2 code exchange)
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all` — revoke all sessions
- `GET /api/v1/auth/sessions` — list active sessions
- `DELETE /api/v1/auth/sessions/:jti` — revoke specific session

**Flags** (when `flags` provided):
- `GET /api/v1/flags/:key`
- `POST /api/v1/flags/check`
- `GET /admin/api/flags`
- `POST /admin/api/flags`
- `PUT /admin/api/flags/:key`
- `DELETE /admin/api/flags/:key`
- `POST /admin/api/flags/:key/overrides`
- `DELETE /admin/api/flags/:key/overrides/:user_id`

**Analytics** (when `analytics` provided):
- `GET /admin/api/analytics/dau`
- `GET /admin/api/analytics/events`
- `GET /admin/api/analytics/mrr`
- `GET /admin/api/analytics/summary`
- `GET /admin/api/analytics/retention`
- `GET /admin/api/analytics/revenue`
