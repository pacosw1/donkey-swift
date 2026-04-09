import { describe, expect, it, vi } from "vitest";
import {
  createLogger,
  ErrorReportingService,
  type ErrorReportDB,
  serializeError,
} from "../logging/index.js";

describe("logging", () => {
  it("writes structured log lines with child fields", () => {
    const writer = vi.fn();
    const logger = createLogger({
      minLevel: "debug",
      baseFields: { service: "api" },
      writer,
    }).child({ domain: "auth" });

    logger.info("signed in", { user_id: "u1" });

    expect(writer).toHaveBeenCalledTimes(1);
    const [line, level] = writer.mock.calls[0] as [string, string];
    const payload = JSON.parse(line) as Record<string, unknown>;

    expect(level).toBe("info");
    expect(payload.message).toBe("signed in");
    expect(payload.service).toBe("api");
    expect(payload.domain).toBe("auth");
    expect(payload.user_id).toBe("u1");
    expect(typeof payload.ts).toBe("string");
  });

  it("serializes unknown errors safely", () => {
    expect(serializeError(new Error("boom")).message).toBe("boom");
    expect(serializeError("bad").message).toBe("bad");
  });

  it("persists server or client error reports through the db interface", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const db: ErrorReportDB = {
      async saveErrorReport(report) {
        saved.push(report as Record<string, unknown>);
      },
    };

    const service = new ErrorReportingService(db);
    await service.submitClientReport(
      {
        category: "network_request_failed",
        message: "timed out",
        app_version: "1.2.3",
        device_model: "iPhone16,1",
      },
      {
        userId: "user-1",
        requestId: "req-1",
      },
    );

    expect(saved).toHaveLength(1);
    expect(saved[0].source).toBe("client");
    expect(saved[0].category).toBe("network_request_failed");
    expect(saved[0].message).toBe("timed out");
    expect(saved[0].userId).toBe("user-1");
    expect(saved[0].appVersion).toBe("1.2.3");
    expect(saved[0].deviceModel).toBe("iPhone16,1");
    expect(saved[0].createdAt).toBeInstanceOf(Date);
  });
});
