import * as jose from "jose";
import { readFile } from "node:fs/promises";
import * as http2 from "node:http2";

// ── Provider Interface ──────────────────────────────────────────────────────

/** Result of a push send attempt. */
export interface PushResult {
  success: boolean;
  /** APNs error reason if failed (e.g. "BadDeviceToken", "Unregistered"). */
  reason?: string;
  statusCode?: number;
}

/** Callback invoked when a device token is invalid. Use to disable the token in your DB. */
export type BadTokenHandler = (deviceToken: string, reason: string) => void;

export interface PushProvider {
  send(deviceToken: string, title: string, body: string): Promise<void>;
  sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
  sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
  /** Send a rich notification with full APNs payload control. */
  sendRich?(deviceToken: string, payload: APNsPayload, headers?: APNsHeaders): Promise<PushResult>;
}

// ── APNs Payload Types ──────────────────────────────────────────────────────

export interface APNsAlert {
  title: string;
  subtitle?: string;
  body: string;
  /** Localization key for the title. */
  "title-loc-key"?: string;
  "title-loc-args"?: string[];
  "loc-key"?: string;
  "loc-args"?: string[];
  "launch-image"?: string;
}

export interface APNsSound {
  /** Default: "default". Set to a filename in the app bundle. */
  name?: string;
  critical?: 0 | 1;
  volume?: number;
}

export interface APNsAps {
  alert?: APNsAlert | string;
  badge?: number;
  sound?: string | APNsSound;
  /** Set to 1 to enable background fetch. */
  "content-available"?: number;
  /** Set to 1 to enable notification service extension (for rich media). */
  "mutable-content"?: number;
  /** Notification category for actionable notifications. */
  category?: string;
  /** Thread ID for notification grouping. */
  "thread-id"?: string;
  /** URL to media attachment (processed by notification service extension). */
  "target-content-id"?: string;
  /** Interruption level: passive, active (default), time-sensitive, critical. */
  "interruption-level"?: "passive" | "active" | "time-sensitive" | "critical";
  /** Relevance score 0-1 for notification summary ranking. */
  "relevance-score"?: number;
  /** Filter criteria for notification filtering. */
  "filter-criteria"?: string;
  /** Stale date for time-sensitive notifications. */
  "stale-date"?: number;
  /** Timestamp for Live Activities. */
  "timestamp"?: number;
  /** Event type for Live Activities (update, end). */
  "event"?: string;
  /** Content state for Live Activities. */
  "content-state"?: Record<string, unknown>;
  /** Dismissal date for Live Activities. */
  "dismissal-date"?: number;
}

export interface APNsPayload {
  aps: APNsAps;
  /** Custom data merged into the top-level payload. Keys must not conflict with "aps". */
  [key: string]: unknown;
}

export interface APNsHeaders {
  /** Push type: alert, background, voip, complication, fileprovider, mdm, liveactivity. */
  pushType?: string;
  /** Priority: "10" for immediate, "5" for power-saving, "1" for background. */
  priority?: string;
  /** Expiration timestamp (0 = deliver now or not at all). */
  expiration?: string;
  /** Collapse ID for coalescing notifications. */
  collapseId?: string;
  /** Override the APNs topic (default: bundle ID from config). */
  topic?: string;
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface PushConfig {
  /** Path to .p8 key file. */
  keyPath?: string;
  keyId: string;
  teamId: string;
  /** Bundle ID. */
  topic: string;
  /** "sandbox" or "production". */
  environment?: "sandbox" | "production";
  /** Called when APNs reports a bad device token. Use to disable the token in your DB. */
  onBadToken?: BadTokenHandler;
}

/** Creates a push provider. Returns APNs if keyPath is set, LogProvider otherwise. */
export async function newProvider(cfg: PushConfig): Promise<PushProvider> {
  if (!cfg.keyPath) {
    console.log("[push] no key path — using log provider");
    return new LogProvider();
  }
  try {
    const provider = await APNsProvider.create(cfg);
    console.log(`[push] APNs provider initialized (env=${cfg.environment ?? "sandbox"})`);
    return provider;
  } catch (err) {
    console.log(`[push] WARNING: could not init APNs: ${err} — falling back to log provider`);
    return new LogProvider();
  }
}

// ── Convenience Builders ────────────────────────────────────────────────────

/** Build an alert payload with optional rich features. */
export function alertPayload(opts: {
  title: string;
  body: string;
  subtitle?: string;
  badge?: number;
  sound?: string;
  category?: string;
  threadId?: string;
  interruptionLevel?: "passive" | "active" | "time-sensitive" | "critical";
  relevanceScore?: number;
  /** Set true to enable notification service extension (for image/media attachments). */
  mutableContent?: boolean;
  data?: Record<string, string>;
}): APNsPayload {
  const alert: APNsAlert = { title: opts.title, body: opts.body };
  if (opts.subtitle) alert.subtitle = opts.subtitle;

  const aps: APNsAps = { alert, sound: opts.sound ?? "default" };
  if (opts.badge !== undefined) aps.badge = opts.badge;
  if (opts.category) aps.category = opts.category;
  if (opts.threadId) aps["thread-id"] = opts.threadId;
  if (opts.interruptionLevel) aps["interruption-level"] = opts.interruptionLevel;
  if (opts.relevanceScore !== undefined) aps["relevance-score"] = opts.relevanceScore;
  if (opts.mutableContent) aps["mutable-content"] = 1;

  return { aps, ...opts.data };
}

/** Build a critical alert payload (requires Apple entitlement). */
export function criticalAlertPayload(opts: {
  title: string;
  body: string;
  soundName?: string;
  volume?: number;
  data?: Record<string, string>;
}): APNsPayload {
  return {
    aps: {
      alert: { title: opts.title, body: opts.body },
      sound: { name: opts.soundName ?? "default", critical: 1, volume: opts.volume ?? 1.0 },
      "interruption-level": "critical",
    },
    ...opts.data,
  };
}

/** Build a Live Activity push update payload. */
export function liveActivityPayload(opts: {
  event: "update" | "end";
  contentState: Record<string, unknown>;
  timestamp: number;
  dismissalDate?: number;
  alert?: { title: string; body: string };
  sound?: string;
}): APNsPayload {
  const aps: APNsAps = {
    timestamp: opts.timestamp,
    event: opts.event,
    "content-state": opts.contentState,
  };
  if (opts.dismissalDate) aps["dismissal-date"] = opts.dismissalDate;
  if (opts.alert) aps.alert = opts.alert;
  if (opts.sound) aps.sound = opts.sound;
  return { aps };
}

// ── Bad Token Detection ─────────────────────────────────────────────────────

const BAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "ExpiredToken", "TopicDisallowed"]);

// ── LogProvider ─────────────────────────────────────────────────────────────

export class LogProvider implements PushProvider {
  async send(deviceToken: string, title: string, body: string): Promise<void> {
    console.log(`[push/log] token=${deviceToken.slice(0, 16)} title="${title}" body="${body}"`);
  }
  async sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void> {
    console.log(`[push/log] token=${deviceToken.slice(0, 16)} title="${title}" body="${body}" data=${JSON.stringify(data)}`);
  }
  async sendSilent(deviceToken: string, data: Record<string, string>): Promise<void> {
    console.log(`[push/log] SILENT token=${deviceToken.slice(0, 16)} data=${JSON.stringify(data)}`);
  }
  async sendRich(deviceToken: string, payload: APNsPayload, headers?: APNsHeaders): Promise<PushResult> {
    console.log(`[push/log] RICH token=${deviceToken.slice(0, 16)} payload=${JSON.stringify(payload)}${headers?.topic ? ` topic=${headers.topic}` : ""}`);
    return { success: true };
  }
}

// ── NoopProvider ────────────────────────────────────────────────────────────

export class NoopProvider implements PushProvider {
  async send(): Promise<void> {}
  async sendWithData(): Promise<void> {}
  async sendSilent(): Promise<void> {}
  async sendRich(): Promise<PushResult> { return { success: true }; }
}

// ── APNsProvider ────────────────────────────────────────────────────────────

export class APNsProvider implements PushProvider {
  private key: CryptoKey;
  private keyId: string;
  private teamId: string;
  private topic: string;
  private baseUrl: string;
  private cachedToken: string | null = null;
  private tokenExpiry = 0;
  private _h2client: http2.ClientHttp2Session | null = null;
  private _connectingPromise: Promise<http2.ClientHttp2Session> | null = null;
  private onBadToken?: BadTokenHandler;

  private constructor(key: CryptoKey, cfg: PushConfig) {
    this.key = key;
    this.keyId = cfg.keyId;
    this.teamId = cfg.teamId;
    this.topic = cfg.topic;
    this.baseUrl =
      cfg.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    this.onBadToken = cfg.onBadToken;
  }

  static async create(cfg: PushConfig): Promise<APNsProvider> {
    if (!cfg.keyPath) throw new Error("push: keyPath is required for APNsProvider");
    const keyData = await readFile(cfg.keyPath, "utf-8");
    const key = await jose.importPKCS8(keyData, "ES256");
    return new APNsProvider(key as CryptoKey, cfg);
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.keyId })
      .setIssuer(this.teamId)
      .setIssuedAt()
      .sign(this.key);

    this.cachedToken = token;
    this.tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 min
    return token;
  }

  /** Close the HTTP/2 connection. Call on shutdown. */
  close(): void {
    if (this._h2client && !this._h2client.destroyed) {
      this._h2client.close();
      this._h2client = null;
    }
    this._connectingPromise = null;
  }

  async send(deviceToken: string, title: string, body: string): Promise<void> {
    const result = await this.sendRich(deviceToken, alertPayload({ title, body }));
    if (!result.success) throw new Error(`apns error ${result.statusCode}: ${result.reason}`);
  }

  async sendWithData(
    deviceToken: string,
    title: string,
    body: string,
    data: Record<string, string>
  ): Promise<void> {
    const result = await this.sendRich(deviceToken, alertPayload({ title, body, data }));
    if (!result.success) throw new Error(`apns error ${result.statusCode}: ${result.reason}`);
  }

  async sendSilent(
    deviceToken: string,
    data: Record<string, string>
  ): Promise<void> {
    const result = await this.sendRich(deviceToken, {
      aps: { "content-available": 1 },
      ...data,
    }, { pushType: "background", priority: "5" });
    if (!result.success) throw new Error(`apns error ${result.statusCode}: ${result.reason}`);
  }

  async sendRich(
    deviceToken: string,
    payload: APNsPayload,
    headers?: APNsHeaders
  ): Promise<PushResult> {
    const pushType = headers?.pushType ?? (payload.aps["content-available"] ? "background" : "alert");
    const priority = headers?.priority ?? (pushType === "background" ? "5" : "10");

    const token = await this.getToken();
    const client = await this.getH2Client();
    const body = JSON.stringify(payload);

    return new Promise<PushResult>((resolve, reject) => {
      const req = client.request({
        [http2.constants.HTTP2_HEADER_METHOD]: "POST",
        [http2.constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
        "authorization": `bearer ${token}`,
        "apns-topic": headers?.topic ?? this.topic,
        "apns-push-type": pushType,
        "apns-priority": priority,
        "apns-expiration": headers?.expiration ?? "0",
        ...(headers?.collapseId ? { "apns-collapse-id": headers.collapseId } : {}),
        "content-type": "application/json",
      });

      let status = 0;
      let responseData = "";

      req.on("response", (h) => {
        status = Number(h[http2.constants.HTTP2_HEADER_STATUS]);
      });

      req.on("data", (chunk: Buffer) => {
        responseData += chunk.toString();
      });

      req.on("end", () => {
        if (status === 200) {
          resolve({ success: true, statusCode: 200 });
        } else {
          let reason = "unknown";
          try {
            const parsed = JSON.parse(responseData) as { reason?: string };
            if (parsed.reason) reason = parsed.reason;
          } catch {}
          // Auto-disable bad tokens
          if (BAD_TOKEN_REASONS.has(reason) && this.onBadToken) {
            this.onBadToken(deviceToken, reason);
          }
          resolve({ success: false, statusCode: status, reason });
        }
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.end(body);
    });
  }

  /** Get or create H2 client, deduplicated across concurrent callers. */
  private getH2Client(): Promise<http2.ClientHttp2Session> {
    if (this._h2client && !this._h2client.destroyed && !this._h2client.closed) {
      return Promise.resolve(this._h2client);
    }
    if (this._connectingPromise) return this._connectingPromise;

    this._connectingPromise = new Promise<http2.ClientHttp2Session>((resolve) => {
      const client = http2.connect(this.baseUrl);
      client.on("connect", () => {
        this._h2client = client;
        this._connectingPromise = null;
        resolve(client);
      });
      client.on("error", (err) => {
        console.log(`[push] H2 connection error: ${err.message ?? err}`);
        this._h2client = null;
        this._connectingPromise = null;
        // Resolve with the client anyway — individual requests will fail and trigger reconnect
        resolve(client);
      });
      client.on("goaway", () => {
        console.log("[push] H2 GOAWAY received, will reconnect on next request");
        this._h2client = null;
        this._connectingPromise = null;
      });
    });

    return this._connectingPromise;
  }
}
