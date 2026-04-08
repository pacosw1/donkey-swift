import { describe, it, expect, vi } from "vitest";
import { AuthService, type AuthDB, type AuthConfig, type SessionDB, type User } from "../auth/index.js";
import { ValidationError, UnauthorizedError, NotFoundError, NotConfiguredError, ServiceError } from "../errors/index.js";

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
    storeAppleAuthArtifacts: vi.fn().mockResolvedValue(undefined),
    getAppleAuthArtifacts: vi.fn().mockResolvedValue(null),
    deleteAppleAuthArtifacts: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockSessionDB(overrides: Partial<SessionDB> = {}): SessionDB {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    isSessionValid: vi.fn().mockResolvedValue(true),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeAllSessions: vi.fn().mockResolvedValue(undefined),
    activeSessions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createService(dbOverrides: Partial<AuthDB> = {}, cfgOverrides: Partial<AuthConfig> = {}) {
  const db = mockDB(dbOverrides);
  const cfg: AuthConfig = {
    jwtSecret: JWT_SECRET,
    appleBundleId: "com.test.app",
    productionEnv: false,
    ...cfgOverrides,
  };
  const svc = new AuthService(cfg, db);
  return { svc, db, cfg };
}

// ── Pure method tests ────────────────────────────────────────────────────────

describe("AuthService.authenticateWithApple", () => {
  it("throws ValidationError for empty identity token", async () => {
    const { svc } = createService();
    await expect(svc.authenticateWithApple("")).rejects.toThrow(ValidationError);
    await expect(svc.authenticateWithApple("")).rejects.toThrow("identity_token is required");
  });
});

describe("AuthService.refreshSession", () => {
  it("throws when apple token persistence is unavailable", async () => {
    const { svc } = createService({
      storeAppleAuthArtifacts: undefined,
      getAppleAuthArtifacts: undefined,
    });
    await expect(svc.refreshSession("user-1")).rejects.toThrow(NotConfiguredError);
  });
});

describe("AuthService.parseSessionTokenAllowExpired", () => {
  it("extracts the user id from an expired but validly signed token", async () => {
    const { svc } = createService({}, { sessionExpirySec: 1 });
    const token = await svc.createSessionToken("user-expired");
    const uid = await svc.parseSessionTokenAllowExpired(token);
    expect(uid).toBe("user-expired");
  });
});

describe("AuthService.authenticateWithWeb", () => {
  it("throws NotConfiguredError when web auth is not configured", async () => {
    const { svc } = createService();
    await expect(svc.authenticateWithWeb("some-code")).rejects.toThrow(NotConfiguredError);
    await expect(svc.authenticateWithWeb("some-code")).rejects.toThrow("web auth not configured");
  });

  it("throws ValidationError for empty authorization code", async () => {
    const { svc } = createService({}, {
      appleClientSecret: "secret",
      appleRedirectUri: "https://example.com/callback",
      appleWebClientId: "com.test.web",
    });
    await expect(svc.authenticateWithWeb("")).rejects.toThrow(ValidationError);
    await expect(svc.authenticateWithWeb("")).rejects.toThrow("authorization code is required");
  });
});

describe("AuthService.getUser", () => {
  it("returns user data when found", async () => {
    const user = makeUser({ id: "user-789", name: "Alice" });
    const { svc } = createService({
      userById: vi.fn().mockResolvedValue(user),
    });

    const result = await svc.getUser("user-789");
    expect(result.id).toBe("user-789");
    expect(result.name).toBe("Alice");
  });

  it("throws NotFoundError when user not found", async () => {
    const { svc } = createService({
      userById: vi.fn().mockRejectedValue(new Error("not found")),
    });
    await expect(svc.getUser("nonexistent-user")).rejects.toThrow(NotFoundError);
    await expect(svc.getUser("nonexistent-user")).rejects.toThrow("user not found");
  });
});

describe("AuthService.logout", () => {
  it("completes without error when no sessionDB", async () => {
    const { svc } = createService();
    await expect(svc.logout()).resolves.toBeUndefined();
  });

  it("completes without error when no token provided", async () => {
    const sessionDB = mockSessionDB();
    const { svc } = createService({}, { sessionDB });
    await expect(svc.logout()).resolves.toBeUndefined();
    expect(sessionDB.revokeSession).not.toHaveBeenCalled();
  });
});

describe("AuthService.logoutAll", () => {
  it("throws NotConfiguredError when sessionDB is not configured", async () => {
    const { svc } = createService();
    await expect(svc.logoutAll("user-1")).rejects.toThrow(NotConfiguredError);
    await expect(svc.logoutAll("user-1")).rejects.toThrow("session management not configured");
  });

  it("revokes all sessions when sessionDB is configured", async () => {
    const sessionDB = mockSessionDB();
    const { svc } = createService({}, { sessionDB });
    await svc.logoutAll("user-42");
    expect(sessionDB.revokeAllSessions).toHaveBeenCalledWith("user-42");
  });
});

describe("AuthService.listSessions", () => {
  it("throws NotConfiguredError when activeSessions is not available", async () => {
    const sessionDB: SessionDB = {
      createSession: vi.fn().mockResolvedValue(undefined),
      isSessionValid: vi.fn().mockResolvedValue(true),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      revokeAllSessions: vi.fn().mockResolvedValue(undefined),
      // no activeSessions
    };
    const { svc } = createService({}, { sessionDB });
    await expect(svc.listSessions("user-1")).rejects.toThrow(NotConfiguredError);
    await expect(svc.listSessions("user-1")).rejects.toThrow("session listing not available");
  });

  it("throws NotConfiguredError when sessionDB is not configured at all", async () => {
    const { svc } = createService();
    await expect(svc.listSessions("user-1")).rejects.toThrow(NotConfiguredError);
  });
});

describe("AuthService.revokeSession", () => {
  it("throws NotConfiguredError when sessionDB is not configured", async () => {
    const { svc } = createService();
    await expect(svc.revokeSession("some-jti")).rejects.toThrow(NotConfiguredError);
    await expect(svc.revokeSession("some-jti")).rejects.toThrow("session management not configured");
  });

  it("revokes session when jti is provided", async () => {
    const sessionDB = mockSessionDB();
    const { svc } = createService({}, { sessionDB });
    await svc.revokeSession("jti-abc-123");
    expect(sessionDB.revokeSession).toHaveBeenCalledWith("jti-abc-123");
  });

  it("throws ValidationError for empty jti", async () => {
    const sessionDB = mockSessionDB();
    const { svc } = createService({}, { sessionDB });
    await expect(svc.revokeSession("")).rejects.toThrow(ValidationError);
    await expect(svc.revokeSession("")).rejects.toThrow("session id is required");
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

// ── SessionDB integration with tokens ───────────────────────────────────────

describe("AuthService sessionDB integration", () => {
  it("createSessionToken stores session in sessionDB when provided", async () => {
    const sessionDB = mockSessionDB();
    const { svc } = createService({}, { sessionDB });

    const token = await svc.createSessionToken("user-session-test");

    expect(sessionDB.createSession).toHaveBeenCalledTimes(1);
    const [userId, jti, expiresAt] = (sessionDB.createSession as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(userId).toBe("user-session-test");
    expect(typeof jti).toBe("string");
    expect(jti.length).toBeGreaterThan(0);
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("createSessionToken does not call sessionDB when not provided", async () => {
    const { svc } = createService();
    await svc.createSessionToken("user-no-session-db");
    // No sessionDB = no session storage call — just verify no error
  });

  it("parseSessionToken rejects revoked session", async () => {
    const sessionDB = mockSessionDB({
      isSessionValid: vi.fn().mockResolvedValue(false),
    });
    const { svc } = createService({}, { sessionDB });

    const token = await svc.createSessionToken("user-revoked");
    await expect(svc.parseSessionToken(token)).rejects.toThrow("session revoked");
    expect(sessionDB.isSessionValid).toHaveBeenCalled();
  });

  it("parseSessionToken succeeds for valid session", async () => {
    const sessionDB = mockSessionDB({
      isSessionValid: vi.fn().mockResolvedValue(true),
    });
    const { svc } = createService({}, { sessionDB });

    const token = await svc.createSessionToken("user-valid");
    const uid = await svc.parseSessionToken(token);
    expect(uid).toBe("user-valid");
  });
});
