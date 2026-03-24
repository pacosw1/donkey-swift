import type { Context } from "hono";
export interface AuthDB {
    upsertUserByAppleSub(id: string, appleSub: string, email: string, name: string): Promise<User>;
    userById(id: string): Promise<User>;
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
}
export declare class AuthService {
    private cfg;
    private db;
    private secretKey;
    private sessionExpirySec;
    private jwks;
    private jwksExpiry;
    constructor(cfg: AuthConfig, db: AuthDB);
    private getAppleJWKS;
    verifyAppleIdToken(tokenString: string): Promise<{
        sub: string;
        email: string;
    }>;
    createSessionToken(userId: string): Promise<string>;
    parseSessionToken(tokenStr: string): Promise<string>;
    /** POST /api/v1/auth/apple */
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
    /** POST /api/v1/auth/logout */
    handleLogout: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
}
//# sourceMappingURL=index.d.ts.map