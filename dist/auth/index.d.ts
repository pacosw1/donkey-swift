export interface AuthDB {
    upsertUserByAppleSub(id: string, appleSub: string, email: string, name: string): Promise<User>;
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
    activeSessions?(userId: string): Promise<Array<{
        jti: string;
        createdAt: Date | string;
    }>>;
    /** Persist a long-lived refresh session using a hashed token identifier. */
    createRefreshSession?(record: RefreshSessionRecord): Promise<void>;
    /** Look up an active refresh session by hashed token identifier. */
    getRefreshSessionByTokenHash?(tokenHash: string): Promise<RefreshSessionRecord | null>;
    /** Rotate a refresh session atomically. */
    rotateRefreshSession?(currentTokenHash: string, nextRecord: RefreshSessionRecord): Promise<RefreshSessionRecord | null>;
    /** Revoke a single refresh session. */
    revokeRefreshSession?(tokenHash: string, revokedAt: Date): Promise<void>;
    /** Revoke all refresh sessions for a user. */
    revokeAllRefreshSessions?(userId: string, revokedAt: Date): Promise<void>;
}
export interface RefreshSessionRecord {
    id: string;
    userId: string;
    tokenHash: string;
    sessionJti: string;
    createdAt: Date | string;
    expiresAt: Date | string;
    rotatedAt?: Date | string | null;
    revokedAt?: Date | string | null;
    installationId?: string | null;
    metadata?: Record<string, unknown> | null;
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
    /** Access token expiry in seconds (default: 1 day). */
    sessionExpirySec?: number;
    /** Refresh token expiry in seconds (default: 90 days). */
    refreshTokenExpirySec?: number;
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
export interface SessionIssueOptions {
    installationId?: string;
    metadata?: Record<string, unknown>;
}
export interface AuthSessionResult {
    token: string;
    accessToken: string;
    refreshToken: string | null;
    user: User;
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
export declare class AuthService {
    private cfg;
    private db;
    private secretKey;
    private sessionExpirySec;
    private refreshTokenExpirySec;
    private jwks;
    private jwksExpiry;
    private jwksFetchPromise;
    constructor(cfg: AuthConfig, db: AuthDB);
    private hashRefreshToken;
    private requiresRefreshSessions;
    private issueAppSession;
    private getAppleClientSecret;
    private postAppleTokenForm;
    private exchangeAppleAuthorizationCode;
    private refreshAppleAuthorization;
    private revokeAppleToken;
    parseSessionTokenAllowExpired(tokenStr: string): Promise<string>;
    private getAppleJWKS;
    verifyAppleIdToken(tokenString: string): Promise<{
        sub: string;
        email: string;
        emailVerified: boolean;
    }>;
    createSessionToken(userId: string): Promise<string>;
    parseSessionToken(tokenStr: string): Promise<string>;
    /** Authenticate via mobile Sign in with Apple (identity token). */
    authenticateWithApple(identityToken: string, name?: string, authorizationCode?: string, options?: SessionIssueOptions): Promise<AuthSessionResult>;
    /**
     * Authenticate via Sign in with Apple web OAuth2 code exchange.
     * Requires appleClientSecret and appleRedirectUri in config.
     */
    authenticateWithWeb(code: string, name?: string, options?: SessionIssueOptions): Promise<AuthSessionResult>;
    refreshSessionFromApple(userId: string): Promise<AuthSessionResult>;
    refreshSession(refreshToken: string): Promise<AuthSessionResult>;
    revokeAppleTokens(userId: string): Promise<{
        revoked: boolean;
        reason?: string;
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
    revokeRefreshSession(refreshToken: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map