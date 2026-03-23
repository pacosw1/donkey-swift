import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import * as jose from "jose";
import { randomUUID } from "node:crypto";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AuthDB {
  upsertUserByAppleSub(
    id: string,
    appleSub: string,
    email: string,
    name: string
  ): Promise<User>;
  userById(id: string): Promise<User>;
}

export interface User {
  id: string;
  apple_sub: string;
  email: string;
  name: string;
  created_at: Date;
  last_login_at: Date;
}

export interface AuthConfig {
  jwtSecret: string;
  appleBundleId: string;
  appleWebClientId?: string;
  /** Session expiry in seconds (default: 7 days). */
  sessionExpirySec?: number;
  productionEnv?: boolean;
}

// ── Migrations ──────────────────────────────────────────────────────────────

export const migrations = [
  {
    name: "auth: create users table",
    sql: `CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      apple_sub     TEXT UNIQUE NOT NULL,
      email         TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
];

// ── Service ─────────────────────────────────────────────────────────────────

export class AuthService {
  private secretKey: Uint8Array;
  private sessionExpirySec: number;
  private jwks: jose.JSONWebKeySet | null = null;
  private jwksExpiry = 0;

  constructor(
    private cfg: AuthConfig,
    private db: AuthDB
  ) {
    this.secretKey = new TextEncoder().encode(cfg.jwtSecret);
    this.sessionExpirySec = cfg.sessionExpirySec ?? 7 * 24 * 60 * 60;
  }

  // ── Apple ID Token Verification ─────────────────────────────────────────

  private async getAppleJWKS(): Promise<jose.JSONWebKeySet> {
    if (this.jwks && Date.now() < this.jwksExpiry) return this.jwks;

    const res = await fetch("https://appleid.apple.com/auth/keys");
    if (!res.ok) throw new Error("failed to fetch Apple JWKS");
    this.jwks = (await res.json()) as jose.JSONWebKeySet;
    this.jwksExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h cache
    return this.jwks;
  }

  async verifyAppleIdToken(
    tokenString: string
  ): Promise<{ sub: string; email: string }> {
    const jwksData = await this.getAppleJWKS();
    const JWKS = jose.createLocalJWKSet(jwksData);

    const { payload } = await jose.jwtVerify(tokenString, JWKS, {
      issuer: "https://appleid.apple.com",
      algorithms: ["RS256"],
    });

    // Validate audience
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const validAudiences = [this.cfg.appleBundleId];
    if (this.cfg.appleWebClientId)
      validAudiences.push(this.cfg.appleWebClientId);

    if (!aud.some((a) => validAudiences.includes(a!))) {
      throw new Error("invalid audience");
    }

    return {
      sub: payload.sub!,
      email: (payload as Record<string, unknown>).email as string ?? "",
    };
  }

  // ── Session JWT ─────────────────────────────────────────────────────────

  async createSessionToken(userId: string): Promise<string> {
    return new jose.SignJWT({ uid: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${this.sessionExpirySec}s`)
      .setJti(randomUUID())
      .sign(this.secretKey);
  }

  async parseSessionToken(tokenStr: string): Promise<string> {
    const { payload } = await jose.jwtVerify(tokenStr, this.secretKey, {
      algorithms: ["HS256"],
    });
    const uid = (payload as Record<string, unknown>).uid;
    if (typeof uid !== "string") throw new Error("invalid session token");
    return uid;
  }

  // ── HTTP Handlers ───────────────────────────────────────────────────────

  /** POST /api/v1/auth/apple */
  handleAppleAuth = async (c: Context) => {
    const body = await c.req.json<{
      identity_token?: string;
      name?: string;
    }>();

    if (!body.identity_token) {
      return c.json({ error: "identity_token is required" }, 400);
    }

    let sub: string, email: string;
    try {
      ({ sub, email } = await this.verifyAppleIdToken(body.identity_token));
    } catch (err) {
      return c.json(
        { error: `token verification failed: ${err}` },
        401
      );
    }

    let user: User;
    try {
      user = await this.db.upsertUserByAppleSub(
        randomUUID(),
        sub,
        email,
        body.name ?? ""
      );
    } catch {
      return c.json({ error: "failed to create user" }, 500);
    }

    const sessionToken = await this.createSessionToken(user.id);

    setCookie(c, "session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: this.cfg.productionEnv ?? false,
      sameSite: "Lax",
      maxAge: this.sessionExpirySec,
    });

    return c.json({ token: sessionToken, user });
  };

  /** GET /api/v1/auth/me */
  handleMe = async (c: Context) => {
    const userId = c.get("userId") as string;
    try {
      const user = await this.db.userById(userId);
      return c.json(user);
    } catch {
      return c.json({ error: "user not found" }, 404);
    }
  };

  /** POST /api/v1/auth/logout */
  handleLogout = async (c: Context) => {
    deleteCookie(c, "session", { path: "/" });
    return c.json({ status: "logged out" });
  };
}
