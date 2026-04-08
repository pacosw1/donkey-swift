import * as jose from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ValidationError, NotFoundError, UnauthorizedError, NotConfiguredError, ServiceError, } from "../errors/index.js";
// ── Service ─────────────────────────────────────────────────────────────────
export class AuthService {
    cfg;
    db;
    secretKey;
    sessionExpirySec;
    refreshTokenExpirySec;
    jwks = null;
    jwksExpiry = 0;
    jwksFetchPromise = null;
    constructor(cfg, db) {
        this.cfg = cfg;
        this.db = db;
        this.secretKey = new TextEncoder().encode(cfg.jwtSecret);
        this.sessionExpirySec = cfg.sessionExpirySec ?? 24 * 60 * 60;
        this.refreshTokenExpirySec = cfg.refreshTokenExpirySec ?? 90 * 24 * 60 * 60;
    }
    hashRefreshToken(refreshToken) {
        return createHash("sha256")
            .update(this.cfg.jwtSecret)
            .update(":")
            .update(refreshToken)
            .digest("hex");
    }
    requiresRefreshSessions() {
        if (!this.cfg.sessionDB?.createRefreshSession ||
            !this.cfg.sessionDB.getRefreshSessionByTokenHash ||
            !this.cfg.sessionDB.rotateRefreshSession ||
            !this.cfg.sessionDB.revokeRefreshSession ||
            !this.cfg.sessionDB.revokeAllRefreshSessions) {
            throw new NotConfiguredError("refresh session management not configured");
        }
        return this.cfg.sessionDB;
    }
    async issueAppSession(user, options) {
        const accessToken = await this.createSessionToken(user.id);
        let refreshToken = null;
        if (this.cfg.sessionDB?.createRefreshSession) {
            const decoded = jose.decodeJwt(accessToken);
            const sessionJti = decoded.jti;
            if (typeof sessionJti !== "string" || !sessionJti) {
                throw new ServiceError("INTERNAL", "failed to create session");
            }
            refreshToken = randomBytes(48).toString("base64url");
            await this.cfg.sessionDB.createRefreshSession({
                id: randomUUID(),
                userId: user.id,
                tokenHash: this.hashRefreshToken(refreshToken),
                sessionJti,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + this.refreshTokenExpirySec * 1000),
                rotatedAt: null,
                revokedAt: null,
                installationId: options?.installationId ?? null,
                metadata: options?.metadata ?? null,
            });
        }
        return {
            token: accessToken,
            accessToken,
            refreshToken,
            user,
        };
    }
    async getAppleClientSecret(clientId, explicitSecret) {
        if (explicitSecret)
            return explicitSecret;
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
    async postAppleTokenForm(body) {
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
        return (await tokenRes.json());
    }
    async exchangeAppleAuthorizationCode(code, clientId, explicitSecret, redirectUri) {
        const clientSecret = await this.getAppleClientSecret(clientId, explicitSecret);
        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
        });
        if (redirectUri)
            body.set("redirect_uri", redirectUri);
        return await this.postAppleTokenForm(body);
    }
    async refreshAppleAuthorization(refreshToken, clientId, explicitSecret) {
        const clientSecret = await this.getAppleClientSecret(clientId, explicitSecret);
        return await this.postAppleTokenForm(new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        }));
    }
    async revokeAppleToken(token, clientId, explicitSecret, tokenTypeHint = "refresh_token") {
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
    async parseSessionTokenAllowExpired(tokenStr) {
        const { payload } = await jose.compactVerify(tokenStr, this.secretKey, {
            algorithms: ["HS256"],
        });
        const decoded = JSON.parse(new TextDecoder().decode(payload));
        const uid = decoded.uid;
        if (typeof uid !== "string")
            throw new Error("invalid session token");
        return uid;
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
    async authenticateWithApple(identityToken, name, authorizationCode, options) {
        if (!identityToken) {
            throw new ValidationError("identity_token is required");
        }
        let sub, email;
        let exchangedTokens = null;
        try {
            ({ sub, email } = await this.verifyAppleIdToken(identityToken));
        }
        catch (err) {
            console.log(`[auth] apple token verification failed: ${err}`);
            throw new UnauthorizedError("token verification failed");
        }
        if (authorizationCode && this.db.storeAppleAuthArtifacts) {
            try {
                exchangedTokens = await this.exchangeAppleAuthorizationCode(authorizationCode, this.cfg.appleBundleId, this.cfg.appleBundleClientSecret);
            }
            catch (err) {
                if (err instanceof UnauthorizedError || err instanceof NotConfiguredError)
                    throw err;
                console.log(`[auth] native apple code exchange error: ${err}`);
                throw new ServiceError("INTERNAL", "token exchange failed");
            }
        }
        let user;
        try {
            user = await this.db.upsertUserByAppleSub(randomUUID(), sub, email, name ?? "");
        }
        catch {
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
        return await this.issueAppSession(user, options);
    }
    /**
     * Authenticate via Sign in with Apple web OAuth2 code exchange.
     * Requires appleClientSecret and appleRedirectUri in config.
     */
    async authenticateWithWeb(code, name, options) {
        if (!this.cfg.appleRedirectUri || !this.cfg.appleWebClientId) {
            throw new NotConfiguredError("web auth not configured");
        }
        if (!code) {
            throw new ValidationError("authorization code is required");
        }
        // Exchange authorization code for tokens
        let tokenData;
        try {
            tokenData = await this.exchangeAppleAuthorizationCode(code, this.cfg.appleWebClientId, this.cfg.appleWebClientSecret ?? this.cfg.appleClientSecret, this.cfg.appleRedirectUri);
            if (!tokenData.id_token) {
                throw new UnauthorizedError("no id_token in response");
            }
        }
        catch (err) {
            if (err instanceof UnauthorizedError ||
                err instanceof NotConfiguredError) {
                throw err;
            }
            console.log(`[auth] apple token exchange error: ${err}`);
            throw new ServiceError("INTERNAL", "token exchange failed");
        }
        // Verify the id_token
        let sub, email;
        try {
            ({ sub, email } = await this.verifyAppleIdToken(tokenData.id_token));
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
        return await this.issueAppSession(user, options);
    }
    async refreshSessionFromApple(userId) {
        if (!this.db.getAppleAuthArtifacts || !this.db.storeAppleAuthArtifacts) {
            throw new NotConfiguredError("apple token persistence not configured");
        }
        const existing = await this.db.getAppleAuthArtifacts(userId);
        if (!existing?.refreshToken) {
            throw new UnauthorizedError("no refresh token available");
        }
        let tokenData;
        try {
            tokenData = await this.refreshAppleAuthorization(existing.refreshToken, this.cfg.appleBundleId, this.cfg.appleBundleClientSecret);
        }
        catch (err) {
            if (err instanceof UnauthorizedError || err instanceof NotConfiguredError)
                throw err;
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
        return await this.issueAppSession(user);
    }
    async refreshSession(refreshToken) {
        if (!refreshToken) {
            throw new ValidationError("refresh_token is required");
        }
        const sessionDB = this.requiresRefreshSessions();
        const now = new Date();
        const tokenHash = this.hashRefreshToken(refreshToken);
        const existing = await sessionDB.getRefreshSessionByTokenHash(tokenHash);
        if (!existing || existing.revokedAt || new Date(existing.expiresAt) <= now) {
            throw new UnauthorizedError("refresh token invalid");
        }
        const user = await this.getUser(existing.userId);
        const accessToken = await this.createSessionToken(user.id);
        const decoded = jose.decodeJwt(accessToken);
        const sessionJti = decoded.jti;
        if (typeof sessionJti !== "string" || !sessionJti) {
            throw new ServiceError("INTERNAL", "failed to create session");
        }
        const nextRefreshToken = randomBytes(48).toString("base64url");
        const rotated = await sessionDB.rotateRefreshSession(tokenHash, {
            id: randomUUID(),
            userId: user.id,
            tokenHash: this.hashRefreshToken(nextRefreshToken),
            sessionJti,
            createdAt: now,
            expiresAt: new Date(now.getTime() + this.refreshTokenExpirySec * 1000),
            rotatedAt: null,
            revokedAt: null,
            installationId: existing.installationId ?? null,
            metadata: existing.metadata ?? null,
        });
        if (!rotated) {
            throw new UnauthorizedError("refresh token invalid");
        }
        if (existing.sessionJti) {
            await this.cfg.sessionDB?.revokeSession(existing.sessionJti).catch(() => undefined);
        }
        return {
            token: accessToken,
            accessToken,
            refreshToken: nextRefreshToken,
            user,
        };
    }
    async revokeAppleTokens(userId) {
        if (!this.db.getAppleAuthArtifacts) {
            return { revoked: false, reason: "apple token persistence not configured" };
        }
        const existing = await this.db.getAppleAuthArtifacts(userId);
        if (!existing?.refreshToken && !existing?.accessToken) {
            return { revoked: false, reason: "no apple token available" };
        }
        try {
            if (existing.refreshToken) {
                await this.revokeAppleToken(existing.refreshToken, this.cfg.appleBundleId, this.cfg.appleBundleClientSecret, "refresh_token");
            }
            else if (existing.accessToken) {
                await this.revokeAppleToken(existing.accessToken, this.cfg.appleBundleId, this.cfg.appleBundleClientSecret, "access_token");
            }
        }
        catch (err) {
            if (err instanceof NotConfiguredError) {
                return { revoked: false, reason: "apple client secret not configured" };
            }
            throw err;
        }
        await this.db.deleteAppleAuthArtifacts?.(userId);
        return { revoked: true };
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
        await this.cfg.sessionDB.revokeAllRefreshSessions?.(userId, new Date());
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
    async revokeRefreshSession(refreshToken) {
        if (!refreshToken) {
            throw new ValidationError("refresh_token is required");
        }
        const sessionDB = this.requiresRefreshSessions();
        await sessionDB.revokeRefreshSession(this.hashRefreshToken(refreshToken), new Date());
    }
}
//# sourceMappingURL=index.js.map