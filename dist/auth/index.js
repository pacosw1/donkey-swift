import { setCookie, deleteCookie } from "hono/cookie";
import * as jose from "jose";
import { randomUUID } from "node:crypto";
// ── Service ─────────────────────────────────────────────────────────────────
export class AuthService {
    cfg;
    db;
    secretKey;
    sessionExpirySec;
    jwks = null;
    jwksExpiry = 0;
    jwksFetchPromise = null;
    constructor(cfg, db) {
        this.cfg = cfg;
        this.db = db;
        this.secretKey = new TextEncoder().encode(cfg.jwtSecret);
        this.sessionExpirySec = cfg.sessionExpirySec ?? 7 * 24 * 60 * 60;
    }
    // ── Apple ID Token Verification ─────────────────────────────────────────
    async getAppleJWKS() {
        if (this.jwks && Date.now() < this.jwksExpiry)
            return this.jwks;
        // Deduplicate concurrent fetches
        if (this.jwksFetchPromise)
            return this.jwksFetchPromise;
        this.jwksFetchPromise = (async () => {
            try {
                const res = await fetch("https://appleid.apple.com/auth/keys");
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
                const data = (await res.json());
                this.jwks = data;
                this.jwksExpiry = Date.now() + 24 * 60 * 60 * 1000;
                return data;
            }
            finally {
                this.jwksFetchPromise = null;
            }
        })();
        return this.jwksFetchPromise;
    }
    async verifyAppleIdToken(tokenString) {
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
        if (!aud.some((a) => validAudiences.includes(a))) {
            throw new Error("invalid audience");
        }
        const claims = payload;
        return {
            sub: payload.sub,
            email: claims.email ?? "",
            emailVerified: claims.email_verified ?? false,
        };
    }
    // ── Session JWT ─────────────────────────────────────────────────────────
    async createSessionToken(userId) {
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
    async parseSessionToken(tokenStr) {
        const { payload } = await jose.jwtVerify(tokenStr, this.secretKey, {
            algorithms: ["HS256"],
        });
        const uid = payload.uid;
        if (typeof uid !== "string")
            throw new Error("invalid session token");
        // Check session store for revocation
        if (this.cfg.sessionDB && payload.jti) {
            const valid = await this.cfg.sessionDB.isSessionValid(payload.jti);
            if (!valid)
                throw new Error("session revoked");
        }
        return uid;
    }
    // ── HTTP Handlers ───────────────────────────────────────────────────────
    /** POST /api/v1/auth/apple — mobile Sign in with Apple (identity token). */
    handleAppleAuth = async (c) => {
        const body = await c.req.json();
        if (!body.identity_token) {
            return c.json({ error: "identity_token is required" }, 400);
        }
        let sub, email;
        try {
            ({ sub, email } = await this.verifyAppleIdToken(body.identity_token));
        }
        catch (err) {
            console.log(`[auth] apple token verification failed: ${err}`);
            return c.json({ error: "token verification failed" }, 401);
        }
        let user;
        try {
            user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, body.name ?? "");
        }
        catch {
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
    handleWebAuth = async (c) => {
        if (!this.cfg.appleClientSecret || !this.cfg.appleRedirectUri || !this.cfg.appleWebClientId) {
            return c.json({ error: "web auth not configured" }, 501);
        }
        const body = await c.req.json();
        if (!body.code)
            return c.json({ error: "authorization code is required" }, 400);
        // Exchange authorization code for tokens
        let idToken;
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
            const tokenData = (await tokenRes.json());
            if (!tokenData.id_token)
                return c.json({ error: "no id_token in response" }, 401);
            idToken = tokenData.id_token;
        }
        catch (err) {
            console.log(`[auth] apple token exchange error: ${err}`);
            return c.json({ error: "token exchange failed" }, 502);
        }
        // Verify the id_token
        let sub, email;
        try {
            ({ sub, email } = await this.verifyAppleIdToken(idToken));
        }
        catch (err) {
            console.log(`[auth] web id_token verification failed: ${err}`);
            return c.json({ error: "token verification failed" }, 401);
        }
        let user;
        try {
            user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, body.name ?? "");
        }
        catch {
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
    handleMe = async (c) => {
        const userId = c.get("userId");
        try {
            const user = await this.db.userById(userId);
            return c.json(user);
        }
        catch {
            return c.json({ error: "user not found" }, 404);
        }
    };
    /** POST /api/v1/auth/logout — revokes current session. */
    handleLogout = async (c) => {
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
                    if (payload.jti)
                        await this.cfg.sessionDB.revokeSession(payload.jti);
                }
            }
            catch {
                // Token invalid or expired — no session to revoke
            }
        }
        deleteCookie(c, this.cfg.cookieName ?? "session", { path: "/" });
        return c.json({ status: "logged out" });
    };
    /** POST /api/v1/auth/logout-all — revokes all sessions for the current user. */
    handleLogoutAll = async (c) => {
        if (!this.cfg.sessionDB)
            return c.json({ error: "session management not configured" }, 501);
        const userId = c.get("userId");
        await this.cfg.sessionDB.revokeAllSessions(userId);
        deleteCookie(c, this.cfg.cookieName ?? "session", { path: "/" });
        return c.json({ status: "all sessions revoked" });
    };
    /** GET /api/v1/auth/sessions — list active sessions (multi-device visibility). */
    handleListSessions = async (c) => {
        if (!this.cfg.sessionDB?.activeSessions)
            return c.json({ error: "session listing not available" }, 501);
        const userId = c.get("userId");
        const sessions = await this.cfg.sessionDB.activeSessions(userId);
        return c.json({ sessions });
    };
    /** DELETE /api/v1/auth/sessions/:jti — revoke a specific session. */
    handleRevokeSession = async (c) => {
        if (!this.cfg.sessionDB)
            return c.json({ error: "session management not configured" }, 501);
        const jti = c.req.param("jti");
        if (!jti)
            return c.json({ error: "session id is required" }, 400);
        await this.cfg.sessionDB.revokeSession(jti);
        return c.json({ status: "session revoked" });
    };
}
//# sourceMappingURL=index.js.map