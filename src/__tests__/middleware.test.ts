import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { requireAuth, cors, rateLimit, RateLimiter } from "../middleware/index.js";

function app() { return new Hono(); }

describe("requireAuth", () => {
  const parseToken = vi.fn();

  it("sets userId from Bearer token", async () => {
    parseToken.mockResolvedValue("user-123");
    const a = app();
    a.use("*", requireAuth({ parseToken }));
    a.get("/test", (c) => c.json({ id: c.get("userId") }));

    const res = await a.request("/test", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "user-123" });
    expect(parseToken).toHaveBeenCalledWith("valid-token");
  });

  it("sets userId from session cookie", async () => {
    parseToken.mockResolvedValue("user-456");
    const a = app();
    a.use("*", requireAuth({ parseToken }));
    a.get("/test", (c) => c.json({ id: c.get("userId") }));

    const res = await a.request("/test", {
      headers: { Cookie: "session=cookie-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "user-456" });
  });

  it("returns 401 when no token is present", async () => {
    const a = app();
    a.use("*", requireAuth({ parseToken }));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("missing");
  });

  it("returns 401 when token is invalid", async () => {
    parseToken.mockRejectedValue(new Error("expired"));
    const a = app();
    a.use("*", requireAuth({ parseToken }));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test", {
      headers: { Authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("invalid");
  });
});

describe("cors", () => {
  it("sets wildcard origin when configured with '*'", async () => {
    const a = app();
    a.use("*", cors("*"));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test", {
      headers: { Origin: "http://example.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("reflects matching origin", async () => {
    const a = app();
    a.use("*", cors("http://app.com,http://other.com"));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test", {
      headers: { Origin: "http://app.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://app.com");
  });

  it("does not set origin header for non-matching origin", async () => {
    const a = app();
    a.use("*", cors("http://app.com"));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test", {
      headers: { Origin: "http://evil.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("returns 204 for OPTIONS preflight", async () => {
    const a = app();
    a.use("*", cors("*"));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "http://example.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("rateLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests under the limit", async () => {
    const rl = new RateLimiter(5, 60_000);
    const a = app();
    a.use("*", rateLimit(rl));
    a.get("/test", (c) => c.json({ ok: true }));

    const res = await a.request("/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res.status).toBe(200);
    rl.destroy();
  });

  it("blocks requests exceeding the limit", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const rl = new RateLimiter(2, 60_000);
    const a = app();
    a.use("*", rateLimit(rl));
    a.get("/test", (c) => c.json({ ok: true }));

    // First 2 should pass
    for (let i = 0; i < 2; i++) {
      const res = await a.request("/test", {
        headers: { "X-Forwarded-For": "10.0.0.1" },
      });
      expect(res.status).toBe(200);
    }

    // 3rd should be blocked
    const res = await a.request("/test", {
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("rate limit");
    rl.destroy();
  });

  it("allows different IPs independently", async () => {
    const rl = new RateLimiter(1, 60_000);
    const a = app();
    a.use("*", rateLimit(rl));
    a.get("/test", (c) => c.json({ ok: true }));

    const res1 = await a.request("/test", {
      headers: { "X-Forwarded-For": "1.1.1.1" },
    });
    const res2 = await a.request("/test", {
      headers: { "X-Forwarded-For": "2.2.2.2" },
    });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    rl.destroy();
  });
});
