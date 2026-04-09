# Donkey-Swift — Package API Catalog

Framework-agnostic TypeScript services for iOS app backends. Pure business logic — no HTTP framework dependency.

## errors

Typed errors thrown by services. Map to HTTP status codes in your route handlers.

### Functions

```typescript
class ServiceError extends Error { code: string }
class ValidationError extends ServiceError {}    // 400
class UnauthorizedError extends ServiceError {}  // 401
class ForbiddenError extends ServiceError {}     // 403
class NotFoundError extends ServiceError {}      // 404
class ConflictError extends ServiceError {}      // 409
class RateLimitError extends ServiceError {}     // 429
class NotConfiguredError extends ServiceError {} // 501
```

### Functions

```typescript
function errorToStatus(err: ServiceError): number
```

---

## middleware

Framework-agnostic utilities for rate limiting, token extraction, and request ID generation. No HTTP framework dependency.

### Functions

```typescript
class RateLimiter {
  constructor(rate: number, windowMs: number)
  allow(key: string): boolean
  destroy(): void
}
```

### Functions

```typescript
/** Extract Bearer token from Authorization header value. */
function extractBearerToken(authorizationHeader?: string): string | undefined

/** Constant-time string comparison for secrets/API keys. */
function safeEqual(a: string, b: string): boolean

/** Generate or pass through a request ID (UUID). */
function resolveRequestId(existing?: string): string
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

### Functions

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

### Functions

```typescript
class HealthService {
  constructor(cfg: HealthConfig)
  health(): { status: string }
  async ready(): Promise<{ status: string; checks: Record<string, string> }>
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

## logging

Structured JSON logging plus durable diagnostics persistence hooks for backend APIs and mobile clients.

### Types

```typescript
type LogLevel = "debug" | "info" | "warn" | "error"
type LogFields = Record<string, string | number | boolean | null | undefined | string[] | number[] | boolean[] | Record<string, unknown> | Array<Record<string, unknown>>>

interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

type DiagnosticEventType = "error" | "crash" | "performance" | "lifecycle"

interface DiagnosticBreadcrumb {
  ts?: Date | string
  level?: LogLevel
  category: string
  message: string
  metadata?: Record<string, unknown> | null
}

interface DiagnosticEventRecord {
  source: "server" | "client"
  eventType?: DiagnosticEventType
  level?: LogLevel
  category: string
  message: string
  stack?: string | null
  userId?: string | null
  path?: string | null
  method?: string | null
  requestId?: string | null
  sessionId?: string | null
  installationId?: string | null
  appVersion?: string | null
  appBuild?: string | null
  language?: string | null
  deviceModel?: string | null
  osVersion?: string | null
  platform?: string | null
  breadcrumbs?: DiagnosticBreadcrumb[] | null
  metadata?: Record<string, unknown> | null
  createdAt?: Date | string
}

interface DiagnosticsDB {
  saveDiagnosticEvent(report: DiagnosticEventRecord): Promise<void>
}
```

### Functions

```typescript
function createLogger(options?: {
  minLevel?: LogLevel
  baseFields?: LogFields
  writer?: (line: string, level: LogLevel) => void
}): Logger

function serializeError(error: unknown): Record<string, unknown>

class ErrorReportingService {
  constructor(db: DiagnosticsDB)
  report(record: DiagnosticEventRecord): Promise<void>
  submitClientReport(
    report: {
      type?: DiagnosticEventType
      level?: LogLevel
      category: string
      message: string
      stack?: string | null
      session_id?: string | null
      installation_id?: string | null
      app_version?: string | null
      app_build?: string | null
      language?: string | null
      device_model?: string | null
      os_version?: string | null
      platform?: string | null
      breadcrumbs?: DiagnosticBreadcrumb[] | null
      metadata?: Record<string, unknown> | null
    },
    ctx?: {
      userId?: string | null
      path?: string | null
      method?: string | null
      requestId?: string | null
    },
  ): Promise<void>
}

class DiagnosticsService {
  constructor(db: DiagnosticsDB)
  report(record: DiagnosticEventRecord): Promise<void>
  submitClientEvent(report: Parameters<ErrorReportingService["submitClientReport"]>[0], ctx?: Parameters<ErrorReportingService["submitClientReport"]>[1]): Promise<void>
}
```

---

## logbuf

Ring-buffer log capture for admin panels.

### Functions

```typescript
class LogBuffer {
  constructor(capacity: number)
  write(text: string): void
  getLines(n?: number): string[]
  queryLogs(opts?: { limit?: number; filter?: string }): { lines: string[]; count: number }
}
```

### Functions

```typescript
function setupLogCapture(buf: LogBuffer): () => void
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

### Functions

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
  sessionDB?: SessionDB;           // optional server-side session store
  appleClientSecret?: string;      // JWT for Sign in with Apple web flow
  appleRedirectUri?: string;       // redirect URI for Apple web flow
}
```

### Functions

```typescript
class AuthService {
  constructor(cfg: AuthConfig, db: AuthDB)
  async verifyAppleIdToken(tokenString: string): Promise<{ sub: string; email: string; emailVerified: boolean }>
  async createSessionToken(userId: string): Promise<string>
  async parseSessionToken(tokenStr: string): Promise<string>
  async authenticateWithApple(identityToken: string, name?: string): Promise<{ token: string; user: User }>
  async authenticateWithWeb(code: string, name?: string): Promise<{ token: string; user: User }>
  async getUser(userId: string): Promise<User>
  async logout(sessionToken?: string): Promise<void>
  async logoutAll(userId: string): Promise<void>
  async listSessions(userId: string): Promise<Array<{ jti: string; createdAt: Date | string }>>
  async revokeSession(jti: string): Promise<void>
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
  current_streak: number;
  subscription_status: string;
  /** App-specific metrics. Apps put their domain data here. */
  metrics: Record<string, number>;
}

type EventHook = (userId: string, events: EventInput[]) => void;

interface EngageConfig {
  paywallTrigger?: (data: EngagementData) => string;
}
```

### Functions

```typescript
class EngageService {
  constructor(cfg: EngageConfig, db: EngageDB)
  registerEventHook(hook: EventHook): void
  async trackEvents(userId: string, events: Array<{ event: string; metadata?: unknown; timestamp?: string }>): Promise<{ tracked: number }>
  async updateSubscription(userId: string, input: { product_id?: string; status?: string; expires_at?: string; original_transaction_id?: string; price_cents?: number; currency_code?: string }): Promise<UserSubscription | { status: string }>
  async reportSession(userId: string, input: { session_id: string; action: "start" | "end"; app_version?: string; os_version?: string; country?: string; duration_s?: number }): Promise<{ status: string }>
  async getEligibility(userId: string): Promise<{ paywall_trigger: string | null; days_active: number; current_streak: number; is_pro: boolean; metrics: Record<string, number> }>
  async submitFeedback(userId: string, input: { type?: string; message: string; app_version?: string }): Promise<{ status: string }>
}
```

### Functions

```typescript
const VALID_STATUSES: Set<string>
const VALID_FEEDBACK_TYPES: Set<string>
function examplePaywallTrigger(data: EngagementData): string
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
  recordNotificationDelivery(userId: string, kind: string, title: string, body: string): Promise<string>;
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
  apns_topic?: string;           // APNs topic override (e.g. for watchOS)
  apns_environment?: string;     // "production" | "sandbox" — backend routes pushes accordingly
  build_channel?: string;        // "debug" | "testflight" | "appstore" — env-scoped delivery + diagnostics
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

### Functions

```typescript
class NotifyService {
  constructor(db: NotifyDB, push: PushProvider)
  async registerDevice(userId: string, input: { token: string; platform?: string; device_model?: string; os_version?: string; app_version?: string; apns_topic?: string; apns_environment?: string; build_channel?: string }): Promise<{ status: string }>
  async disableDevice(userId: string, token: string): Promise<{ status: string }>
  async getPreferences(userId: string): Promise<NotificationPreferences>
  async updatePreferences(userId: string, input: Partial<{ push_enabled: boolean; interval_seconds: number; wake_hour: number; sleep_hour: number; timezone: string; stop_after_goal: boolean }>): Promise<NotificationPreferences>
  async sendNotification(userId: string, kind: string, title: string, body: string, extraData?: Record<string, string>): Promise<{ notificationId: string }>
  async trackOpened(userId: string, notificationId: string): Promise<void>
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

### Functions

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

### Functions

```typescript
class ChatService {
  constructor(db: ChatDB, push: PushProvider, cfg: ChatConfig)
  async getMessages(userId: string, opts?: { since_id?: number; limit?: number; offset?: number }): Promise<{ messages: ChatMessage[]; has_more: boolean }>
  async sendMessage(userId: string, message: string, messageType?: string): Promise<{ status: string; id: number; created_at: Date | string }>
  async getUnreadCount(userId: string): Promise<{ count: number }>
  async adminListChats(limit?: number): Promise<{ threads: ChatThread[]; count: number }>
  async adminGetMessages(userId: string, limit?: number, offset?: number): Promise<{ messages: ChatMessage[] }>
  async adminReply(userId: string, message: string, messageType?: string): Promise<{ status: string; id: number; created_at: Date | string }>
  handleWSConnection(ws: WebSocket, userId: string, role: "user" | "admin"): () => void
  getHub(): Hub
}
```

---

## email

Email sending with SMTP transport and template rendering.

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

### Functions

```typescript
class SMTPProvider implements EmailProvider {
  constructor(cfg: SMTPConfig)
  async send(to: string, subject: string, textBody: string, htmlBody?: string): Promise<void>
}

class LogProvider implements EmailProvider { /* logs to console */ }
class NoopProvider implements EmailProvider { /* no-op */ }

class Renderer {
  register(name: string, template: EmailTemplate): void
  render(name: string, data: Record<string, string>): { subject: string; html: string; text: string }
}
```

### Functions

```typescript
function newProvider(cfg: Partial<SMTPConfig>): EmailProvider
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
  apnsTopic?: string;   // APNs topic override (e.g. for watchOS)
}

interface SyncConfig {
  push?: PushProvider;
  deviceTokens?: DeviceTokenStore;
  idempotencyTtlMs?: number;  // default: 24h
  pushDebounceMs?: number;    // default: 2500ms, 0 = no debounce
}
```

### Functions

```typescript
class SyncService {
  constructor(db: SyncDB, handler: EntityHandler, cfg?: SyncConfig)
  close(): void
  async getChanges(userId: string, opts?: { since?: string; deviceId?: string }): Promise<Record<string, unknown>>
  async syncBatch(userId: string, items: BatchItem[], opts?: { deviceId?: string; idempotencyKey?: string }): Promise<BatchResponse>
  async deleteEntity(userId: string, entityType: string, entityId: string, deviceId?: string): Promise<{ status: string }>
  notifyOtherDevices(userId: string, excludeDeviceId?: string): void
}
```

---

## storage

S3-compatible object storage client.

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

### Functions

```typescript
class StorageClient implements StorageProvider {
  constructor(cfg: StorageConfig)
  configured(): boolean
  async put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>
  async get(key: string): Promise<{ data: Uint8Array; contentType: string }>
}

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

### Functions

```typescript
class ReceiptService {
  constructor(db: ReceiptDB, cfg: ReceiptConfig)
  async verifyReceipt(userId: string, transactionJWS: string): Promise<VerifyResponse>
  async processWebhook(signedPayload: string): Promise<{ status: string }>
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

### Functions

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

### Functions

```typescript
class PaywallStore {
  constructor(initial?: Record<string, PaywallConfig>)
  get(locale: string): PaywallConfig | null
  set(locale: string, config: PaywallConfig): void
}
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

### Functions

```typescript
class AttestService {
  constructor(db?: AttestDB, cfg?: AttestConfig)
  generateHexNonce(): string
  async createChallenge(userId: string): Promise<{ nonce: string }>
  async verifyAttestation(userId: string, input: { key_id: string; attestation: string; nonce: string }): Promise<{ status: string }>
  async verifyAssertion(userId: string, input: { assertion: string; client_data?: string; nonce: string }): Promise<{ status: string }>
  async checkAttestation(userId: string): Promise<void>
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

### Functions

```typescript
class AccountService {
  constructor(cfg: AccountConfig, db: AccountDB, opts?: { cleanup?: AppCleanup; exporter?: AppExporter })
  async deleteAccount(userId: string): Promise<{ status: string }>
  async anonymizeAccount(userId: string): Promise<{ status: string }>
  async exportData(userId: string): Promise<UserDataExport>
}
```

---

## flags

Feature flags with a rule-based targeting engine. Supports AND/OR condition trees, deterministic percentage rollout, per-user overrides, weighted A/B variants, and typed values. Optional in-memory cache and exposure hook for analytics.

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

The DB implementation must round-trip `rules`, `variants`, and `default_value` as JSON
columns (e.g. `jsonb` in Postgres) so the targeting engine can read them back.

### Types

```typescript
type FlagJsonValue =
  | string | number | boolean | null
  | FlagJsonValue[]
  | { [key: string]: FlagJsonValue };

interface Flag {
  key: string;
  enabled: boolean;              // global kill switch
  rollout_pct: number;           // legacy — used only when rules is empty
  description: string;
  value?: string | null;         // v1 typed value
  value_type?: "boolean" | "string" | "number" | "json";
  default_value?: FlagJsonValue; // served when no rule matches (v2)
  rules?: FlagRule[];            // ordered — first match wins (v2)
  variants?: Variant[];          // named variant catalog (v2)
  created_at: Date;
  updated_at: Date;
}

interface FlagContext {
  userId: string;                // required — used for deterministic bucketing
  appVersion?: string;           // semver
  appBuild?: string;
  platform?: "ios" | "android" | "web";
  deviceModel?: string;
  osVersion?: string;
  locale?: string;
  country?: string;
  email?: string;
  isPro?: boolean;
  userCreatedAt?: Date | string;
  custom?: Record<string, string | number | boolean>;
}

type Condition =
  | { op: "and" | "or"; children: Condition[] }
  | { op: "not"; child: Condition }
  | { op: "eq" | "neq"; attr: string; value: string | number | boolean }
  | { op: "in" | "nin"; attr: string; values: Array<string | number> }
  | { op: "gt" | "gte" | "lt" | "lte"; attr: string; value: number }
  | { op: "matches"; attr: string; pattern: string }      // regex
  | { op: "semver_gte" | "semver_lt"; attr: string; value: string }
  | { op: "percentage"; pct: number; seed?: string };     // 0-100, 0.01% precision

type FlagServe =
  | { kind: "value"; value: FlagJsonValue }
  | { kind: "variant"; variant: string }
  | { kind: "variants"; variants: Variant[] };            // weighted A/B split

interface FlagRule {
  id: string;
  description?: string;
  condition: Condition;
  serve: FlagServe;
}

interface Variant {
  key: string;
  value: FlagJsonValue;
  weight: number;                // integer; buckets are weight / sum(weights)
}

interface EvaluationResult {
  value: FlagJsonValue;
  matched: boolean;
  ruleId?: string;
  variantKey?: string;
}

interface FlagsConfig {
  cacheTtlMs?: number;           // in-memory cache TTL in ms (default: 0 = no cache)
  onExposure?: (ctx: FlagContext, key: string, result: EvaluationResult) => void;
}
```

Supported attribute paths in conditions (closed set — typos return `undefined`):

```
user.id            user.email            user.isPro         user.createdAt
app.version        app.build             app.platform       app.locale        app.country
device.model       device.osVersion
custom.<any>
```

### Functions

```typescript
class FlagsService {
  constructor(db: FlagsDB, cfg?: FlagsConfig)

  // v2 targeting engine (preferred)
  async evaluate(key: string, ctx: FlagContext): Promise<EvaluationResult>
  async evaluateAll(ctx: FlagContext, keys?: string[]): Promise<Record<string, EvaluationResult>>

  // v2 rule + variant management
  async listRules(key: string): Promise<FlagRule[]>
  async upsertRules(key: string, rules: FlagRule[]): Promise<Flag>
  async addVariant(key: string, variant: Variant): Promise<Flag>
  async removeVariant(key: string, variantKey: string): Promise<Flag>

  // v1 compat shims (delegate to evaluate with { userId })
  async isEnabled(key: string, userId: string): Promise<boolean>
  async getValue(key: string, userId: string): Promise<string | number | Record<string, unknown> | null>
  async check(userId: string, key: string): Promise<{ key: string; enabled: boolean; value?: string | null }>
  async batchCheck(userId: string, keys: string[]): Promise<{ flags: Record<string, boolean> }>

  // CRUD
  async listFlags(): Promise<{ flags: Flag[] }>
  async createFlag(input: { key?: string; enabled?: boolean; rollout_pct?: number; description?: string; value?: string; value_type?: string; default_value?: FlagJsonValue; rules?: FlagRule[]; variants?: Variant[] }): Promise<Flag>
  async updateFlag(key: string, input: { enabled?: boolean; rollout_pct?: number; description?: string; value?: string; value_type?: string; default_value?: FlagJsonValue; rules?: FlagRule[]; variants?: Variant[] }): Promise<Flag>
  async deleteFlag(key: string): Promise<{ status: string }>

  // Per-user override (highest precedence — admin hotfix path)
  async setOverride(key: string, userId: string, enabled: boolean): Promise<void>
  async deleteOverride(key: string, userId: string): Promise<void>

  // Cache
  invalidate(key: string): void
  clearCache(): void
}

// Pure evaluator — exported for clients that want to evaluate a flag snapshot
// locally (e.g. a Swift/TS SDK with a cached rules bundle).
function evaluateFlag(flag: Flag, ctx: FlagContext): EvaluationResult
function resolveAttr(ctx: FlagContext, path: string): string | number | boolean | undefined
```

### Evaluation precedence

1. **User override** (`FlagsDB.getUserOverride`) — always wins if present
2. **Kill switch** (`flag.enabled === false`) — serves `default_value`
3. **Ordered rules** — first rule whose `condition` matches returns its `serve`
4. **Legacy fallback** — if `rules` is empty, falls back to `rollout_pct` (v1 path)
5. **Default** — serves `default_value` (or `false` if unset)

Percentage buckets are deterministic: `crc32(${seed ?? flagKey}:${userId}) % 10_000`, so
the same user lands in the same bucket across processes and restarts. Variant assignment
uses the seed `${flagKey}:${userId}:variants` — sticky as long as weights don't change.

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

### Functions

```typescript
class LifecycleService {
  constructor(cfg: LifecycleConfig, db: LifecycleDB, push: PushProvider)
  async evaluateUser(userId: string): Promise<EngagementScore>
  calculateScore(recentSessions: number, ahaReached: boolean, isPro: boolean, daysSinceActive: number, totalSessions: number): number
  async evaluateNotifications(userIds: string[]): Promise<void>
  async ackPrompt(userId: string, promptType: string, action: string): Promise<void>
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

### Functions

```typescript
class AnalyticsService {
  constructor(db: AnalyticsDB)
  async getDau(since?: string): Promise<{ data: DAURow[] }>
  async getEvents(opts?: { since?: string; event?: string }): Promise<{ data: EventRow[] }>
  async getMrr(): Promise<{ breakdown: SubStats[]; new_30d: number; churned_30d: number; mrr_cents?: number }>
  async getSummary(): Promise<{ dau: number; mau: number; total_users: number; active_subscriptions: number; trial_conversion_rate?: number }>
  async getRetention(opts?: { since?: string; days?: string }): Promise<{ data: RetentionRow[] }>
  async getRevenue(since?: string): Promise<{ data: RevenueRow[] }>
}
```

---

## attribution

Campaign/source/channel attribution with tracked links, click logging, conversion logging, and grouped reporting.

### DB Interface

```typescript
interface AttributionDB {
  getSourceById(id: string): Promise<AttributionSource | null>;
  getSourceBySlug(slug: string): Promise<AttributionSource | null>;
  createSource(source: AttributionSource): Promise<void>;
  updateSource(id: string, updates: Partial<AttributionSource>): Promise<void>;
  listSources(opts?: { channel?: string; campaign?: string; active?: boolean }): Promise<AttributionSource[]>;

  createClick(click: AttributionClick): Promise<void>;
  listClicks(opts?: { source_id?: string; channel?: string; campaign?: string; since?: Date | string }): Promise<AttributionClick[]>;

  createConversion(conversion: AttributionConversion): Promise<void>;
  listConversions(opts?: { source_id?: string; channel?: string; campaign?: string; since?: Date | string; event?: string }): Promise<AttributionConversion[]>;
}
```

### Types

```typescript
interface AttributionSource {
  id: string;
  slug: string;
  name: string;
  channel: string;
  source: string;
  campaign?: string;
  platform?: string;
  destination_url: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

interface AttributionClick {
  id: string;
  source_id: string;
  clicked_at: Date;
  ip_hash?: string;
  user_agent?: string;
  referrer?: string;
  country?: string;
  anonymous_id?: string;
  promo_code?: string;
  landing_path?: string;
  destination_url?: string;
  metadata?: Record<string, unknown>;
}

interface AttributionConversion {
  id: string;
  source_id: string;
  click_id?: string;
  user_id?: string;
  event: string;
  value_cents?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

interface SourceStats {
  source: AttributionSource;
  clicks: number;
  unique_clicks: number;
  conversions: number;
  revenue_cents: number;
  conversions_by_event: Record<string, number>;
}

interface GroupStats {
  key: string;
  clicks: number;
  unique_clicks: number;
  conversions: number;
  revenue_cents: number;
}
```

### Functions

```typescript
class AttributionService {
  constructor(db: AttributionDB)
  async createSource(input: {
    id?: string; slug?: string; name?: string; channel?: string; source?: string;
    campaign?: string; platform?: string; destination_url?: string; metadata?: Record<string, unknown>;
  }): Promise<AttributionSource>
  async updateSource(id: string, input: {
    slug?: string; name?: string; channel?: string; source?: string; campaign?: string;
    platform?: string; destination_url?: string; active?: boolean; metadata?: Record<string, unknown>;
  }): Promise<void>
  async listSources(opts?: { channel?: string; campaign?: string; active?: boolean }): Promise<AttributionSource[]>
  async resolveSource(slug: string): Promise<AttributionSource>
  buildTrackedUrl(baseRedirectUrl: string, slug: string, extraQuery?: Record<string, string | number | boolean | undefined>): string
  async recordClick(input: {
    sourceId?: string; slug?: string; clicked_at?: Date | string; ip_hash?: string;
    user_agent?: string; referrer?: string; country?: string; anonymous_id?: string;
    promo_code?: string; landing_path?: string; destination_url?: string; metadata?: Record<string, unknown>;
  }): Promise<{ click: AttributionClick; source: AttributionSource }>
  async recordConversion(input: {
    sourceId?: string; slug?: string; clickId?: string; userId?: string; event?: string;
    valueCents?: number; currency?: string; metadata?: Record<string, unknown>; created_at?: Date | string;
  }): Promise<AttributionConversion>
  async getSourceStats(sourceId: string, opts?: { since?: Date | string }): Promise<SourceStats>
  async getChannelStats(opts?: { since?: Date | string; active?: boolean }): Promise<GroupStats[]>
  async getCampaignStats(opts?: { since?: Date | string; active?: boolean }): Promise<GroupStats[]>
}
```

---

## promo

Influencer promo codes with redemption tracking, commission calculation, and a self-service influencer portal.

### DB Interface

```typescript
interface PromoDB {
  getCode(code: string): Promise<PromoCode | null>;
  createCode(code: PromoCode): Promise<void>;
  updateCode(code: string, updates: Partial<PromoCode>): Promise<void>;
  listCodes(opts?: { influencer_id?: string; active?: boolean }): Promise<PromoCode[]>;
  incrementRedeemed(code: string): Promise<void>;

  recordRedemption(redemption: PromoRedemption): Promise<void>;
  hasRedeemed(userId: string, code: string): Promise<boolean>;
  listRedemptions(opts: { influencer_id?: string; code?: string }): Promise<PromoRedemption[]>;

  getInfluencer(id: string): Promise<Influencer | null>;
  getInfluencerByToken(portalToken: string): Promise<Influencer | null>;
  createInfluencer(influencer: Influencer): Promise<void>;
  updateInfluencer(id: string, updates: Partial<Influencer>): Promise<void>;
  listInfluencers(): Promise<Influencer[]>;
}
```

### Types

```typescript
type CommissionModel =
  | { type: "revenue_share"; percent: number }
  | { type: "flat_per_purchase"; amount_cents: number; currency: string }
  | { type: "flat_per_redemption"; amount_cents: number; currency: string };

interface Influencer {
  id: string;
  name: string;
  email?: string;
  portal_token: string;
  commission: CommissionModel;
  active: boolean;
  created_at: Date;
}

interface PromoCode {
  code: string;
  influencer_id: string;
  type: "discount" | "trial_extension" | "premium_grant";
  discount_pct?: number;
  grant_days?: number;
  max_redemptions: number;
  redeemed_count: number;
  expires_at?: Date;
  active: boolean;
  created_at: Date;
}

interface PromoRedemption {
  id: string;
  user_id: string;
  code: string;
  influencer_id: string;
  redeemed_at: Date;
  purchase_amount_cents?: number;
  commission_cents?: number;
}
```

### Functions

```typescript
class PromoService {
  constructor(db: PromoDB)
  async redeemCode(userId: string, code: string): Promise<{ type: PromoCode["type"]; discount_pct?: number; grant_days?: number }>
  async recordPurchase(userId: string, code: string, amountCents: number): Promise<void>
  async getInfluencerStats(influencerId: string): Promise<{ totalRedemptions: number; totalPurchases: number; totalEarningsCents: number; codes: PromoCode[] }>
  async getInfluencerPortal(portalToken: string): Promise<{ influencer: Omit<Influencer, "portal_token">; stats: { totalRedemptions: number; totalPurchases: number; totalEarningsCents: number }; recentRedemptions: Array<{ code: string; redeemed_at: Date }> }>
  async createCode(input: { code?: string; influencer_id?: string; type?: PromoCode["type"]; discount_pct?: number; grant_days?: number; max_redemptions?: number; expires_at?: Date }): Promise<PromoCode>
  async updateCode(code: string, input: { discount_pct?: number; grant_days?: number; max_redemptions?: number; expires_at?: Date; active?: boolean }): Promise<PromoCode>
  async deactivateCode(code: string): Promise<void>
  async listCodes(opts?: { influencer_id?: string; active?: boolean }): Promise<PromoCode[]>
  async createInfluencer(input: { id?: string; name?: string; email?: string; commission?: CommissionModel }): Promise<Influencer>
  async updateInfluencer(id: string, input: { name?: string; email?: string; commission?: CommissionModel; active?: boolean }): Promise<void>
  async listInfluencers(): Promise<Influencer[]>
}
```

---

## grants

Manual premium grants with expiry and revocation for admin-granted access (comp accounts, support, promotions).

### DB Interface

```typescript
interface GrantDB {
  createGrant(grant: PremiumGrant): Promise<void>;
  getActiveGrant(userId: string): Promise<PremiumGrant | null>;
  listGrants(userId: string): Promise<PremiumGrant[]>;
  revokeGrant(grantId: string, revokedAt: Date): Promise<void>;
  listAllActiveGrants(): Promise<PremiumGrant[]>;
}
```

### Types

```typescript
interface PremiumGrant {
  id: string;
  user_id: string;
  granted_by: string;
  reason: string;
  product_id?: string;
  expires_at?: Date;
  created_at: Date;
  revoked_at?: Date;
}
```

### Functions

```typescript
class GrantService {
  constructor(db: GrantDB)
  async grantPremium(input: { userId?: string; grantedBy?: string; reason?: string; productId?: string; days?: number }): Promise<PremiumGrant>
  async isGrantedPremium(userId: string): Promise<boolean>
  async getActiveGrant(userId: string): Promise<PremiumGrant | null>
  async revokeGrant(grantId: string): Promise<void>
  async listGrants(userId: string): Promise<PremiumGrant[]>
  async listAllActiveGrants(): Promise<PremiumGrant[]>
}
```

---

## conversion

Discount offers for converting free users to paid, triggered by paywall dismissals, lifecycle stage, or inactivity. Includes dismissal tracking, cooldown periods, and offer expiry.

### DB Interface

```typescript
interface ConversionDB {
  getActiveOffer(userId: string): Promise<ConversionOffer | null>;
  createOffer(offer: ConversionOffer): Promise<void>;
  markRedeemed(userId: string): Promise<void>;
  countDismissals(userId: string, since: Date): Promise<number>;
  recordDismissal(userId: string): Promise<void>;
  lastOfferDate(userId: string): Promise<Date | string | null>;
}
```

### Types

```typescript
interface ConversionOffer {
  user_id: string;
  discount_pct: number;
  product_id?: string;
  expires_at: Date | string;
  trigger: "paywall_dismissals" | "lifecycle_stage" | "inactivity_winback";
  redeemed: boolean;
  created_at: Date | string;
}

interface ConversionConfig {
  dismissalThreshold?: number;   // default: 3
  discountPct?: number;          // default: 20
  offerTtlMinutes?: number;      // default: 1440 (24h)
  cooldownDays?: number;         // default: 7
  triggerStages?: string[];      // default: ["at_risk"]
  inactivityDays?: number;       // default: 14
}
```

### Functions

```typescript
class ConversionService {
  constructor(cfg: ConversionConfig, db: ConversionDB)
  async recordDismissal(userId: string): Promise<void>
  async checkEligibility(userId: string, opts?: { stage?: string; daysSinceActive?: number }): Promise<ConversionOffer | null>
  async getActiveOffer(userId: string): Promise<ConversionOffer | null>
  async redeemOffer(userId: string): Promise<void>
}
```
