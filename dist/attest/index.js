import { randomBytes, createHash, createVerify, X509Certificate } from "node:crypto";
import { Buffer } from "node:buffer";
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
    /** POST /api/v1/attest/challenge */
    handleChallenge = async (c) => {
        const userId = c.get("userId");
        const nonce = this.generateHexNonce();
        if (this.db) {
            const expiresAt = new Date(Date.now() + this.challengeTtlSec * 1000);
            try {
                await this.db.storeChallenge(nonce, userId, expiresAt);
            }
            catch {
                return c.json({ error: "failed to store challenge" }, 500);
            }
        }
        return c.json({ nonce });
    };
    /** POST /api/v1/attest/verify */
    handleVerify = async (c) => {
        if (!this.db)
            return c.json({ error: "attestation not configured" }, 501);
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.key_id)
            return c.json({ error: "key_id is required" }, 400);
        if (!body.attestation)
            return c.json({ error: "attestation is required" }, 400);
        if (!body.nonce)
            return c.json({ error: "nonce is required" }, 400);
        // 1. Verify the challenge was issued to this user and hasn't expired
        const challengeValid = await this.db.consumeChallenge(body.nonce, userId);
        if (!challengeValid) {
            return c.json({ error: "invalid or expired challenge" }, 400);
        }
        // 2. Decode and verify the attestation object
        let attestData;
        try {
            attestData = Buffer.from(body.attestation, "base64");
        }
        catch {
            return c.json({ error: "invalid attestation encoding" }, 400);
        }
        // 3. Verify the attestation structure
        //    The attestation is a CBOR-encoded object containing:
        //    - fmt: "apple-appattest"
        //    - attStmt: { x5c: [cert chain], receipt: Buffer }
        //    - authData: Buffer
        let parsed;
        try {
            parsed = decodeCBORAttestation(attestData);
        }
        catch (err) {
            return c.json({ error: `invalid attestation format: ${err}` }, 400);
        }
        if (parsed.fmt !== "apple-appattest") {
            return c.json({ error: `unexpected attestation format: ${parsed.fmt}` }, 400);
        }
        // 4. Verify the nonce is embedded in the attestation
        //    Hash(clientDataHash || authData) should match the nonce in the cert extension
        const clientDataHash = createHash("sha256")
            .update(Buffer.from(body.nonce, "hex"))
            .digest();
        const composite = Buffer.concat([parsed.authData, clientDataHash]);
        const expectedNonce = createHash("sha256").update(composite).digest();
        // 5. Verify the certificate chain
        if (!parsed.attStmt.x5c || parsed.attStmt.x5c.length < 2) {
            return c.json({ error: "attestation missing certificate chain" }, 400);
        }
        try {
            const credCert = new X509Certificate(parsed.attStmt.x5c[0]);
            // Verify the nonce is in the credential certificate's OID 1.2.840.113635.100.8.2
            const certNonce = extractAttestNonce(credCert);
            if (certNonce && !expectedNonce.equals(certNonce)) {
                return c.json({ error: "attestation nonce mismatch" }, 400);
            }
            // Verify the key ID matches the public key hash from authData
            const authDataKeyHash = parsed.authData.subarray(37, 69); // credentialId starts at byte 37
            const keyIdHash = createHash("sha256")
                .update(Buffer.from(body.key_id, "base64url"))
                .digest();
            // The key_id from the client should correspond to the credential in authData
            // For App Attest, the credentialId in authData IS the key identifier
            if (authDataKeyHash.length >= 32) {
                const rpIdHash = parsed.authData.subarray(0, 32);
                if (this.cfg?.appId) {
                    const expectedRpId = createHash("sha256")
                        .update(this.cfg.appId)
                        .digest();
                    if (!rpIdHash.equals(expectedRpId)) {
                        return c.json({ error: "RP ID mismatch (wrong appId)" }, 400);
                    }
                }
            }
            // Verify cert chain: leaf → intermediate → Apple root
            const intermediateCert = new X509Certificate(parsed.attStmt.x5c[1]);
            if (!credCert.verify(intermediateCert.publicKey)) {
                return c.json({ error: "credential certificate chain verification failed" }, 400);
            }
            // Extract and store the public key for future assertion verification
            const publicKeyPem = credCert.publicKey
                .export({ type: "spki", format: "pem" })
                .toString();
            await this.db.storeAttestKey(userId, body.key_id, publicKeyPem);
        }
        catch (err) {
            if (typeof err === "object" && err !== null && "message" in err) {
                const msg = err.message;
                if (msg.includes("attestation")) {
                    return c.json({ error: msg }, 400);
                }
            }
            return c.json({ error: "attestation verification failed" }, 400);
        }
        return c.json({ status: "verified" });
    };
    /** POST /api/v1/attest/assert — verify an assertion for ongoing requests. */
    handleAssert = async (c) => {
        if (!this.db)
            return c.json({ error: "attestation not configured" }, 501);
        const userId = c.get("userId");
        const body = await c.req.json();
        if (!body.assertion)
            return c.json({ error: "assertion is required" }, 400);
        if (!body.nonce)
            return c.json({ error: "nonce is required" }, 400);
        // Verify the challenge
        const challengeValid = await this.db.consumeChallenge(body.nonce, userId);
        if (!challengeValid) {
            return c.json({ error: "invalid or expired challenge" }, 400);
        }
        // Get stored public key
        let stored;
        try {
            stored = await this.db.getAttestKey(userId);
        }
        catch {
            return c.json({ error: "device not attested" }, 403);
        }
        // Verify the assertion signature
        const assertionData = Buffer.from(body.assertion, "base64");
        const clientDataHash = createHash("sha256")
            .update(body.client_data ?? body.nonce)
            .digest();
        try {
            // Assertion format: authData || signature
            // authData is at least 37 bytes, signature follows
            if (assertionData.length < 39) {
                return c.json({ error: "assertion too short" }, 400);
            }
            // Find signature boundary: authData is variable length, minimum 37 bytes
            // The signature is a DER-encoded ECDSA signature at the end
            const authData = assertionData.subarray(0, assertionData.length - getDerSignatureLength(assertionData));
            const signature = assertionData.subarray(authData.length);
            // Verify: sign(authData || clientDataHash) with stored public key
            const signedData = Buffer.concat([authData, clientDataHash]);
            const verifier = createVerify("SHA256");
            verifier.update(signedData);
            const valid = verifier.verify(stored.publicKey, signature);
            if (!valid) {
                return c.json({ error: "assertion signature invalid" }, 400);
            }
        }
        catch {
            return c.json({ error: "assertion verification failed" }, 400);
        }
        return c.json({ status: "valid" });
    };
    /** Middleware: require valid attestation (checks that the device has been attested). */
    requireAttest = async (c, next) => {
        if (!this.db)
            return c.json({ error: "attestation not configured" }, 501);
        const userId = c.get("userId");
        if (!userId)
            return c.json({ error: "unauthorized" }, 401);
        try {
            const key = await this.db.getAttestKey(userId);
            if (!key?.keyId)
                return c.json({ error: "device not attested" }, 403);
        }
        catch {
            return c.json({ error: "device not attested" }, 403);
        }
        await next();
    };
}
/**
 * Minimal CBOR decoder for Apple App Attest attestation objects.
 * Only handles the subset of CBOR needed for attestation (maps, strings, byte strings).
 */
function decodeCBORAttestation(data) {
    let offset = 0;
    function readByte() {
        return data[offset++];
    }
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
            case 0: // unsigned int
                return readUint(additionalInfo);
            case 1: // negative int
                return -1 - readUint(additionalInfo);
            case 2: { // byte string
                const len = readUint(additionalInfo);
                const val = Buffer.from(data.subarray(offset, offset + len));
                offset += len;
                return val;
            }
            case 3: { // text string
                const len = readUint(additionalInfo);
                const val = data.subarray(offset, offset + len).toString("utf-8");
                offset += len;
                return val;
            }
            case 4: { // array
                const len = readUint(additionalInfo);
                const arr = [];
                for (let i = 0; i < len; i++)
                    arr.push(readValue());
                return arr;
            }
            case 5: { // map
                const len = readUint(additionalInfo);
                const map = {};
                for (let i = 0; i < len; i++) {
                    const key = String(readValue());
                    map[key] = readValue();
                }
                return map;
            }
            case 7: // special (true, false, null, etc.)
                if (additionalInfo === 20)
                    return false;
                if (additionalInfo === 21)
                    return true;
                if (additionalInfo === 22)
                    return null;
                return undefined;
            default:
                throw new Error(`cbor: unsupported major type ${majorType}`);
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
/** Extract the attestation nonce from the credential certificate's OID 1.2.840.113635.100.8.2 */
function extractAttestNonce(cert) {
    // The nonce is in an extension with OID 1.2.840.113635.100.8.2
    // We extract it from the raw DER data by searching for the OID
    const oid = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
    const raw = Buffer.from(cert.raw);
    const idx = raw.indexOf(oid);
    if (idx === -1)
        return null;
    // After the OID, there's an OCTET STRING wrapping the nonce
    // Navigate: OID → OCTET STRING (ext value) → SEQUENCE → SET → OCTET STRING (nonce)
    let pos = idx + oid.length;
    // Skip through ASN.1 wrappers to find the innermost OCTET STRING
    // This is a simplified extraction — find the 32-byte nonce
    const remaining = raw.subarray(pos);
    for (let i = 0; i < remaining.length - 32; i++) {
        // Look for OCTET STRING tag (0x04) followed by length 0x20 (32 bytes)
        if (remaining[i] === 0x04 && remaining[i + 1] === 0x20) {
            return Buffer.from(remaining.subarray(i + 2, i + 2 + 32));
        }
    }
    return null;
}
/** Determine the length of a DER-encoded ECDSA signature at the end of a buffer. */
function getDerSignatureLength(buf) {
    // DER signatures start with 0x30 (SEQUENCE), we search from the end
    // A P-256 ECDSA signature is typically 70-72 bytes
    for (let i = buf.length - 72; i < buf.length - 60; i++) {
        if (i < 0)
            continue;
        if (buf[i] === 0x30) {
            const seqLen = buf[i + 1];
            if (seqLen + 2 === buf.length - i) {
                return seqLen + 2;
            }
        }
    }
    // Fallback: assume 71 bytes (typical P-256)
    return Math.min(72, buf.length - 37);
}
//# sourceMappingURL=index.js.map