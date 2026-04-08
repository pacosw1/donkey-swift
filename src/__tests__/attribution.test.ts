import { describe, expect, it, vi } from "vitest";
import {
  AttributionService,
  type AttributionClick,
  type AttributionConversion,
  type AttributionDB,
  type AttributionSource,
} from "../attribution/index.js";
import { NotFoundError, ValidationError } from "../errors/index.js";

function makeSource(overrides: Partial<AttributionSource> = {}): AttributionSource {
  return {
    id: "src-1",
    slug: "tiktok-john",
    name: "TikTok John",
    channel: "tiktok",
    source: "john_creator",
    campaign: "lent-2026",
    platform: "ios",
    destination_url: "https://apps.apple.com/app/id123456",
    active: true,
    metadata: { landing_page: "/tiktok/john" },
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeClick(overrides: Partial<AttributionClick> = {}): AttributionClick {
  return {
    id: "clk-1",
    source_id: "src-1",
    clicked_at: new Date("2026-01-02T00:00:00Z"),
    anonymous_id: "anon-1",
    destination_url: "https://apps.apple.com/app/id123456",
    ...overrides,
  };
}

function makeConversion(overrides: Partial<AttributionConversion> = {}): AttributionConversion {
  return {
    id: "conv-1",
    source_id: "src-1",
    event: "purchase",
    value_cents: 999,
    currency: "USD",
    created_at: new Date("2026-01-03T00:00:00Z"),
    ...overrides,
  };
}

function mockDB(overrides: Partial<AttributionDB> = {}): AttributionDB {
  return {
    getSourceById: vi.fn().mockResolvedValue(makeSource()),
    getSourceBySlug: vi.fn().mockResolvedValue(makeSource()),
    createSource: vi.fn().mockResolvedValue(undefined),
    updateSource: vi.fn().mockResolvedValue(undefined),
    listSources: vi.fn().mockResolvedValue([makeSource()]),
    createClick: vi.fn().mockResolvedValue(undefined),
    listClicks: vi.fn().mockResolvedValue([makeClick()]),
    createConversion: vi.fn().mockResolvedValue(undefined),
    listConversions: vi.fn().mockResolvedValue([makeConversion()]),
    ...overrides,
  };
}

describe("AttributionService", () => {
  it("creates a source with normalized slug", async () => {
    const db = mockDB({ getSourceBySlug: vi.fn().mockResolvedValue(null) });
    const svc = new AttributionService(db);

    const source = await svc.createSource({
      name: "TikTok John",
      channel: "tiktok",
      source: "john_creator",
      destination_url: "https://apps.apple.com/app/id123456",
    });

    expect(source.slug).toBe("tiktok-john");
    expect(db.createSource).toHaveBeenCalledWith(expect.objectContaining({
      slug: "tiktok-john",
      active: true,
    }));
  });

  it("rejects duplicate slug on create", async () => {
    const db = mockDB();
    const svc = new AttributionService(db);

    await expect(svc.createSource({
      name: "TikTok John",
      channel: "tiktok",
      source: "john_creator",
      destination_url: "https://apps.apple.com/app/id123456",
    })).rejects.toThrow(ValidationError);
  });

  it("builds tracked redirect URL", () => {
    const svc = new AttributionService(mockDB());
    const url = svc.buildTrackedUrl("https://sacredscrolls.app/r", "TikTok John", {
      campaign: "lent-2026",
      variant: 2,
    });

    expect(url).toContain("/r/tiktok-john");
    expect(url).toContain("campaign=lent-2026");
    expect(url).toContain("variant=2");
  });

  it("records a click by slug and returns resolved source", async () => {
    const db = mockDB();
    const svc = new AttributionService(db);

    const { click, source } = await svc.recordClick({
      slug: "tiktok-john",
      anonymous_id: "anon-123",
      referrer: "https://tiktok.com",
    });

    expect(source.id).toBe("src-1");
    expect(click.source_id).toBe("src-1");
    expect(db.createClick).toHaveBeenCalledWith(expect.objectContaining({
      source_id: "src-1",
      anonymous_id: "anon-123",
    }));
  });

  it("records a conversion by source id", async () => {
    const db = mockDB();
    const svc = new AttributionService(db);

    const conversion = await svc.recordConversion({
      sourceId: "src-1",
      event: "signup",
      userId: "user-1",
      valueCents: 0,
    });

    expect(conversion.event).toBe("signup");
    expect(db.createConversion).toHaveBeenCalledWith(expect.objectContaining({
      source_id: "src-1",
      user_id: "user-1",
    }));
  });

  it("throws when resolving missing source", async () => {
    const db = mockDB({ getSourceBySlug: vi.fn().mockResolvedValue(null) });
    const svc = new AttributionService(db);
    await expect(svc.resolveSource("missing")).rejects.toThrow(NotFoundError);
  });

  it("computes source stats", async () => {
    const clicks = [
      makeClick({ id: "clk-1", anonymous_id: "anon-1" }),
      makeClick({ id: "clk-2", anonymous_id: "anon-1" }),
      makeClick({ id: "clk-3", anonymous_id: "anon-2" }),
    ];
    const conversions = [
      makeConversion({ id: "conv-1", event: "signup", value_cents: 0 }),
      makeConversion({ id: "conv-2", event: "purchase", value_cents: 1999 }),
    ];
    const db = mockDB({
      listClicks: vi.fn().mockResolvedValue(clicks),
      listConversions: vi.fn().mockResolvedValue(conversions),
    });
    const svc = new AttributionService(db);

    const stats = await svc.getSourceStats("src-1");
    expect(stats.clicks).toBe(3);
    expect(stats.unique_clicks).toBe(2);
    expect(stats.conversions).toBe(2);
    expect(stats.revenue_cents).toBe(1999);
    expect(stats.conversions_by_event.signup).toBe(1);
    expect(stats.conversions_by_event.purchase).toBe(1);
  });

  it("computes grouped channel stats", async () => {
    const sources = [
      makeSource({ id: "src-1", channel: "tiktok" }),
      makeSource({ id: "src-2", slug: "twitter-jane", channel: "twitter", source: "jane" }),
    ];
    const clicks = [
      makeClick({ id: "clk-1", source_id: "src-1", anonymous_id: "a1" }),
      makeClick({ id: "clk-2", source_id: "src-1", anonymous_id: "a2" }),
      makeClick({ id: "clk-3", source_id: "src-2", anonymous_id: "a3" }),
    ];
    const conversions = [
      makeConversion({ id: "conv-1", source_id: "src-1", value_cents: 999 }),
      makeConversion({ id: "conv-2", source_id: "src-2", value_cents: 0, event: "signup" }),
    ];
    const db = mockDB({
      listSources: vi.fn().mockResolvedValue(sources),
      listClicks: vi.fn().mockResolvedValue(clicks),
      listConversions: vi.fn().mockResolvedValue(conversions),
    });
    const svc = new AttributionService(db);

    const stats = await svc.getChannelStats();
    expect(stats[0]).toEqual(expect.objectContaining({
      key: "tiktok",
      clicks: 2,
      unique_clicks: 2,
      conversions: 1,
      revenue_cents: 999,
    }));
    expect(stats[1]).toEqual(expect.objectContaining({
      key: "twitter",
      clicks: 1,
      conversions: 1,
    }));
  });
});
