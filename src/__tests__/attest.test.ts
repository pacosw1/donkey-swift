import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { AttestService, type AttestDB } from "../attest/index.js";

function mockAttestDB(overrides: Partial<AttestDB> = {}): AttestDB {
  return {
    storeAttestKey: vi.fn().mockResolvedValue(undefined),
    getAttestKey: vi.fn().mockResolvedValue({ keyId: "key-1", publicKey: "pk-1" }),
    storeChallenge: vi.fn().mockResolvedValue(undefined),
    consumeChallenge: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildApp(svc: AttestService, opts?: { protectedRoute?: boolean }): Hono {
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.post("/challenge", svc.handleChallenge);
  a.post("/verify", svc.handleVerify);
  if (opts?.protectedRoute) {
    a.get("/protected", svc.requireAttest, (c) => c.json({ ok: true }));
  }
  return a;
}

describe("AttestService", () => {
  describe("handleChallenge", () => {
    it("returns a nonce and stores challenge in DB", async () => {
      const storeChallenge = vi.fn().mockResolvedValue(undefined);
      const db = mockAttestDB({ storeChallenge });
      const svc = new AttestService(db);
      const app = buildApp(svc);

      const res = await app.request("/challenge", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.nonce).toBeDefined();
      expect(typeof body.nonce).toBe("string");
      expect(body.nonce.length).toBe(64); // 32 bytes hex-encoded
      expect(storeChallenge).toHaveBeenCalledWith(
        body.nonce,
        "user-1",
        expect.any(Date),
      );
    });
  });

  describe("handleVerify", () => {
    it("returns 501 when db not configured", async () => {
      const svc = new AttestService(undefined);
      const app = buildApp(svc);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_id: "k", attestation: "a", nonce: "n" }),
      });
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    });

    it("rejects missing key_id (400)", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      const app = buildApp(svc);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attestation: "a", nonce: "n" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/key_id/i);
    });

    it("rejects missing attestation (400)", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      const app = buildApp(svc);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_id: "k", nonce: "n" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/attestation/i);
    });

    it("rejects missing nonce (400)", async () => {
      const db = mockAttestDB();
      const svc = new AttestService(db);
      const app = buildApp(svc);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_id: "k", attestation: "a" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/nonce/i);
    });

    it("rejects invalid/expired challenge (400)", async () => {
      const db = mockAttestDB({
        consumeChallenge: vi.fn().mockResolvedValue(false),
      });
      const svc = new AttestService(db);
      const app = buildApp(svc);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_id: "k", attestation: "YQ==", nonce: "expired-nonce" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid|expired/i);
    });
  });

  describe("requireAttest", () => {
    it("returns 403 when device not attested", async () => {
      const db = mockAttestDB({
        getAttestKey: vi.fn().mockRejectedValue(new Error("not found")),
      });
      const svc = new AttestService(db);
      const app = buildApp(svc, { protectedRoute: true });

      const res = await app.request("/protected");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/not attested/i);
    });

    it("passes through when device is attested", async () => {
      const db = mockAttestDB({
        getAttestKey: vi.fn().mockResolvedValue({ keyId: "key-1", publicKey: "pk-1" }),
      });
      const svc = new AttestService(db);
      const app = buildApp(svc, { protectedRoute: true });

      const res = await app.request("/protected");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });
  });
});
