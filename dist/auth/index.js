import * as jose from "jose";
import { randomUUID } from "node:crypto";
import { ValidationError, NotFoundError, UnauthorizedError, NotConfiguredError, ServiceError, } from "../errors/index.js";
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
    // ── Pure Business Methods ─────────────────────────────────────────────
    /** Authenticate via mobile Sign in with Apple (identity token). */
    async authenticateWithApple(identityToken, name) {
        if (!identityToken) {
            throw new ValidationError("identity_token is required");
        }
        let sub, email;
        try {
            ({ sub, email } = await this.verifyAppleIdToken(identityToken));
        }
        catch (err) {
            console.log(`[auth] apple token verification failed: ${err}`);
            throw new UnauthorizedError("token verification failed");
        }
        let user;
        try {
            user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, name ?? "");
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to create user");
        }
        const token = await this.createSessionToken(user.id);
        return { token, user };
    }
    /**
     * Authenticate via Sign in with Apple web OAuth2 code exchange.
     * Requires appleClientSecret and appleRedirectUri in config.
     */
    async authenticateWithWeb(code, name) {
        if (!this.cfg.appleClientSecret || !this.cfg.appleRedirectUri || !this.cfg.appleWebClientId) {
            throw new NotConfiguredError("web auth not configured");
        }
        if (!code) {
            throw new ValidationError("authorization code is required");
        }
        // Exchange authorization code for tokens
        let idToken;
        try {
            const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: this.cfg.appleWebClientId,
                    client_secret: this.cfg.appleClientSecret,
                    code,
                    grant_type: "authorization_code",
                    redirect_uri: this.cfg.appleRedirectUri,
                }),
            });
            if (!tokenRes.ok) {
                const errBody = await tokenRes.text();
                console.log(`[auth] apple token exchange failed: ${tokenRes.status} ${errBody}`);
                throw new UnauthorizedError("authorization code exchange failed");
            }
            const tokenData = (await tokenRes.json());
            if (!tokenData.id_token) {
                throw new UnauthorizedError("no id_token in response");
            }
            idToken = tokenData.id_token;
        }
        catch (err) {
            if (err instanceof UnauthorizedError)
                throw err;
            console.log(`[auth] apple token exchange error: ${err}`);
            throw new ServiceError("INTERNAL", "token exchange failed");
        }
        // Verify the id_token
        let sub, email;
        try {
            ({ sub, email } = await this.verifyAppleIdToken(idToken));
        }
        catch (err) {
            console.log(`[auth] web id_token verification failed: ${err}`);
            throw new UnauthorizedError("token verification failed");
        }
        let user;
        try {
            user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, name ?? "");
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to create user");
        }
        const token = await this.createSessionToken(user.id);
        return { token, user };
    }
    /** Get the current user by ID. */
    async getUser(userId) {
        try {
            return await this.db.userById(userId);
        }
        catch {
            throw new NotFoundError("user not found");
        }
    }
    /** Revoke a specific session token. */
    async logout(sessionToken) {
        if (this.cfg.sessionDB && sessionToken) {
            try {
                const { payload } = await jose.jwtVerify(sessionToken, this.secretKey, { algorithms: ["HS256"] });
                if (payload.jti)
                    await this.cfg.sessionDB.revokeSession(payload.jti);
            }
            catch {
                // Token invalid or expired — no session to revoke
            }
        }
    }
    /** Revoke all sessions for a user. */
    async logoutAll(userId) {
        if (!this.cfg.sessionDB) {
            throw new NotConfiguredError("session management not configured");
        }
        await this.cfg.sessionDB.revokeAllSessions(userId);
    }
    /** List active sessions for a user (multi-device visibility). */
    async listSessions(userId) {
        if (!this.cfg.sessionDB?.activeSessions) {
            throw new NotConfiguredError("session listing not available");
        }
        return await this.cfg.sessionDB.activeSessions(userId);
    }
    /** Revoke a specific session by jti. */
    async revokeSession(jti) {
        if (!this.cfg.sessionDB) {
            throw new NotConfiguredError("session management not configured");
        }
        if (!jti) {
            throw new ValidationError("session id is required");
        }
        await this.cfg.sessionDB.revokeSession(jti);
    }
}
//# sourceMappingURL=index.js.map