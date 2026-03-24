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
    /** Create a challenge nonce for attestation. Stores in DB if configured. */
    createChallenge(userId: string): Promise<{
        nonce: string;
    }>;
    /** Verify a device attestation object. */
    verifyAttestation(userId: string, input: {
        key_id: string;
        attestation: string;
        nonce: string;
    }): Promise<{
        status: string;
    }>;
    /** Verify an assertion from an attested device. */
    verifyAssertion(userId: string, input: {
        assertion: string;
        client_data?: string;
        nonce: string;
    }): Promise<{
        status: string;
    }>;
    /** Check if a user's device has been attested. Throws ForbiddenError if not. */
    checkAttestation(userId: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map