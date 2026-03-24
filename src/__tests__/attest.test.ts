import { describe, it, expect, vi } from "vitest";
import { AttestService, type AttestDB } from "../attest/index.js";
import { ValidationError, NotConfiguredError, ForbiddenError } from "../errors/index.js";

function mockAttestDB(overrides: Partial<AttestDB> = {}): AttestDB {
  return {
    storeAttestKey: vi.fn().mockResolvedValue(undefined),
    getAttestKey: vi.fn().mockResolvedValue({ keyId: "key-1", publicKey: "pk-1" }),
    storeChallenge: vi.fn().mockResolvedValue(undefined),
    consumeChallenge: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("AttestService", () => {
  describe("createChallenge", () => {
    it("returns a nonce and stores challenge in DB", async () => {
      const storeChallenge = vi.fn().mockResolvedValue(undefined);
      const db = mockAttestDB({ storeChallenge });
      const svc = new AttestService(db);

      const result = await svc.createChallenge("user-1");
      expect(result.nonce).toBeDefined();
      expect(typeof result.nonce).toBe("string");
      expect(result.nonce.length).toBe(64); // 32 bytes hex-encoded
      expect(storeChallenge).toHaveBeenCalledWith(
        result.nonce,
        "user-1",
        expect.any(Date),
      );
    });
  });

  describe("verifyAttestation", () => {
    it("throws NotConfiguredError when db not configured", async () => {
      const svc = new AttestService(undefined);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "a", nonce: "n" })
      ).rejects.toThrow(NotConfiguredError);
    });

    it("rejects missing key_id", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "", attestation: "a", nonce: "n" })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects missing attestation", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "", nonce: "n" })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects missing nonce", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "a", nonce: "" })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects invalid/expired challenge", async () => {
      const db = mockAttestDB({
        consumeChallenge: vi.fn().mockResolvedValue(false),
      });
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "YQ==", nonce: "expired-nonce" })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("checkAttestation", () => {
    it("throws ForbiddenError when device not attested", async () => {
      const db = mockAttestDB({
        getAttestKey: vi.fn().mockRejectedValue(new Error("not found")),
      });
      const svc = new AttestService(db);
      await expect(svc.checkAttestation("user-1"))
        .rejects.toThrow(ForbiddenError);
    });

    it("succeeds when device is attested", async () => {
      const db = mockAttestDB({
        getAttestKey: vi.fn().mockResolvedValue({ keyId: "key-1", publicKey: "pk-1" }),
      });
      const svc = new AttestService(db);
      await expect(svc.checkAttestation("user-1")).resolves.toBeUndefined();
    });
  });
});
