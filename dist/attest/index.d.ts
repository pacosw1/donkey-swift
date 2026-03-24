import type { Context } from "hono";
export interface AttestDB {
    storeAttestKey(userId: string, keyId: string, publicKey: string): Promise<void>;
    getAttestKey(userId: string): Promise<{
        keyId: string;
        publicKey: string;
    }>;
    storeChallenge(nonce: string, userId: string, expiresAt: Date): Promise<void>;
    consumeChallenge(nonce: string, userId: string): Promise<boolean>;
}
export interface AttestConfig {
    /** Apple App ID (teamId.bundleId). Required for production attestation. */
    appId?: string;
    /** Challenge TTL in seconds (default: 300 = 5 minutes). */
    challengeTtlSec?: number;
    /** Set to true for production (uses Apple production attestation root). */
    production?: boolean;
}
export declare class AttestService {
    private db?;
    private cfg?;
    private challengeTtlSec;
    constructor(db?: AttestDB | undefined, cfg?: AttestConfig | undefined);
    /** Generate a hex nonce for attestation challenges. */
    generateHexNonce(): string;
    /** POST /api/v1/attest/challenge */
    handleChallenge: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        nonce: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/attest/verify */
    handleVerify: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** POST /api/v1/attest/assert — verify an assertion for ongoing requests. */
    handleAssert: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 403, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** Middleware: require valid attestation (checks that the device has been attested). */
    requireAttest: (c: Context, next: () => Promise<void>) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 401, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 403, "json">) | undefined>;
}
//# sourceMappingURL=index.d.ts.map