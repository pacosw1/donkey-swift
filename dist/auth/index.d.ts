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
    /** Authenticate via mobile Sign in with Apple (identity token). */
    authenticateWithApple(identityToken: string, name?: string): Promise<{
        token: string;
        user: User;
    }>;
    /**
     * Authenticate via Sign in with Apple web OAuth2 code exchange.
     * Requires appleClientSecret and appleRedirectUri in config.
     */
    authenticateWithWeb(code: string, name?: string): Promise<{
        token: string;
        user: User;
    }>;
    /** Get the current user by ID. */
    getUser(userId: string): Promise<User>;
    /** Revoke a specific session token. */
    logout(sessionToken?: string): Promise<void>;
    /** Revoke all sessions for a user. */
    logoutAll(userId: string): Promise<void>;
    /** List active sessions for a user (multi-device visibility). */
    listSessions(userId: string): Promise<Array<{
        jti: string;
        createdAt: Date | string;
    }>>;
    /** Revoke a specific session by jti. */
    revokeSession(jti: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map