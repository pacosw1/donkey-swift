import type { Context } from "hono";
export interface AuthDB {
    upsertUserByAppleSub(id: string, appleSub: string, email: string, name: string): Promise<User>;
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
    activeSessions?(userId: string): Promise<Array<{
        jti: string;
        createdAt: Date | string;
    }>>;
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
export declare class AuthService {
    private cfg;
    private db;
    private secretKey;
    private sessionExpirySec;
    private jwks;
    private jwksExpiry;
    private jwksFetchPromise;
    constructor(cfg: AuthConfig, db: AuthDB);
    private getAppleJWKS;
    verifyAppleIdToken(tokenString: string): Promise<{
        sub: string;
        email: string;
        emailVerified: boolean;
    }>;
    createSessionToken(userId: string): Promise<string>;
    parseSessionToken(tokenStr: string): Promise<string>;
    /** POST /api/v1/auth/apple — mobile Sign in with Apple (identity token). */
    handleAppleAuth: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 401, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        token: string;
        user: {
            id: string;
            apple_sub: string;
            email: string;
            name: string;
            created_at: string;
            last_login_at: string;
        };
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /**
     * POST /api/v1/auth/apple/web — Sign in with Apple web OAuth2 code exchange.
     * Requires appleClientSecret and appleRedirectUri in config.
     */
    handleWebAuth: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 401, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 502, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        token: string;
        user: {
            id: string;
            apple_sub: string;
            email: string;
            name: string;
            created_at: string;
            last_login_at: string;
        };
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** GET /api/v1/auth/me */
    handleMe: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        id: string;
        apple_sub: string;
        email: string;
        name: string;
        created_at: string;
        last_login_at: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 404, "json">)>;
    /** POST /api/v1/auth/logout — revokes current session. */
    handleLogout: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
    /** POST /api/v1/auth/logout-all — revokes all sessions for the current user. */
    handleLogoutAll: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** GET /api/v1/auth/sessions — list active sessions (multi-device visibility). */
    handleListSessions: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        sessions: {
            jti: string;
            createdAt: string;
        }[];
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** DELETE /api/v1/auth/sessions/:jti — revoke a specific session. */
    handleRevokeSession: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
}
//# sourceMappingURL=index.d.ts.map