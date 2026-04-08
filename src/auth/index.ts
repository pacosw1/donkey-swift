import * as jose from "jose";
import { randomUUID } from "node:crypto";
import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  NotConfiguredError,
  ServiceError,
} from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AuthDB {
  upsertUserByAppleSub(
    id: string,
    appleSub: string,
    email: string,
    name: string
  ): Promise<User>;
  userById(id: string): Promise<User>;
  storeAppleAuthArtifacts?(userId: string, artifacts: AppleAuthArtifacts): Promise<void>;
  getAppleAuthArtifacts?(userId: string): Promise<AppleAuthArtifacts | null>;
  deleteAppleAuthArtifacts?(userId: string): Promise<void>;
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
  appleBundleClientSecret?: string;
  appleWebClientSecret?: string;
  appleTeamId?: string;
  appleKeyId?: string;
  applePrivateKey?: string;
  /** Session expiry in seconds (default: 7 days). */
  sessionExpirySec?: number;
  productionEnv?: boolean;
  /** Optional server-side session store for revocation support. */
  sessionDB?: SessionDB;
  /**
   * Apple web OAuth2 client secret for Sign in with Apple web flow.
   * This is a JWT generated from your App Store Connect API key.
   * If not provided, authenticateWithWeb will throw NotConfiguredError.
   */
  appleClientSecret?: string;
  /** Redirect URI for Sign in with Apple web flow. */
  appleRedirectUri?: string;
}

export interface AppleAuthArtifacts {
  refreshToken: string | null;
  accessToken?: string | null;
  idToken?: string | null;
  authorizationCode?: string | null;
  tokenType?: string | null;
  scope?: string | null;
  accessTokenExpiresAt?: Date | string | null;
  refreshTokenIssuedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

interface AppleTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
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

  private async getAppleClientSecret(clientId: string, explicitSecret?: string): Promise<string> {
    if (explicitSecret) return explicitSecret;
    if (this.cfg.appleClientSecret && clientId === this.cfg.appleWebClientId) {
      return this.cfg.appleClientSecret;
    }
    if (!this.cfg.appleTeamId || !this.cfg.appleKeyId || !this.cfg.applePrivateKey) {
      throw new NotConfiguredError("apple client secret not configured");
    }

    const privateKey = await jose.importPKCS8(this.cfg.applePrivateKey, "ES256");
    return await new jose.SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.cfg.appleKeyId })
      .setIssuer(this.cfg.appleTeamId)
      .setIssuedAt()
      .setAudience("https://appleid.apple.com")
      .setSubject(clientId)
      .setExpirationTime("180d")
      .sign(privateKey);
  }

  private async postAppleTokenForm(
    body: URLSearchParams
  ): Promise<AppleTokenResponse> {
    const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.log(`[auth] apple token exchange failed: ${tokenRes.status} ${errBody}`);
      throw new UnauthorizedError("authorization code exchange failed");
    }

    return (await tokenRes.json()) as AppleTokenResponse;
  }

  private async exchangeAppleAuthorizationCode(
    code: string,
    clientId: string,
    explicitSecret?: string,
    redirectUri?: string
  ): Promise<AppleTokenResponse> {
    const clientSecret = await this.getAppleClientSecret(clientId, explicitSecret);
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    });
    if (redirectUri) body.set("redirect_uri", redirectUri);
    return await this.postAppleTokenForm(body);
  }

  private async refreshAppleAuthorization(
    refreshToken: string,
    clientId: string,
    explicitSecret?: string
  ): Promise<AppleTokenResponse> {
    const clientSecret = await this.getAppleClientSecret(clientId, explicitSecret);
    return await this.postAppleTokenForm(
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      })
    );
  }

  private async revokeAppleToken(
    token: string,
    clientId: string,
    explicitSecret?: string,
    tokenTypeHint: "refresh_token" | "access_token" = "refresh_token"
  ): Promise<void> {
    const clientSecret = await this.getAppleClientSecret(clientId, explicitSecret);
    const res = await fetch("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: tokenTypeHint,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.log(`[auth] apple token revoke failed: ${res.status} ${errBody}`);
      throw new UnauthorizedError("token revocation failed");
    }
  }

  async parseSessionTokenAllowExpired(tokenStr: string): Promise<string> {
    const { payload } = await jose.compactVerify(tokenStr, this.secretKey, {
      algorithms: ["HS256"],
    });
    const decoded = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    const uid = decoded.uid;
    if (typeof uid !== "string") throw new Error("invalid session token");
    return uid;
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

  // ── Pure Business Methods ─────────────────────────────────────────────

  /** Authenticate via mobile Sign in with Apple (identity token). */
  async authenticateWithApple(
    identityToken: string,
    name?: string,
    authorizationCode?: string
  ): Promise<{ token: string; user: User }> {
    if (!identityToken) {
      throw new ValidationError("identity_token is required");
    }

    let sub: string, email: string;
    let exchangedTokens: AppleTokenResponse | null = null;
    try {
      ({ sub, email } = await this.verifyAppleIdToken(identityToken));
    } catch (err) {
      console.log(`[auth] apple token verification failed: ${err}`);
      throw new UnauthorizedError("token verification failed");
    }

    if (authorizationCode && this.db.storeAppleAuthArtifacts) {
      try {
        exchangedTokens = await this.exchangeAppleAuthorizationCode(
          authorizationCode,
          this.cfg.appleBundleId,
          this.cfg.appleBundleClientSecret
        );
      } catch (err) {
        if (err instanceof UnauthorizedError || err instanceof NotConfiguredError) throw err;
        console.log(`[auth] native apple code exchange error: ${err}`);
        throw new ServiceError("INTERNAL", "token exchange failed");
      }
    }

    let user: User;
    try {
      user = await this.db.upsertUserByAppleSub(
        randomUUID(),
        sub,
        email,
        name ?? ""
      );
    } catch {
      throw new ServiceError("INTERNAL", "failed to create user");
    }

    if (this.db.storeAppleAuthArtifacts && exchangedTokens) {
      await this.db.storeAppleAuthArtifacts(user.id, {
        refreshToken: exchangedTokens.refresh_token ?? null,
        accessToken: exchangedTokens.access_token ?? null,
        idToken: exchangedTokens.id_token ?? identityToken,
        authorizationCode,
        tokenType: exchangedTokens.token_type ?? null,
        scope: exchangedTokens.scope ?? null,
        accessTokenExpiresAt: exchangedTokens.expires_in
          ? new Date(Date.now() + exchangedTokens.expires_in * 1000)
          : null,
        refreshTokenIssuedAt: exchangedTokens.refresh_token ? new Date() : null,
        updatedAt: new Date(),
      });
    }

    const token = await this.createSessionToken(user.id);
    return { token, user };
  }

  /**
   * Authenticate via Sign in with Apple web OAuth2 code exchange.
   * Requires appleClientSecret and appleRedirectUri in config.
   */
  async authenticateWithWeb(
    code: string,
    name?: string
  ): Promise<{ token: string; user: User }> {
    if (!this.cfg.appleRedirectUri || !this.cfg.appleWebClientId) {
      throw new NotConfiguredError("web auth not configured");
    }

    if (!code) {
      throw new ValidationError("authorization code is required");
    }

    // Exchange authorization code for tokens
    let tokenData: AppleTokenResponse;
    try {
      tokenData = await this.exchangeAppleAuthorizationCode(
        code,
        this.cfg.appleWebClientId,
        this.cfg.appleWebClientSecret ?? this.cfg.appleClientSecret,
        this.cfg.appleRedirectUri
      );
      if (!tokenData.id_token) {
        throw new UnauthorizedError("no id_token in response");
      }
    } catch (err) {
      if (
        err instanceof UnauthorizedError ||
        err instanceof NotConfiguredError
      ) {
        throw err;
      }
      console.log(`[auth] apple token exchange error: ${err}`);
      throw new ServiceError("INTERNAL", "token exchange failed");
    }

    // Verify the id_token
    let sub: string, email: string;
    try {
      ({ sub, email } = await this.verifyAppleIdToken(tokenData.id_token!));
    } catch (err) {
      console.log(`[auth] web id_token verification failed: ${err}`);
      throw new UnauthorizedError("token verification failed");
    }

    let user: User;
    try {
      user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, name ?? "");
    } catch {
      throw new ServiceError("INTERNAL", "failed to create user");
    }

    if (this.db.storeAppleAuthArtifacts) {
      await this.db.storeAppleAuthArtifacts(user.id, {
        refreshToken: tokenData.refresh_token ?? null,
        accessToken: tokenData.access_token ?? null,
        idToken: tokenData.id_token ?? null,
        authorizationCode: code,
        tokenType: tokenData.token_type ?? null,
        scope: tokenData.scope ?? null,
        accessTokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null,
        refreshTokenIssuedAt: tokenData.refresh_token ? new Date() : null,
        updatedAt: new Date(),
      });
    }

    const token = await this.createSessionToken(user.id);
    return { token, user };
  }

  async refreshSession(userId: string): Promise<{ token: string; user: User }> {
    if (!this.db.getAppleAuthArtifacts || !this.db.storeAppleAuthArtifacts) {
      throw new NotConfiguredError("apple token persistence not configured");
    }

    const existing = await this.db.getAppleAuthArtifacts(userId);
    if (!existing?.refreshToken) {
      throw new UnauthorizedError("no refresh token available");
    }

    let tokenData: AppleTokenResponse;
    try {
      tokenData = await this.refreshAppleAuthorization(
        existing.refreshToken,
        this.cfg.appleBundleId,
        this.cfg.appleBundleClientSecret
      );
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof NotConfiguredError) throw err;
      console.log(`[auth] apple refresh error: ${err}`);
      throw new ServiceError("INTERNAL", "token refresh failed");
    }

    if (!tokenData.id_token) {
      throw new UnauthorizedError("no id_token in refresh response");
    }

    const claims = await this.verifyAppleIdToken(tokenData.id_token);
    const user = await this.getUser(userId);
    if (claims.sub !== user.apple_sub) {
      throw new UnauthorizedError("apple subject mismatch");
    }

    await this.db.storeAppleAuthArtifacts(userId, {
      refreshToken: tokenData.refresh_token ?? existing.refreshToken,
      accessToken: tokenData.access_token ?? null,
      idToken: tokenData.id_token,
      tokenType: tokenData.token_type ?? null,
      scope: tokenData.scope ?? null,
      accessTokenExpiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null,
      refreshTokenIssuedAt: tokenData.refresh_token ? new Date() : existing.refreshTokenIssuedAt ?? null,
      updatedAt: new Date(),
    });

    const token = await this.createSessionToken(user.id);
    return { token, user };
  }

  async revokeAppleTokens(userId: string): Promise<{ revoked: boolean; reason?: string }> {
    if (!this.db.getAppleAuthArtifacts) {
      return { revoked: false, reason: "apple token persistence not configured" };
    }

    const existing = await this.db.getAppleAuthArtifacts(userId);
    if (!existing?.refreshToken && !existing?.accessToken) {
      return { revoked: false, reason: "no apple token available" };
    }

    try {
      if (existing.refreshToken) {
        await this.revokeAppleToken(
          existing.refreshToken,
          this.cfg.appleBundleId,
          this.cfg.appleBundleClientSecret,
          "refresh_token"
        );
      } else if (existing.accessToken) {
        await this.revokeAppleToken(
          existing.accessToken,
          this.cfg.appleBundleId,
          this.cfg.appleBundleClientSecret,
          "access_token"
        );
      }
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        return { revoked: false, reason: "apple client secret not configured" };
      }
      throw err;
    }

    await this.db.deleteAppleAuthArtifacts?.(userId);
    return { revoked: true };
  }

  /** Get the current user by ID. */
  async getUser(userId: string): Promise<User> {
    try {
      return await this.db.userById(userId);
    } catch {
      throw new NotFoundError("user not found");
    }
  }

  /** Revoke a specific session token. */
  async logout(sessionToken?: string): Promise<void> {
    if (this.cfg.sessionDB && sessionToken) {
      try {
        const { payload } = await jose.jwtVerify(sessionToken, this.secretKey, { algorithms: ["HS256"] });
        if (payload.jti) await this.cfg.sessionDB.revokeSession(payload.jti);
      } catch {
        // Token invalid or expired — no session to revoke
      }
    }
  }

  /** Revoke all sessions for a user. */
  async logoutAll(userId: string): Promise<void> {
    if (!this.cfg.sessionDB) {
      throw new NotConfiguredError("session management not configured");
    }
    await this.cfg.sessionDB.revokeAllSessions(userId);
  }

  /** List active sessions for a user (multi-device visibility). */
  async listSessions(userId: string): Promise<Array<{ jti: string; createdAt: Date | string }>> {
    if (!this.cfg.sessionDB?.activeSessions) {
      throw new NotConfiguredError("session listing not available");
    }
    return await this.cfg.sessionDB.activeSessions(userId);
  }

  /** Revoke a specific session by jti. */
  async revokeSession(jti: string): Promise<void> {
    if (!this.cfg.sessionDB) {
      throw new NotConfiguredError("session management not configured");
    }
    if (!jti) {
      throw new ValidationError("session id is required");
    }
    await this.cfg.sessionDB.revokeSession(jti);
  }
}
