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

/**
 * Optional server-side session store. Enables session revocation and multi-device management.
 * If not provided, sessions are stateless JWTs (no revocation support).
 */
export interface SessionDB {
  /** Create a session record. */
  createSession(userId: string, jti: string, expiresAt: Date): Promise<void>;
  /** Check if a session is still valid (not revoked). Returns false if revoked or not found. */
  isSessionValid(jti: string): Promise<boolean>;
  /** Revoke a specific session by jti. */
  revokeSession(jti: string): Promise<void>;
  /** Revoke all sessions for a user (logout everywhere). */
  revokeAllSessions(userId: string): Promise<void>;
  /** List active sessions for a user (for multi-device visibility). */
  activeSessions?(userId: string): Promise<Array<{ jti: string; createdAt: Date | string }>>;
}

export interface User {
  id: string;
  apple_sub: string;
  email: string;
  name: string;
  created_at: Date | string;
  last_login_at: Date | string;
}

export interface AuthConfig {
  jwtSecret: string;
  appleBundleId: string;
  appleWebClientId?: string;
  /** Session expiry in seconds (default: 7 days). */
  sessionExpirySec?: number;
  productionEnv?: boolean;
  /** Cookie name for session token (default: "session"). */
  cookieName?: string;
  /** Optional server-side session store for revocation support. */
  sessionDB?: SessionDB;
  /**
   * Apple web OAuth2 client secret for Sign in with Apple web flow.
   * This is a JWT generated from your App Store Connect API key.
   * If not provided, handleWebAuth will return 501.
   */
  appleClientSecret?: string;
  /** Redirect URI for Sign in with Apple web flow. */
  appleRedirectUri?: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class AuthService {
  private secretKey: Uint8Array;
  private sessionExpirySec: number;
  private jwks: jose.JSONWebKeySet | null = null;
  private jwksExpiry = 0;
  private jwksFetchPromise: Promise<jose.JSONWebKeySet> | null = null;

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

    // Deduplicate concurrent fetches
    if (this.jwksFetchPromise) return this.jwksFetchPromise;

    this.jwksFetchPromise = (async () => {
      try {
        const res = await fetch("https://appleid.apple.com/auth/keys");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as jose.JSONWebKeySet;
        this.jwks = data;
        this.jwksExpiry = Date.now() + 24 * 60 * 60 * 1000;
        return data;
      } finally {
        this.jwksFetchPromise = null;
      }
    })();

    return this.jwksFetchPromise;
  }

  async verifyAppleIdToken(
    tokenString: string
  ): Promise<{ sub: string; email: string; emailVerified: boolean }> {
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

    const claims = payload as Record<string, unknown>;
    return {
      sub: payload.sub!,
      email: (claims.email as string) ?? "",
      emailVerified: (claims.email_verified as boolean) ?? false,
    };
  }

  // ── Session JWT ─────────────────────────────────────────────────────────

  async createSessionToken(userId: string): Promise<string> {
    const jti = randomUUID();

    const token = await new jose.SignJWT({ uid: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${this.sessionExpirySec}s`)
      .setJti(jti)
      .sign(this.secretKey);

    // Store session server-side if session DB is available
    if (this.cfg.sessionDB) {
      const expiresAt = new Date(Date.now() + this.sessionExpirySec * 1000);
      await this.cfg.sessionDB.createSession(userId, jti, expiresAt);
    }

    return token;
  }

  async parseSessionToken(tokenStr: string): Promise<string> {
    const { payload } = await jose.jwtVerify(tokenStr, this.secretKey, {
      algorithms: ["HS256"],
    });
    const uid = (payload as Record<string, unknown>).uid;
    if (typeof uid !== "string") throw new Error("invalid session token");

    // Check session store for revocation
    if (this.cfg.sessionDB && payload.jti) {
      const valid = await this.cfg.sessionDB.isSessionValid(payload.jti);
      if (!valid) throw new Error("session revoked");
    }

    return uid;
  }

  // ── HTTP Handlers ───────────────────────────────────────────────────────

  /** POST /api/v1/auth/apple — mobile Sign in with Apple (identity token). */
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
      console.log(`[auth] apple token verification failed: ${err}`);
      return c.json({ error: "token verification failed" }, 401);
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

    setCookie(c, this.cfg.cookieName ?? "session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: this.cfg.productionEnv ?? false,
      sameSite: "Lax",
      maxAge: this.sessionExpirySec,
    });

    return c.json({ token: sessionToken, user });
  };

  /**
   * POST /api/v1/auth/apple/web — Sign in with Apple web OAuth2 code exchange.
   * Requires appleClientSecret and appleRedirectUri in config.
   */
  handleWebAuth = async (c: Context) => {
    if (!this.cfg.appleClientSecret || !this.cfg.appleRedirectUri || !this.cfg.appleWebClientId) {
      return c.json({ error: "web auth not configured" }, 501);
    }

    const body = await c.req.json<{ code?: string; name?: string }>();
    if (!body.code) return c.json({ error: "authorization code is required" }, 400);

    // Exchange authorization code for tokens
    let idToken: string;
    try {
      const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.cfg.appleWebClientId,
          client_secret: this.cfg.appleClientSecret,
          code: body.code,
          grant_type: "authorization_code",
          redirect_uri: this.cfg.appleRedirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.log(`[auth] apple token exchange failed: ${tokenRes.status} ${errBody}`);
        return c.json({ error: "authorization code exchange failed" }, 401);
      }

      const tokenData = (await tokenRes.json()) as { id_token?: string };
      if (!tokenData.id_token) return c.json({ error: "no id_token in response" }, 401);
      idToken = tokenData.id_token;
    } catch (err) {
      console.log(`[auth] apple token exchange error: ${err}`);
      return c.json({ error: "token exchange failed" }, 502);
    }

    // Verify the id_token
    let sub: string, email: string;
    try {
      ({ sub, email } = await this.verifyAppleIdToken(idToken));
    } catch (err) {
      console.log(`[auth] web id_token verification failed: ${err}`);
      return c.json({ error: "token verification failed" }, 401);
    }

    let user: User;
    try {
      user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, body.name ?? "");
    } catch {
      return c.json({ error: "failed to create user" }, 500);
    }

    const sessionToken = await this.createSessionToken(user.id);

    setCookie(c, this.cfg.cookieName ?? "session", sessionToken, {
      path: "/",
      httpOnly: true,
      secure: true,
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

  /** POST /api/v1/auth/logout — revokes current session. */
  handleLogout = async (c: Context) => {
    // Revoke server-side session if available
    if (this.cfg.sessionDB) {
      try {
        const auth = c.req.header("authorization");
        let token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
        if (!token) {
          const { getCookie } = await import("hono/cookie");
          token = getCookie(c, this.cfg.cookieName ?? "session");
        }
        if (token) {
          const { payload } = await jose.jwtVerify(token, this.secretKey, { algorithms: ["HS256"] });
          if (payload.jti) await this.cfg.sessionDB.revokeSession(payload.jti);
        }
      } catch {
        // Token invalid or expired — no session to revoke
      }
    }

    deleteCookie(c, this.cfg.cookieName ?? "session", { path: "/" });
    return c.json({ status: "logged out" });
  };

  /** POST /api/v1/auth/logout-all — revokes all sessions for the current user. */
  handleLogoutAll = async (c: Context) => {
    if (!this.cfg.sessionDB) return c.json({ error: "session management not configured" }, 501);

    const userId = c.get("userId") as string;
    await this.cfg.sessionDB.revokeAllSessions(userId);
    deleteCookie(c, this.cfg.cookieName ?? "session", { path: "/" });
    return c.json({ status: "all sessions revoked" });
  };

  /** GET /api/v1/auth/sessions — list active sessions (multi-device visibility). */
  handleListSessions = async (c: Context) => {
    if (!this.cfg.sessionDB?.activeSessions) return c.json({ error: "session listing not available" }, 501);

    const userId = c.get("userId") as string;
    const sessions = await this.cfg.sessionDB.activeSessions(userId);
    return c.json({ sessions });
  };

  /** DELETE /api/v1/auth/sessions/:jti — revoke a specific session. */
  handleRevokeSession = async (c: Context) => {
    if (!this.cfg.sessionDB) return c.json({ error: "session management not configured" }, 501);

    const jti = c.req.param("jti");
    if (!jti) return c.json({ error: "session id is required" }, 400);
    await this.cfg.sessionDB.revokeSession(jti);
    return c.json({ status: "session revoked" });
  };
}
