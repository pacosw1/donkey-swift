import * as jose from "jose";
import { readFile } from "node:fs/promises";
import * as http2 from "node:http2";
/** Creates a push provider. Returns APNs if keyPath is set, LogProvider otherwise. */
export async function newProvider(cfg) {
    if (!cfg.keyPath) {
        console.log("[push] no key path — using log provider");
        return new LogProvider();
    }
    try {
        const provider = await APNsProvider.create(cfg);
        console.log(`[push] APNs provider initialized (env=${cfg.environment ?? "sandbox"})`);
        return provider;
    }
    catch (err) {
        console.log(`[push] WARNING: could not init APNs: ${err} — falling back to log provider`);
        return new LogProvider();
    }
}
// ── Convenience Builders ────────────────────────────────────────────────────
/** Build an alert payload with optional rich features. */
export function alertPayload(opts) {
    const alert = { title: opts.title, body: opts.body };
    if (opts.subtitle)
        alert.subtitle = opts.subtitle;
    const aps = { alert, sound: opts.sound ?? "default" };
    if (opts.badge !== undefined)
        aps.badge = opts.badge;
    if (opts.category)
        aps.category = opts.category;
    if (opts.threadId)
        aps["thread-id"] = opts.threadId;
    if (opts.interruptionLevel)
        aps["interruption-level"] = opts.interruptionLevel;
    if (opts.relevanceScore !== undefined)
        aps["relevance-score"] = opts.relevanceScore;
    if (opts.mutableContent)
        aps["mutable-content"] = 1;
    return { aps, ...opts.data };
}
/** Build a critical alert payload (requires Apple entitlement). */
export function criticalAlertPayload(opts) {
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
export function liveActivityPayload(opts) {
    const aps = {
        timestamp: opts.timestamp,
        event: opts.event,
        "content-state": opts.contentState,
    };
    if (opts.dismissalDate)
        aps["dismissal-date"] = opts.dismissalDate;
    if (opts.alert)
        aps.alert = opts.alert;
    if (opts.sound)
        aps.sound = opts.sound;
    return { aps };
}
// ── Bad Token Detection ─────────────────────────────────────────────────────
const BAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "ExpiredToken", "TopicDisallowed"]);
// ── LogProvider ─────────────────────────────────────────────────────────────
export class LogProvider {
    async send(deviceToken, title, body) {
        console.log(`[push/log] token=${deviceToken.slice(0, 16)} title="${title}" body="${body}"`);
    }
    async sendWithData(deviceToken, title, body, data) {
        console.log(`[push/log] token=${deviceToken.slice(0, 16)} title="${title}" body="${body}" data=${JSON.stringify(data)}`);
    }
    async sendSilent(deviceToken, data) {
        console.log(`[push/log] SILENT token=${deviceToken.slice(0, 16)} data=${JSON.stringify(data)}`);
    }
    async sendRich(deviceToken, payload, headers) {
        console.log(`[push/log] RICH token=${deviceToken.slice(0, 16)} payload=${JSON.stringify(payload)}${headers?.topic ? ` topic=${headers.topic}` : ""}`);
        return { success: true };
    }
}
// ── NoopProvider ────────────────────────────────────────────────────────────
export class NoopProvider {
    async send() { }
    async sendWithData() { }
    async sendSilent() { }
    async sendRich() { return { success: true }; }
}
// ── APNsProvider ────────────────────────────────────────────────────────────
export class APNsProvider {
    key;
    keyId;
    teamId;
    topic;
    baseUrl;
    cachedToken = null;
    tokenExpiry = 0;
    _h2client = null;
    _connectingPromise = null;
    onBadToken;
    constructor(key, cfg) {
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
    static async create(cfg) {
        if (!cfg.keyPath)
            throw new Error("push: keyPath is required for APNsProvider");
        const keyData = await readFile(cfg.keyPath, "utf-8");
        const key = await jose.importPKCS8(keyData, "ES256");
        return new APNsProvider(key, cfg);
    }
    async getToken() {
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
    close() {
        if (this._h2client && !this._h2client.destroyed) {
            this._h2client.close();
            this._h2client = null;
        }
        this._connectingPromise = null;
    }
    async send(deviceToken, title, body) {
        const result = await this.sendRich(deviceToken, alertPayload({ title, body }));
        if (!result.success)
            throw new Error(`apns error ${result.statusCode}: ${result.reason}`);
    }
    async sendWithData(deviceToken, title, body, data) {
        const result = await this.sendRich(deviceToken, alertPayload({ title, body, data }));
        if (!result.success)
            throw new Error(`apns error ${result.statusCode}: ${result.reason}`);
    }
    async sendSilent(deviceToken, data) {
        const result = await this.sendRich(deviceToken, {
            aps: { "content-available": 1 },
            ...data,
        }, { pushType: "background", priority: "5" });
        if (!result.success)
            throw new Error(`apns error ${result.statusCode}: ${result.reason}`);
    }
    async sendRich(deviceToken, payload, headers) {
        const pushType = headers?.pushType ?? (payload.aps["content-available"] ? "background" : "alert");
        const priority = headers?.priority ?? (pushType === "background" ? "5" : "10");
        const token = await this.getToken();
        const client = await this.getH2Client();
        const body = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
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
            req.on("data", (chunk) => {
                responseData += chunk.toString();
            });
            req.on("end", () => {
                if (status === 200) {
                    resolve({ success: true, statusCode: 200 });
                }
                else {
                    let reason = "unknown";
                    try {
                        const parsed = JSON.parse(responseData);
                        if (parsed.reason)
                            reason = parsed.reason;
                    }
                    catch { }
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
    getH2Client() {
        if (this._h2client && !this._h2client.destroyed && !this._h2client.closed) {
            return Promise.resolve(this._h2client);
        }
        if (this._connectingPromise)
            return this._connectingPromise;
        this._connectingPromise = new Promise((resolve) => {
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
//# sourceMappingURL=index.js.map