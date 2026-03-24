import * as jose from "jose";
import { readFile } from "node:fs/promises";
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
}
// ── NoopProvider ────────────────────────────────────────────────────────────
export class NoopProvider {
    async send() { }
    async sendWithData() { }
    async sendSilent() { }
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
    constructor(key, cfg) {
        this.key = key;
        this.keyId = cfg.keyId;
        this.teamId = cfg.teamId;
        this.topic = cfg.topic;
        this.baseUrl =
            cfg.environment === "production"
                ? "https://api.push.apple.com"
                : "https://api.sandbox.push.apple.com";
    }
    static async create(cfg) {
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
    async send(deviceToken, title, body) {
        return this.sendWithData(deviceToken, title, body, {});
    }
    async sendWithData(deviceToken, title, body, data) {
        const payload = {
            aps: { alert: { title, body }, sound: "default" },
            ...data,
        };
        await this.sendPayload(deviceToken, payload, "alert", "10");
    }
    async sendSilent(deviceToken, data) {
        const payload = {
            aps: { "content-available": 1 },
            ...data,
        };
        await this.sendPayload(deviceToken, payload, "background", "5");
    }
    async sendPayload(deviceToken, payload, pushType, priority) {
        const token = await this.getToken();
        const url = `${this.baseUrl}/3/device/${deviceToken}`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                authorization: `bearer ${token}`,
                "apns-topic": this.topic,
                "apns-push-type": pushType,
                "apns-priority": priority,
                "apns-expiration": "0",
                "content-type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = (await res.json().catch(() => ({})));
            throw new Error(`apns error ${res.status}: ${err.reason ?? "unknown"}`);
        }
    }
}
//# sourceMappingURL=index.js.map