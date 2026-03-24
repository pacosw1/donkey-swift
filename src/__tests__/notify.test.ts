import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  NotifyService,
  type NotifyDB,
  type NotificationPreferences,
} from "../notify/index.js";
import type { PushProvider } from "../push/index.js";

function mockNotifyDB(overrides: Partial<NotifyDB> = {}): NotifyDB {
  return {
    upsertDeviceToken: vi.fn().mockResolvedValue(undefined),
    disableDeviceToken: vi.fn().mockResolvedValue(undefined),
    enabledDeviceTokens: vi.fn().mockResolvedValue([]),
    ensureNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    getNotificationPreferences: vi.fn().mockResolvedValue(defaultPrefs()),
    upsertNotificationPreferences: vi.fn().mockResolvedValue(undefined),
    allUsersWithNotificationsEnabled: vi.fn().mockResolvedValue([]),
    lastNotificationDelivery: vi.fn().mockResolvedValue(null),
    recordNotificationDelivery: vi.fn().mockResolvedValue(undefined),
    trackNotificationOpened: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockPush(): PushProvider {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendWithData: vi.fn().mockResolvedValue(undefined),
    sendSilent: vi.fn().mockResolvedValue(undefined),
  };
}

function defaultPrefs(): NotificationPreferences {
  return {
    user_id: "user-1",
    push_enabled: true,
    interval_seconds: 3600,
    wake_hour: 8,
    sleep_hour: 22,
    timezone: "America/New_York",
    stop_after_goal: false,
  };
}

function buildApp(svc: NotifyService): Hono {
  const a = new Hono();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.post("/devices", svc.handleRegisterDevice);
  a.delete("/devices", svc.handleDisableDevice);
  a.get("/preferences", svc.handleGetPrefs);
  a.put("/preferences", svc.handleUpdatePrefs);
  return a;
}

describe("NotifyService", () => {
  describe("handleRegisterDevice", () => {
    it("rejects missing token (400)", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      const app = buildApp(svc);

      const res = await app.request("/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/token/i);
    });

    it("rejects token > 200 chars (400)", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      const app = buildApp(svc);

      const res = await app.request("/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "a".repeat(201) }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/token.*long/i);
    });

    it("registers successfully (201)", async () => {
      const db = mockNotifyDB();
      const svc = new NotifyService(db, mockPush());
      const app = buildApp(svc);

      const res = await app.request("/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "apns-token-abc",
          platform: "ios",
          device_model: "iPhone15,2",
          os_version: "17.0",
          app_version: "1.0.0",
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("registered");
      expect(db.upsertDeviceToken).toHaveBeenCalled();
      expect(db.ensureNotificationPreferences).toHaveBeenCalledWith("user-1");
    });
  });

  describe("handleDisableDevice", () => {
    it("rejects missing token (400)", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      const app = buildApp(svc);

      const res = await app.request("/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/token/i);
    });
  });

  describe("handleGetPrefs", () => {
    it("returns preferences", async () => {
      const prefs = defaultPrefs();
      const db = mockNotifyDB({
        getNotificationPreferences: vi.fn().mockResolvedValue(prefs),
      });
      const svc = new NotifyService(db, mockPush());
      const app = buildApp(svc);

      const res = await app.request("/preferences");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user_id).toBe("user-1");
      expect(body.interval_seconds).toBe(3600);
      expect(body.wake_hour).toBe(8);
    });
  });

  describe("handleUpdatePrefs", () => {
    it("rejects interval < 300 (400)", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      const app = buildApp(svc);

      const res = await app.request("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval_seconds: 100 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/interval_seconds/i);
    });

    it("rejects wake_hour > 23 (400)", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      const app = buildApp(svc);

      const res = await app.request("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wake_hour: 24 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/wake_hour/i);
    });

    it("updates preferences", async () => {
      const upsert = vi.fn().mockResolvedValue(undefined);
      const db = mockNotifyDB({
        upsertNotificationPreferences: upsert,
      });
      const svc = new NotifyService(db, mockPush());
      const app = buildApp(svc);

      const res = await app.request("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval_seconds: 600, wake_hour: 9 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.interval_seconds).toBe(600);
      expect(body.wake_hour).toBe(9);
      expect(upsert).toHaveBeenCalled();
    });
  });
});
