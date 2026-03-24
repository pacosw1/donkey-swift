import type { Context } from "hono";
export interface AttestDB {
    storeAttestKey(userId: string, keyId: string): Promise<void>;
    getAttestKey(userId: string): Promise<string>;
}
export declare class AttestService {
    private db?;
    constructor(db?: AttestDB | undefined);
    /** Generate a hex nonce for attestation challenges. */
    generateHexNonce(): string;
    /** POST /api/v1/attest/challenge */
    handleChallenge: (c: Context) => Promise<Response & import("hono").TypedResponse<{
        nonce: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
    /** POST /api/v1/attest/verify */
    handleVerify: (c: Context) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 400, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 500, "json">) | (Response & import("hono").TypedResponse<{
        status: string;
    }, import("hono/utils/http-status").ContentfulStatusCode, "json">)>;
    /** Middleware: require valid attestation. */
    requireAttest: (c: Context, next: () => Promise<void>) => Promise<(Response & import("hono").TypedResponse<{
        error: string;
    }, 501, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 401, "json">) | (Response & import("hono").TypedResponse<{
        error: string;
    }, 403, "json">) | undefined>;
}
//# sourceMappingURL=index.d.ts.map