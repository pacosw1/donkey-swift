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
        const res = await fetch("https://appleid.apple.com/auth/keys");
        if (!res.ok)
            throw new Error("failed to fetch Apple JWKS");
        this.jwks = (await res.json());
        this.jwksExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h cache
        return this.jwks;
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
        return {
            sub: payload.sub,
            email: payload.email ?? "",
        };
    }
    // ── Session JWT ─────────────────────────────────────────────────────────
    async createSessionToken(userId) {
        return new jose.SignJWT({ uid: userId })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            .setExpirationTime(`${this.sessionExpirySec}s`)
            .setJti(randomUUID())
            .sign(this.secretKey);
    }
    async parseSessionToken(tokenStr) {
        const { payload } = await jose.jwtVerify(tokenStr, this.secretKey, {
            algorithms: ["HS256"],
        });
        const uid = payload.uid;
        if (typeof uid !== "string")
            throw new Error("invalid session token");
        return uid;
    }
    // ── HTTP Handlers ───────────────────────────────────────────────────────
    /** POST /api/v1/auth/apple */
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
    /** POST /api/v1/auth/logout */
    handleLogout = async (c) => {
        deleteCookie(c, this.cfg.cookieName ?? "session", { path: "/" });
        return c.json({ status: "logged out" });
    };
}
//# sourceMappingURL=index.js.map