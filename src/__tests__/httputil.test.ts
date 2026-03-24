import { describe, it, expect } from "vitest";
import { jsonResponse, errorResponse, decodeJson, getClientIp } from "../httputil/index.js";

describe("jsonResponse", () => {
  it("returns JSON with the given status code", async () => {
    const res = jsonResponse(200, { ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 201 with data", async () => {
    const res = jsonResponse(201, { id: "abc" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "abc" });
  });
});

describe("errorResponse", () => {
  it("returns { error: message } with status code", async () => {
    const res = errorResponse(400, "bad request");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "bad request" });
  });

  it("returns 500 error", async () => {
    const res = errorResponse(500, "internal");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("decodeJson", () => {
  it("parses JSON request body", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    const result = await decodeJson<{ name: string }>(req);
    expect(result.name).toBe("test");
  });
});

describe("getClientIp", () => {
  it("returns first IP from X-Forwarded-For", () => {
    const req = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("returns X-Real-IP when X-Forwarded-For is absent", () => {
    const req = new Request("http://localhost", {
      headers: { "X-Real-IP": "10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });

  it("trims whitespace from X-Forwarded-For", () => {
    const req = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "  9.8.7.6 , 1.1.1.1" },
    });
    expect(getClientIp(req)).toBe("9.8.7.6");
  });
});
