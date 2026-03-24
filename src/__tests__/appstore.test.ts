import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppStoreServerClient, AppStoreError, type AppStoreConfig } from "../appstore/index.js";

// ── Mock jose and fs ────────────────────────────────────────────────────────

vi.mock("jose", () => {
  const mockSign = vi.fn().mockResolvedValue("mock.jwt.token");
  return {
    importPKCS8: vi.fn().mockResolvedValue("mock-crypto-key"),
    SignJWT: vi.fn().mockImplementation(() => ({
      setProtectedHeader: vi.fn().mockReturnThis(),
      setIssuer: vi.fn().mockReturnThis(),
      setIssuedAt: vi.fn().mockReturnThis(),
      setExpirationTime: vi.fn().mockReturnThis(),
      setAudience: vi.fn().mockReturnThis(),
      sign: mockSign,
    })),
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"),
}));

// ── Mock fetch ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

function makeCfg(overrides: Partial<AppStoreConfig> = {}): AppStoreConfig {
  return {
    privateKey: "-----BEGIN PRIVATE KEY-----\nfake-key-data\n-----END PRIVATE KEY-----",
    keyId: "KEY123",
    issuerId: "ISSUER-UUID",
    bundleId: "com.test.app",
    ...overrides,
  };
}

describe("AppStoreServerClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Constructor / base URL ──────────────────────────────────────────────

  describe("constructor", () => {
    it("sets production base URL by default", () => {
      const client = new AppStoreServerClient(makeCfg());
      // Access private baseUrl via any cast
      expect((client as any).baseUrl).toBe("https://api.storekit.itunes.apple.com");
    });

    it("sets production base URL when environment is production", () => {
      const client = new AppStoreServerClient(makeCfg({ environment: "production" }));
      expect((client as any).baseUrl).toBe("https://api.storekit.itunes.apple.com");
    });

    it("sets sandbox base URL when environment is sandbox", () => {
      const client = new AppStoreServerClient(makeCfg({ environment: "sandbox" }));
      expect((client as any).baseUrl).toBe("https://api.storekit-sandbox.itunes.apple.com");
    });
  });

  // ── getToken ──────────────────────────────────────────────────────────────

  describe("getToken", () => {
    it("generates a JWT token string", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ signedTransactions: [], revision: "", hasMore: false, bundleId: "com.test.app", environment: "Production" }),
      });

      const client = new AppStoreServerClient(makeCfg());
      // Trigger getToken indirectly by calling a method that makes a request
      await client.getTransactionHistory("txn-1");

      // Verify fetch was called with Bearer token
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBe("Bearer mock.jwt.token");
    });
  });

  // ── getTransactionHistory ─────────────────────────────────────────────────

  describe("getTransactionHistory", () => {
    it("constructs correct URL without query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ signedTransactions: [], revision: "rev1", hasMore: false, bundleId: "com.test.app", environment: "Production" }),
      });

      const client = new AppStoreServerClient(makeCfg());
      await client.getTransactionHistory("txn-abc");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.storekit.itunes.apple.com/inApps/v1/history/txn-abc");
    });

    it("constructs correct URL with query params", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ signedTransactions: [], revision: "rev2", hasMore: false, bundleId: "com.test.app", environment: "Production" }),
      });

      const client = new AppStoreServerClient(makeCfg());
      await client.getTransactionHistory("txn-xyz", {
        revision: "rev1",
        sort: "DESCENDING",
        productTypes: ["AUTO_RENEWABLE"],
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/inApps/v1/history/txn-xyz?");
      expect(url).toContain("revision=rev1");
      expect(url).toContain("sort=DESCENDING");
      expect(url).toContain("productType=AUTO_RENEWABLE");
    });

    it("constructs correct URL for sandbox environment", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ signedTransactions: [], revision: "", hasMore: false, bundleId: "com.test.app", environment: "Sandbox" }),
      });

      const client = new AppStoreServerClient(makeCfg({ environment: "sandbox" }));
      await client.getTransactionHistory("txn-sandbox");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("api.storekit-sandbox.itunes.apple.com");
      expect(url).toContain("/inApps/v1/history/txn-sandbox");
    });
  });

  // ── getSubscriptionStatuses ───────────────────────────────────────────────

  describe("getSubscriptionStatuses", () => {
    it("constructs correct URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [], bundleId: "com.test.app", environment: "Production" }),
      });

      const client = new AppStoreServerClient(makeCfg());
      await client.getSubscriptionStatuses("txn-status-1");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/txn-status-1");
      expect(opts.method).toBe("GET");
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws AppStoreError on non-OK response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      });

      const client = new AppStoreServerClient(makeCfg());
      await expect(client.getTransactionHistory("txn-bad")).rejects.toThrow(AppStoreError);
    });

    it("AppStoreError has correct statusCode and body", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate Limit Exceeded",
      });

      const client = new AppStoreServerClient(makeCfg());
      try {
        await client.getTransactionHistory("txn-rate-limited");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppStoreError);
        const appStoreErr = err as AppStoreError;
        expect(appStoreErr.statusCode).toBe(429);
        expect(appStoreErr.body).toBe("Rate Limit Exceeded");
        expect(appStoreErr.name).toBe("AppStoreError");
        expect(appStoreErr.message).toContain("429");
      }
    });
  });

  // ── AppStoreError ─────────────────────────────────────────────────────────

  describe("AppStoreError", () => {
    it("has correct properties", () => {
      const err = new AppStoreError(503, "Service Unavailable");
      expect(err.statusCode).toBe(503);
      expect(err.body).toBe("Service Unavailable");
      expect(err.name).toBe("AppStoreError");
      expect(err.message).toBe("App Store API error 503: Service Unavailable");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
