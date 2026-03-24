import { describe, it, expect, vi } from "vitest";
import { AttestService, type AttestDB } from "../attest/index.js";
import { ValidationError, NotConfiguredError, ForbiddenError, ServiceError } from "../errors/index.js";

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

    it("works without DB (returns nonce only)", async () => {
      const svc = new AttestService(undefined);
      const result = await svc.createChallenge("user-1");
      expect(result.nonce).toBeDefined();
      expect(result.nonce.length).toBe(64);
    });

    it("throws ServiceError when DB store fails", async () => {
      const db = mockAttestDB({
        storeChallenge: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const svc = new AttestService(db);
      await expect(svc.createChallenge("user-1")).rejects.toThrow(ServiceError);
    });
  });

  describe("verifyAttestation", () => {
    it("throws NotConfiguredError when db not configured", async () => {
      const svc = new AttestService(undefined);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "a", nonce: "n" })
      ).rejects.toThrow(NotConfiguredError);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "a", nonce: "n" })
      ).rejects.toThrow(/not configured/i);
    });

    it("rejects missing key_id", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "", attestation: "a", nonce: "n" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "", attestation: "a", nonce: "n" })
      ).rejects.toThrow(/key_id/i);
    });

    it("rejects missing attestation", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "", nonce: "n" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "", nonce: "n" })
      ).rejects.toThrow(/attestation/i);
    });

    it("rejects missing nonce", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "a", nonce: "" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "a", nonce: "" })
      ).rejects.toThrow(/nonce/i);
    });

    it("rejects invalid/expired challenge", async () => {
      const db = mockAttestDB({
        consumeChallenge: vi.fn().mockResolvedValue(false),
      });
      const svc = new AttestService(db);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "YQ==", nonce: "expired-nonce" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAttestation("user-1", { key_id: "k", attestation: "YQ==", nonce: "expired-nonce" })
      ).rejects.toThrow(/invalid|expired/i);
    });
  });

  describe("verifyAssertion", () => {
    it("throws NotConfiguredError when db not configured", async () => {
      const svc = new AttestService(undefined);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "a", nonce: "n" })
      ).rejects.toThrow(NotConfiguredError);
    });

    it("rejects missing assertion", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "", nonce: "n" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "", nonce: "n" })
      ).rejects.toThrow(/assertion/i);
    });

    it("rejects missing nonce", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "a", nonce: "" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "a", nonce: "" })
      ).rejects.toThrow(/nonce/i);
    });

    it("rejects invalid/expired challenge", async () => {
      const db = mockAttestDB({
        consumeChallenge: vi.fn().mockResolvedValue(false),
      });
      const svc = new AttestService(db);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "YQ==", nonce: "expired-nonce" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "YQ==", nonce: "expired-nonce" })
      ).rejects.toThrow(/invalid|expired/i);
    });

    it("throws ForbiddenError when device not attested", async () => {
      const db = mockAttestDB({
        consumeChallenge: vi.fn().mockResolvedValue(true),
        getAttestKey: vi.fn().mockRejectedValue(new Error("not found")),
      });
      const svc = new AttestService(db);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "YQ==", nonce: "valid-nonce" })
      ).rejects.toThrow(ForbiddenError);
      await expect(
        svc.verifyAssertion("user-1", { assertion: "YQ==", nonce: "valid-nonce" })
      ).rejects.toThrow(/not attested/i);
    });
  });

  describe("checkAttestation", () => {
    it("throws NotConfiguredError when db not configured", async () => {
      const svc = new AttestService(undefined);
      await expect(svc.checkAttestation("user-1")).rejects.toThrow(NotConfiguredError);
    });

    it("throws ValidationError when userId is empty", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      await expect(svc.checkAttestation("")).rejects.toThrow(ValidationError);
    });

    it("throws ForbiddenError when device not attested", async () => {
      const db = mockAttestDB({
        getAttestKey: vi.fn().mockRejectedValue(new Error("not found")),
      });
      const svc = new AttestService(db);
      await expect(svc.checkAttestation("user-1")).rejects.toThrow(ForbiddenError);
      await expect(svc.checkAttestation("user-1")).rejects.toThrow(/not attested/i);
    });

    it("passes when device is attested", async () => {
      const db = mockAttestDB({
        getAttestKey: vi.fn().mockResolvedValue({ keyId: "key-1", publicKey: "pk-1" }),
      });
      const svc = new AttestService(db);
      // Should not throw
      await expect(svc.checkAttestation("user-1")).resolves.toBeUndefined();
    });
  });
});
