import * as jose from "jose";
import { readFile } from "node:fs/promises";

// ── Provider Interface ──────────────────────────────────────────────────────

export interface PushProvider {
  send(deviceToken: string, title: string, body: string): Promise<void>;
  sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
  sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
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
  environment?: string;
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
}

// ── NoopProvider ────────────────────────────────────────────────────────────

export class NoopProvider implements PushProvider {
  async send(): Promise<void> {}
  async sendWithData(): Promise<void> {}
  async sendSilent(): Promise<void> {}
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

  private constructor(key: CryptoKey, cfg: PushConfig) {
    this.key = key;
    this.keyId = cfg.keyId;
    this.teamId = cfg.teamId;
    this.topic = cfg.topic;
    this.baseUrl =
      cfg.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
  }

  static async create(cfg: PushConfig): Promise<APNsProvider> {
    const keyData = await readFile(cfg.keyPath!, "utf-8");
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

  async send(deviceToken: string, title: string, body: string): Promise<void> {
    return this.sendWithData(deviceToken, title, body, {});
  }

  async sendWithData(
    deviceToken: string,
    title: string,
    body: string,
    data: Record<string, string>
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      aps: { alert: { title, body }, sound: "default" },
      ...data,
    };
    await this.sendPayload(deviceToken, payload, "alert", "10");
  }

  async sendSilent(
    deviceToken: string,
    data: Record<string, string>
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      aps: { "content-available": 1 },
      ...data,
    };
    await this.sendPayload(deviceToken, payload, "background", "5");
  }

  private async sendPayload(
    deviceToken: string,
    payload: Record<string, unknown>,
    pushType: string,
    priority: string
  ): Promise<void> {
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
      const err = (await res.json().catch(() => ({}))) as { reason?: string };
      throw new Error(`apns error ${res.status}: ${err.reason ?? "unknown"}`);
    }
  }
}
