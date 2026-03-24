import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { AuthService, type AuthDB, type User } from "../auth/index.js";

const JWT_SECRET = "test-secret-key-at-least-32-chars-long";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-001",
    apple_sub: "apple-sub-001",
    email: "test@example.com",
    name: "Test User",
    created_at: new Date("2025-01-01"),
    last_login_at: new Date("2025-06-01"),
    ...overrides,
  };
}

function mockDB(overrides: Partial<AuthDB> = {}): AuthDB {
  return {
    upsertUserByAppleSub: vi.fn().mockResolvedValue(makeUser()),
    userById: vi.fn().mockResolvedValue(makeUser()),
    ...overrides,
  };
}

function createService(dbOverrides: Partial<AuthDB> = {}) {
  const db = mockDB(dbOverrides);
  const cfg = {
    jwtSecret: JWT_SECRET,
    appleBundleId: "com.test.app",
    productionEnv: false,
  };
  const svc = new AuthService(cfg, db);
  return { svc, db, cfg };
}

// ── Handler tests ───────────────────────────────────────────────────────────

describe("AuthService handlers", () => {
  describe("handleAppleAuth", () => {
    it("rejects missing identity_token with 400", async () => {
      const { svc } = createService();
      const a = new Hono();
      a.post("/auth/apple", svc.handleAppleAuth);

      const res = await a.request("/auth/apple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("identity_token");
    });

    it("rejects request with null identity_token with 400", async () => {
      const { svc } = createService();
      const a = new Hono();
      a.post("/auth/apple", svc.handleAppleAuth);

      const res = await a.request("/auth/apple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity_token: null }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("identity_token");
    });
  });

  describe("handleMe", () => {
    it("returns user data when valid session", async () => {
      const user = makeUser({ id: "user-789", name: "Alice" });
      const { svc } = createService({
        userById: vi.fn().mockResolvedValue(user),
      });

      const a = new Hono();
      // Simulate middleware setting userId
      a.use("*", async (c, next) => {
        c.set("userId", "user-789");
        await next();
      });
      a.get("/auth/me", svc.handleMe);

      const res = await a.request("/auth/me");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("user-789");
      expect(body.name).toBe("Alice");
    });

    it("returns 404 when user not found", async () => {
      const { svc } = createService({
        userById: vi.fn().mockRejectedValue(new Error("not found")),
      });

      const a = new Hono();
      a.use("*", async (c, next) => {
        c.set("userId", "nonexistent-user");
        await next();
      });
      a.get("/auth/me", svc.handleMe);

      const res = await a.request("/auth/me");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("user not found");
    });
  });

  describe("handleLogout", () => {
    it("returns success and deletes cookie", async () => {
      const { svc } = createService();
      const a = new Hono();
      a.post("/auth/logout", svc.handleLogout);

      const res = await a.request("/auth/logout", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("logged out");

      // The Set-Cookie header should clear the session cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("session=");
      expect(setCookie).toContain("Max-Age=0");
    });

    it("deletes custom-named cookie when configured", async () => {
      const db = mockDB();
      const svc = new AuthService(
        {
          jwtSecret: JWT_SECRET,
          appleBundleId: "com.test.app",
          cookieName: "my_session",
        },
        db
      );
      const a = new Hono();
      a.post("/auth/logout", svc.handleLogout);

      const res = await a.request("/auth/logout", { method: "POST" });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("my_session=");
    });
  });
});

// ── Session token tests ─────────────────────────────────────────────────────

describe("AuthService session tokens", () => {
  it("createSessionToken + parseSessionToken round-trip works", async () => {
    const { svc } = createService();
    const userId = "user-round-trip-42";

    const token = await svc.createSessionToken(userId);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const parsed = await svc.parseSessionToken(token);
    expect(parsed).toBe(userId);
  });

  it("parseSessionToken rejects tampered token", async () => {
    const { svc } = createService();
    const token = await svc.createSessionToken("user-legit");

    // Tamper with the token by flipping a character in the signature (last segment)
    const parts = token.split(".");
    const sig = parts[2];
    const flipped = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    const tampered = [parts[0], parts[1], flipped].join(".");

    await expect(svc.parseSessionToken(tampered)).rejects.toThrow();
  });

  it("parseSessionToken rejects token signed with different secret", async () => {
    const { svc: svc1 } = createService();
    const db = mockDB();
    const svc2 = new AuthService(
      {
        jwtSecret: "completely-different-secret-key-32chars!",
        appleBundleId: "com.test.app",
      },
      db
    );

    const token = await svc1.createSessionToken("user-123");
    await expect(svc2.parseSessionToken(token)).rejects.toThrow();
  });

  it("parseSessionToken rejects garbage string", async () => {
    const { svc } = createService();
    await expect(svc.parseSessionToken("not-a-jwt")).rejects.toThrow();
  });

  it("each token has a unique jti", async () => {
    const { svc } = createService();
    const token1 = await svc.createSessionToken("user-1");
    const token2 = await svc.createSessionToken("user-1");
    // Tokens for the same user should differ (unique jti + iat)
    expect(token1).not.toBe(token2);
  });
});
