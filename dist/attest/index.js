import { randomBytes, createHash, createVerify, X509Certificate } from "node:crypto";
import { Buffer } from "node:buffer";
import { ValidationError, NotConfiguredError, ForbiddenError, ServiceError } from "../errors/index.js";
// ── Service ─────────────────────────────────────────────────────────────────
export class AttestService {
    db;
    cfg;
    challengeTtlSec;
    constructor(db, cfg) {
        this.db = db;
        this.cfg = cfg;
        this.challengeTtlSec = cfg?.challengeTtlSec ?? 300;
    }
    /** Generate a hex nonce for attestation challenges. */
    generateHexNonce() {
        return randomBytes(32).toString("hex");
    }
    /** Create a challenge nonce for attestation. Stores in DB if configured. */
    async createChallenge(userId) {
        const nonce = this.generateHexNonce();
        if (this.db) {
            const expiresAt = new Date(Date.now() + this.challengeTtlSec * 1000);
            try {
                await this.db.storeChallenge(nonce, userId, expiresAt);
            }
            catch {
                throw new ServiceError("INTERNAL", "failed to store challenge");
            }
        }
        return { nonce };
    }
    /** Verify a device attestation object. */
    async verifyAttestation(userId, input) {
        if (!this.db)
            throw new NotConfiguredError("attestation not configured");
        if (!input.key_id)
            throw new ValidationError("key_id is required");
        if (!input.attestation)
            throw new ValidationError("attestation is required");
        if (!input.nonce)
            throw new ValidationError("nonce is required");
        // 1. Verify the challenge was issued to this user and hasn't expired
        const challengeValid = await this.db.consumeChallenge(input.nonce, userId);
        if (!challengeValid) {
            throw new ValidationError("invalid or expired challenge");
        }
        // 2. Decode and verify the attestation object
        let attestData;
        try {
            attestData = Buffer.from(input.attestation, "base64");
        }
        catch {
            throw new ValidationError("invalid attestation encoding");
        }
        // 3. Verify the attestation structure
        let parsed;
        try {
            parsed = decodeCBORAttestation(attestData);
        }
        catch (err) {
            throw new ValidationError(`invalid attestation format: ${err}`);
        }
        if (parsed.fmt !== "apple-appattest") {
            throw new ValidationError(`unexpected attestation format: ${parsed.fmt}`);
        }
        // 4. Verify the nonce is embedded in the attestation
        const clientDataHash = createHash("sha256")
            .update(Buffer.from(input.nonce, "hex"))
            .digest();
        const composite = Buffer.concat([parsed.authData, clientDataHash]);
        const expectedNonce = createHash("sha256").update(composite).digest();
        // 5. Verify the certificate chain
        if (!parsed.attStmt.x5c || parsed.attStmt.x5c.length < 2) {
            throw new ValidationError("attestation missing certificate chain");
        }
        try {
            const credCert = new X509Certificate(parsed.attStmt.x5c[0]);
            // Verify nonce in credential certificate
            const certNonce = extractAttestNonce(credCert);
            if (certNonce && !expectedNonce.equals(certNonce)) {
                throw new ValidationError("attestation nonce mismatch");
            }
            // Verify RP ID hash if appId configured
            const authDataKeyHash = parsed.authData.subarray(37, 69);
            if (authDataKeyHash.length >= 32 && this.cfg?.appId) {
                const rpIdHash = parsed.authData.subarray(0, 32);
                const expectedRpId = createHash("sha256").update(this.cfg.appId).digest();
                if (!rpIdHash.equals(expectedRpId)) {
                    throw new ValidationError("RP ID mismatch (wrong appId)");
                }
            }
            // Verify cert chain
            const intermediateCert = new X509Certificate(parsed.attStmt.x5c[1]);
            if (!credCert.verify(intermediateCert.publicKey)) {
                throw new ValidationError("credential certificate chain verification failed");
            }
            // Extract and store the public key
            const publicKeyPem = credCert.publicKey
                .export({ type: "spki", format: "pem" })
                .toString();
            await this.db.storeAttestKey(userId, input.key_id, publicKeyPem);
        }
        catch (err) {
            if (err instanceof ValidationError)
                throw err;
            throw new ValidationError("attestation verification failed");
        }
        return { status: "verified" };
    }
    /** Verify an assertion from an attested device. */
    async verifyAssertion(userId, input) {
        if (!this.db)
            throw new NotConfiguredError("attestation not configured");
        if (!input.assertion)
            throw new ValidationError("assertion is required");
        if (!input.nonce)
            throw new ValidationError("nonce is required");
        // Verify the challenge
        const challengeValid = await this.db.consumeChallenge(input.nonce, userId);
        if (!challengeValid) {
            throw new ValidationError("invalid or expired challenge");
        }
        // Get stored public key
        let stored;
        try {
            stored = await this.db.getAttestKey(userId);
        }
        catch {
            throw new ForbiddenError("device not attested");
        }
        // Verify the assertion signature
        const assertionData = Buffer.from(input.assertion, "base64");
        const clientDataHash = createHash("sha256")
            .update(input.client_data ?? input.nonce)
            .digest();
        try {
            if (assertionData.length < 39) {
                throw new ValidationError("assertion too short");
            }
            const authData = assertionData.subarray(0, assertionData.length - getDerSignatureLength(assertionData));
            const signature = assertionData.subarray(authData.length);
            const signedData = Buffer.concat([authData, clientDataHash]);
            const verifier = createVerify("SHA256");
            verifier.update(signedData);
            const valid = verifier.verify(stored.publicKey, signature);
            if (!valid) {
                throw new ValidationError("assertion signature invalid");
            }
        }
        catch (err) {
            if (err instanceof ValidationError)
                throw err;
            throw new ValidationError("assertion verification failed");
        }
        return { status: "valid" };
    }
    /** Check if a user's device has been attested. Throws ForbiddenError if not. */
    async checkAttestation(userId) {
        if (!this.db)
            throw new NotConfiguredError("attestation not configured");
        if (!userId)
            throw new ValidationError("userId is required");
        try {
            const key = await this.db.getAttestKey(userId);
            if (!key?.keyId)
                throw new ForbiddenError("device not attested");
        }
        catch (err) {
            if (err instanceof ForbiddenError || err instanceof NotConfiguredError)
                throw err;
            throw new ForbiddenError("device not attested");
        }
    }
}
function decodeCBORAttestation(data) {
    let offset = 0;
    function readByte() { return data[offset++]; }
    function readUint(additionalInfo) {
        if (additionalInfo < 24)
            return additionalInfo;
        if (additionalInfo === 24)
            return readByte();
        if (additionalInfo === 25) {
            const val = data.readUInt16BE(offset);
            offset += 2;
            return val;
        }
        if (additionalInfo === 26) {
            const val = data.readUInt32BE(offset);
            offset += 4;
            return val;
        }
        throw new Error("cbor: unsupported integer size");
    }
    function readValue() {
        const initial = readByte();
        const majorType = initial >> 5;
        const additionalInfo = initial & 0x1f;
        switch (majorType) {
            case 0: return readUint(additionalInfo);
            case 1: return -1 - readUint(additionalInfo);
            case 2: {
                const len = readUint(additionalInfo);
                const val = Buffer.from(data.subarray(offset, offset + len));
                offset += len;
                return val;
            }
            case 3: {
                const len = readUint(additionalInfo);
                const val = data.subarray(offset, offset + len).toString("utf-8");
                offset += len;
                return val;
            }
            case 4: {
                const len = readUint(additionalInfo);
                const arr = [];
                for (let i = 0; i < len; i++)
                    arr.push(readValue());
                return arr;
            }
            case 5: {
                const len = readUint(additionalInfo);
                const map = {};
                for (let i = 0; i < len; i++) {
                    const key = String(readValue());
                    map[key] = readValue();
                }
                return map;
            }
            case 7:
                if (additionalInfo === 20)
                    return false;
                if (additionalInfo === 21)
                    return true;
                if (additionalInfo === 22)
                    return null;
                return undefined;
            default: throw new Error(`cbor: unsupported major type ${majorType}`);
        }
    }
    const obj = readValue();
    if (!obj || typeof obj !== "object")
        throw new Error("expected CBOR map");
    return {
        fmt: obj.fmt,
        attStmt: {
            x5c: obj.attStmt?.x5c,
            receipt: obj.attStmt?.receipt,
        },
        authData: obj.authData,
    };
}
function extractAttestNonce(cert) {
    const oid = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
    const raw = Buffer.from(cert.raw);
    const idx = raw.indexOf(oid);
    if (idx === -1)
        return null;
    let pos = idx + oid.length;
    const remaining = raw.subarray(pos);
    for (let i = 0; i < remaining.length - 32; i++) {
        if (remaining[i] === 0x04 && remaining[i + 1] === 0x20) {
            return Buffer.from(remaining.subarray(i + 2, i + 2 + 32));
        }
    }
    return null;
}
function getDerSignatureLength(buf) {
    for (let i = buf.length - 72; i < buf.length - 60; i++) {
        if (i < 0)
            continue;
        if (buf[i] === 0x30) {
            const seqLen = buf[i + 1];
            if (seqLen + 2 === buf.length - i)
                return seqLen + 2;
        }
    }
    return Math.min(72, buf.length - 37);
}
//# sourceMappingURL=index.js.map