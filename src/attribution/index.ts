import { NotFoundError, ServiceError, ValidationError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AttributionSource {
  id: string;
  slug: string;
  name: string;
  channel: string;
  source: string;
  campaign?: string;
  platform?: string;
  destination_url: string;
  active: boolean;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

export interface AttributionClick {
  id: string;
  source_id: string;
  clicked_at: Date;
  ip_hash?: string;
  user_agent?: string;
  referrer?: string;
  country?: string;
  anonymous_id?: string;
  promo_code?: string;
  landing_path?: string;
  destination_url?: string;
  metadata?: Record<string, unknown>;
}

export interface AttributionConversion {
  id: string;
  source_id: string;
  click_id?: string;
  user_id?: string;
  event: string;
  value_cents?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

export interface SourceStats {
  source: AttributionSource;
  clicks: number;
  unique_clicks: number;
  conversions: number;
  revenue_cents: number;
  conversions_by_event: Record<string, number>;
}

export interface GroupStats {
  key: string;
  clicks: number;
  unique_clicks: number;
  conversions: number;
  revenue_cents: number;
}

export interface AttributionDB {
  getSourceById(id: string): Promise<AttributionSource | null>;
  getSourceBySlug(slug: string): Promise<AttributionSource | null>;
  createSource(source: AttributionSource): Promise<void>;
  updateSource(id: string, updates: Partial<AttributionSource>): Promise<void>;
  listSources(opts?: { channel?: string; campaign?: string; active?: boolean }): Promise<AttributionSource[]>;

  createClick(click: AttributionClick): Promise<void>;
  listClicks(opts?: {
    source_id?: string;
    channel?: string;
    campaign?: string;
    since?: Date | string;
  }): Promise<AttributionClick[]>;

  createConversion(conversion: AttributionConversion): Promise<void>;
  listConversions(opts?: {
    source_id?: string;
    channel?: string;
    campaign?: string;
    since?: Date | string;
    event?: string;
  }): Promise<AttributionConversion[]>;
}

function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseDateOrThrow(input: Date | string | undefined, field: string): Date {
  const parsed = input instanceof Date ? input : new Date(input ?? "");
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid date`);
  }
  return parsed;
}

function ensureObject(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function aggregateStats(
  sources: AttributionSource[],
  clicks: AttributionClick[],
  conversions: AttributionConversion[],
  keyOf: (source: AttributionSource) => string,
): GroupStats[] {
  const grouped = new Map<string, { clickIds: Set<string>; anonIds: Set<string>; conversions: number; revenue_cents: number }>();

  for (const source of sources) {
    const key = keyOf(source);
    if (!grouped.has(key)) {
      grouped.set(key, { clickIds: new Set(), anonIds: new Set(), conversions: 0, revenue_cents: 0 });
    }
  }

  const sourceById = new Map(sources.map((s) => [s.id, s]));

  for (const click of clicks) {
    const source = sourceById.get(click.source_id);
    if (!source) continue;
    const bucket = grouped.get(keyOf(source));
    if (!bucket) continue;
    bucket.clickIds.add(click.id);
    bucket.anonIds.add(click.anonymous_id || click.id);
  }

  for (const conversion of conversions) {
    const source = sourceById.get(conversion.source_id);
    if (!source) continue;
    const bucket = grouped.get(keyOf(source));
    if (!bucket) continue;
    bucket.conversions += 1;
    bucket.revenue_cents += conversion.value_cents ?? 0;
  }

  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      key,
      clicks: value.clickIds.size,
      unique_clicks: value.anonIds.size,
      conversions: value.conversions,
      revenue_cents: value.revenue_cents,
    }))
    .sort((a, b) => b.revenue_cents - a.revenue_cents || b.conversions - a.conversions || b.clicks - a.clicks);
}

// ── Service ─────────────────────────────────────────────────────────────────

export class AttributionService {
  constructor(private db: AttributionDB) {}

  async createSource(input: {
    id?: string;
    slug?: string;
    name?: string;
    channel?: string;
    source?: string;
    campaign?: string;
    platform?: string;
    destination_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AttributionSource> {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.channel?.trim()) throw new ValidationError("channel is required");
    if (!input.source?.trim()) throw new ValidationError("source is required");
    if (!input.destination_url?.trim()) throw new ValidationError("destination_url is required");
    if (!isValidUrl(input.destination_url)) throw new ValidationError("destination_url must be a valid http(s) URL");

    const slug = normalizeSlug(input.slug || input.name);
    if (!slug) throw new ValidationError("slug is required");

    const existing = await this.db.getSourceBySlug(slug);
    if (existing) throw new ValidationError("slug already exists");

    const source: AttributionSource = {
      id: input.id || crypto.randomUUID(),
      slug,
      name: input.name.trim(),
      channel: input.channel.trim(),
      source: input.source.trim(),
      campaign: input.campaign?.trim() || undefined,
      platform: input.platform?.trim() || undefined,
      destination_url: input.destination_url,
      active: true,
      metadata: ensureObject(input.metadata, "metadata"),
      created_at: new Date(),
    };

    try {
      await this.db.createSource(source);
    } catch {
      throw new ServiceError("INTERNAL", "failed to create attribution source");
    }
    return source;
  }

  async updateSource(id: string, input: {
    slug?: string;
    name?: string;
    channel?: string;
    source?: string;
    campaign?: string;
    platform?: string;
    destination_url?: string;
    active?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!id) throw new ValidationError("id is required");
    const existing = await this.db.getSourceById(id);
    if (!existing) throw new NotFoundError("attribution source not found");

    const updates: Partial<AttributionSource> = {};
    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug);
      if (!slug) throw new ValidationError("slug is invalid");
      const bySlug = await this.db.getSourceBySlug(slug);
      if (bySlug && bySlug.id !== id) throw new ValidationError("slug already exists");
      updates.slug = slug;
    }
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.channel !== undefined) updates.channel = input.channel.trim();
    if (input.source !== undefined) updates.source = input.source.trim();
    if (input.campaign !== undefined) updates.campaign = input.campaign?.trim() || undefined;
    if (input.platform !== undefined) updates.platform = input.platform?.trim() || undefined;
    if (input.destination_url !== undefined) {
      if (!isValidUrl(input.destination_url)) throw new ValidationError("destination_url must be a valid http(s) URL");
      updates.destination_url = input.destination_url;
    }
    if (input.active !== undefined) updates.active = input.active;
    if (input.metadata !== undefined) updates.metadata = ensureObject(input.metadata, "metadata");

    try {
      await this.db.updateSource(id, updates);
    } catch {
      throw new ServiceError("INTERNAL", "failed to update attribution source");
    }
  }

  async listSources(opts?: { channel?: string; campaign?: string; active?: boolean }): Promise<AttributionSource[]> {
    return this.db.listSources(opts);
  }

  async resolveSource(slug: string): Promise<AttributionSource> {
    if (!slug) throw new ValidationError("slug is required");
    const source = await this.db.getSourceBySlug(normalizeSlug(slug));
    if (!source || !source.active) throw new NotFoundError("attribution source not found");
    return source;
  }

  buildTrackedUrl(baseRedirectUrl: string, slug: string, extraQuery?: Record<string, string | number | boolean | undefined>): string {
    if (!isValidUrl(baseRedirectUrl)) throw new ValidationError("baseRedirectUrl must be a valid http(s) URL");
    if (!slug) throw new ValidationError("slug is required");
    const url = new URL(baseRedirectUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(normalizeSlug(slug))}`;
    if (extraQuery) {
      for (const [key, value] of Object.entries(extraQuery)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async recordClick(input: {
    sourceId?: string;
    slug?: string;
    clicked_at?: Date | string;
    ip_hash?: string;
    user_agent?: string;
    referrer?: string;
    country?: string;
    anonymous_id?: string;
    promo_code?: string;
    landing_path?: string;
    destination_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ click: AttributionClick; source: AttributionSource }> {
    const source = input.sourceId
      ? await this.db.getSourceById(input.sourceId)
      : input.slug
        ? await this.db.getSourceBySlug(normalizeSlug(input.slug))
        : null;

    if (!source || !source.active) throw new NotFoundError("attribution source not found");

    const click: AttributionClick = {
      id: crypto.randomUUID(),
      source_id: source.id,
      clicked_at: input.clicked_at ? parseDateOrThrow(input.clicked_at, "clicked_at") : new Date(),
      ip_hash: input.ip_hash,
      user_agent: input.user_agent,
      referrer: input.referrer,
      country: input.country,
      anonymous_id: input.anonymous_id,
      promo_code: input.promo_code,
      landing_path: input.landing_path,
      destination_url: input.destination_url || source.destination_url,
      metadata: ensureObject(input.metadata, "metadata"),
    };

    try {
      await this.db.createClick(click);
    } catch {
      throw new ServiceError("INTERNAL", "failed to record attribution click");
    }
    return { click, source };
  }

  async recordConversion(input: {
    sourceId?: string;
    slug?: string;
    clickId?: string;
    userId?: string;
    event?: string;
    valueCents?: number;
    currency?: string;
    metadata?: Record<string, unknown>;
    created_at?: Date | string;
  }): Promise<AttributionConversion> {
    if (!input.event?.trim()) throw new ValidationError("event is required");
    if (input.valueCents !== undefined && input.valueCents < 0) throw new ValidationError("valueCents must be non-negative");

    const source = input.sourceId
      ? await this.db.getSourceById(input.sourceId)
      : input.slug
        ? await this.db.getSourceBySlug(normalizeSlug(input.slug))
        : null;

    if (!source) throw new NotFoundError("attribution source not found");

    const conversion: AttributionConversion = {
      id: crypto.randomUUID(),
      source_id: source.id,
      click_id: input.clickId,
      user_id: input.userId,
      event: input.event.trim(),
      value_cents: input.valueCents,
      currency: input.currency,
      metadata: ensureObject(input.metadata, "metadata"),
      created_at: input.created_at ? parseDateOrThrow(input.created_at, "created_at") : new Date(),
    };

    try {
      await this.db.createConversion(conversion);
    } catch {
      throw new ServiceError("INTERNAL", "failed to record attribution conversion");
    }
    return conversion;
  }

  async getSourceStats(sourceId: string, opts?: { since?: Date | string }): Promise<SourceStats> {
    if (!sourceId) throw new ValidationError("sourceId is required");
    const source = await this.db.getSourceById(sourceId);
    if (!source) throw new NotFoundError("attribution source not found");

    const clicks = await this.db.listClicks({ source_id: sourceId, since: opts?.since });
    const conversions = await this.db.listConversions({ source_id: sourceId, since: opts?.since });

    const conversionsByEvent: Record<string, number> = {};
    for (const conversion of conversions) {
      conversionsByEvent[conversion.event] = (conversionsByEvent[conversion.event] || 0) + 1;
    }

    return {
      source,
      clicks: clicks.length,
      unique_clicks: new Set(clicks.map((click) => click.anonymous_id || click.id)).size,
      conversions: conversions.length,
      revenue_cents: conversions.reduce((sum, conversion) => sum + (conversion.value_cents ?? 0), 0),
      conversions_by_event: conversionsByEvent,
    };
  }

  async getChannelStats(opts?: { since?: Date | string; active?: boolean }): Promise<GroupStats[]> {
    const sources = await this.db.listSources({ active: opts?.active });
    const clicks = await this.db.listClicks({ since: opts?.since });
    const conversions = await this.db.listConversions({ since: opts?.since });
    return aggregateStats(sources, clicks, conversions, (source) => source.channel);
  }

  async getCampaignStats(opts?: { since?: Date | string; active?: boolean }): Promise<GroupStats[]> {
    const sources = (await this.db.listSources({ active: opts?.active })).filter((source) => !!source.campaign);
    const clicks = await this.db.listClicks({ since: opts?.since });
    const conversions = await this.db.listConversions({ since: opts?.since });
    return aggregateStats(sources, clicks, conversions, (source) => source.campaign || "");
  }
}
