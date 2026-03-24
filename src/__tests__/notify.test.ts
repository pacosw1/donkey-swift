import { describe, it, expect, vi } from "vitest";
import {
  NotifyService,
  getHourInTimezone,
  exampleTick,
  type NotifyDB,
  type NotificationPreferences,
  type DeviceToken,
} from "../notify/index.js";
import type { PushProvider } from "../push/index.js";
import { ValidationError, ServiceError } from "../errors/index.js";

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

describe("NotifyService", () => {
  describe("registerDevice", () => {
    it("rejects missing token", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      await expect(
        svc.registerDevice("user-1", { token: "" })
      ).rejects.toThrow(ValidationError);
      await expect(
        svc.registerDevice("user-1", { token: "" })
      ).rejects.toThrow(/token/i);
    });

    it("rejects token > 200 chars", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      await expect(
        svc.registerDevice("user-1", { token: "a".repeat(201) })
      ).rejects.toThrow(/token.*long/i);
    });

    it("registers successfully", async () => {
      const db = mockNotifyDB();
      const svc = new NotifyService(db, mockPush());

      const result = await svc.registerDevice("user-1", {
        token: "apns-token-abc",
        platform: "ios",
        device_model: "iPhone15,2",
        os_version: "17.0",
        app_version: "1.0.0",
      });

      expect(result.status).toBe("registered");
      expect(db.upsertDeviceToken).toHaveBeenCalled();
      expect(db.ensureNotificationPreferences).toHaveBeenCalledWith("user-1");
    });

    it("throws ServiceError when DB fails", async () => {
      const db = mockNotifyDB({
        upsertDeviceToken: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const svc = new NotifyService(db, mockPush());
      await expect(
        svc.registerDevice("user-1", { token: "valid-token" })
      ).rejects.toThrow(ServiceError);
    });
  });

  describe("disableDevice", () => {
    it("rejects missing token", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      await expect(svc.disableDevice("user-1", "")).rejects.toThrow(/token/i);
    });

    it("disables successfully", async () => {
      const db = mockNotifyDB();
      const svc = new NotifyService(db, mockPush());
      const result = await svc.disableDevice("user-1", "some-token");
      expect(result.status).toBe("disabled");
      expect(db.disableDeviceToken).toHaveBeenCalledWith("user-1", "some-token");
    });
  });

  describe("getPreferences", () => {
    it("returns preferences", async () => {
      const prefs = defaultPrefs();
      const db = mockNotifyDB({
        getNotificationPreferences: vi.fn().mockResolvedValue(prefs),
      });
      const svc = new NotifyService(db, mockPush());

      const result = await svc.getPreferences("user-1");
      expect(result.user_id).toBe("user-1");
      expect(result.interval_seconds).toBe(3600);
      expect(result.wake_hour).toBe(8);
    });
  });

  describe("updatePreferences", () => {
    it("rejects interval < 300", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      await expect(
        svc.updatePreferences("user-1", { interval_seconds: 100 })
      ).rejects.toThrow(/interval_seconds/i);
    });

    it("rejects wake_hour > 23", async () => {
      const svc = new NotifyService(mockNotifyDB(), mockPush());
      await expect(
        svc.updatePreferences("user-1", { wake_hour: 24 })
      ).rejects.toThrow(/wake_hour/i);
    });

    it("updates preferences", async () => {
      const upsert = vi.fn().mockResolvedValue(undefined);
      const db = mockNotifyDB({
        upsertNotificationPreferences: upsert,
      });
      const svc = new NotifyService(db, mockPush());

      const result = await svc.updatePreferences("user-1", { interval_seconds: 600, wake_hour: 9 });
      expect(result.interval_seconds).toBe(600);
      expect(result.wake_hour).toBe(9);
      expect(upsert).toHaveBeenCalled();
    });
  });

  describe("trackOpened", () => {
    it("tracks notification opened", async () => {
      const db = mockNotifyDB();
      const svc = new NotifyService(db, mockPush());
      await svc.trackOpened("user-1", "notif-123");
      expect(db.trackNotificationOpened).toHaveBeenCalledWith("user-1", "notif-123");
    });

    it("does not throw when DB fails", async () => {
      const db = mockNotifyDB({
        trackNotificationOpened: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const svc = new NotifyService(db, mockPush());
      await expect(svc.trackOpened("user-1", "notif-123")).resolves.toBeUndefined();
    });
  });
});

// ── getHourInTimezone ───────────────────────────────────────────────────────

describe("getHourInTimezone", () => {
  it("returns correct hour for a known timezone", () => {
    // Create a date with a known UTC time: 2025-06-15T14:30:00Z (2:30 PM UTC)
    const date = new Date("2025-06-15T14:30:00Z");
    // America/New_York is UTC-4 in summer (EDT), so 14:00 UTC = 10:30 AM ET
    const hour = getHourInTimezone(date, "America/New_York");
    expect(hour).toBe(10);
  });

  it("returns correct hour for UTC timezone", () => {
    const date = new Date("2025-06-15T23:15:00Z");
    const hour = getHourInTimezone(date, "UTC");
    expect(hour).toBe(23);
  });

  it("handles midnight correctly", () => {
    const date = new Date("2025-06-15T00:05:00Z");
    const hour = getHourInTimezone(date, "UTC");
    expect(hour).toBe(0);
  });

  it("falls back to local hour for invalid timezone", () => {
    const date = new Date("2025-06-15T12:00:00Z");
    // Invalid timezone should fall back to date.getHours()
    const hour = getHourInTimezone(date, "Invalid/Timezone");
    expect(typeof hour).toBe("number");
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("returns correct hour for a timezone ahead of UTC", () => {
    // Asia/Tokyo is UTC+9
    const date = new Date("2025-06-15T20:00:00Z");
    // 20:00 UTC + 9 = 05:00 next day
    const hour = getHourInTimezone(date, "Asia/Tokyo");
    expect(hour).toBe(5);
  });
});

// ── exampleTick ─────────────────────────────────────────────────────────────

describe("exampleTick", () => {
  it("calls push.send for each device token", async () => {
    const push = mockPush();
    const tokens: DeviceToken[] = [
      {
        id: "dt-1",
        user_id: "user-1",
        token: "apns-token-1",
        platform: "ios",
        device_model: "iPhone15,2",
        os_version: "17.0",
        app_version: "1.0.0",
        enabled: true,
        last_seen_at: new Date(),
      },
      {
        id: "dt-2",
        user_id: "user-1",
        token: "apns-token-2",
        platform: "ios",
        device_model: "iPad13,1",
        os_version: "17.0",
        app_version: "1.0.0",
        enabled: true,
        last_seen_at: new Date(),
      },
    ];

    await exampleTick("user-1", defaultPrefs(), tokens, push);

    expect(push.send).toHaveBeenCalledTimes(2);
    expect(push.send).toHaveBeenCalledWith("apns-token-1", "Reminder", "Don't forget to check in today.");
    expect(push.send).toHaveBeenCalledWith("apns-token-2", "Reminder", "Don't forget to check in today.");
  });

  it("handles push failure gracefully", async () => {
    const push = mockPush();
    (push.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("push failed"));

    const tokens: DeviceToken[] = [
      {
        id: "dt-1",
        user_id: "user-1",
        token: "bad-token",
        platform: "ios",
        device_model: "",
        os_version: "",
        app_version: "",
        enabled: true,
        last_seen_at: new Date(),
      },
    ];

    // Should not throw — errors are caught internally
    await expect(exampleTick("user-1", defaultPrefs(), tokens, push)).resolves.toBeUndefined();
  });

  it("does nothing with empty tokens array", async () => {
    const push = mockPush();
    await exampleTick("user-1", defaultPrefs(), [], push);
    expect(push.send).not.toHaveBeenCalled();
  });
});
