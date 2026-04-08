import { NotFoundError, ServiceError, ValidationError } from "../errors/index.js";
function normalizeSlug(input) {
    return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function isValidUrl(input) {
    try {
        const url = new URL(input);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
function parseDateOrThrow(input, field) {
    const parsed = input instanceof Date ? input : new Date(input ?? "");
    if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError(`${field} must be a valid date`);
    }
    return parsed;
}
function ensureObject(value, field) {
    if (value === undefined)
        return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError(`${field} must be an object`);
    }
    return value;
}
function aggregateStats(sources, clicks, conversions, keyOf) {
    const grouped = new Map();
    for (const source of sources) {
        const key = keyOf(source);
        if (!grouped.has(key)) {
            grouped.set(key, { clickIds: new Set(), anonIds: new Set(), conversions: 0, revenue_cents: 0 });
        }
    }
    const sourceById = new Map(sources.map((s) => [s.id, s]));
    for (const click of clicks) {
        const source = sourceById.get(click.source_id);
        if (!source)
            continue;
        const bucket = grouped.get(keyOf(source));
        if (!bucket)
            continue;
        bucket.clickIds.add(click.id);
        bucket.anonIds.add(click.anonymous_id || click.id);
    }
    for (const conversion of conversions) {
        const source = sourceById.get(conversion.source_id);
        if (!source)
            continue;
        const bucket = grouped.get(keyOf(source));
        if (!bucket)
            continue;
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
    db;
    constructor(db) {
        this.db = db;
    }
    async createSource(input) {
        if (!input.name?.trim())
            throw new ValidationError("name is required");
        if (!input.channel?.trim())
            throw new ValidationError("channel is required");
        if (!input.source?.trim())
            throw new ValidationError("source is required");
        if (!input.destination_url?.trim())
            throw new ValidationError("destination_url is required");
        if (!isValidUrl(input.destination_url))
            throw new ValidationError("destination_url must be a valid http(s) URL");
        const slug = normalizeSlug(input.slug || input.name);
        if (!slug)
            throw new ValidationError("slug is required");
        const existing = await this.db.getSourceBySlug(slug);
        if (existing)
            throw new ValidationError("slug already exists");
        const source = {
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
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to create attribution source");
        }
        return source;
    }
    async updateSource(id, input) {
        if (!id)
            throw new ValidationError("id is required");
        const existing = await this.db.getSourceById(id);
        if (!existing)
            throw new NotFoundError("attribution source not found");
        const updates = {};
        if (input.slug !== undefined) {
            const slug = normalizeSlug(input.slug);
            if (!slug)
                throw new ValidationError("slug is invalid");
            const bySlug = await this.db.getSourceBySlug(slug);
            if (bySlug && bySlug.id !== id)
                throw new ValidationError("slug already exists");
            updates.slug = slug;
        }
        if (input.name !== undefined)
            updates.name = input.name.trim();
        if (input.channel !== undefined)
            updates.channel = input.channel.trim();
        if (input.source !== undefined)
            updates.source = input.source.trim();
        if (input.campaign !== undefined)
            updates.campaign = input.campaign?.trim() || undefined;
        if (input.platform !== undefined)
            updates.platform = input.platform?.trim() || undefined;
        if (input.destination_url !== undefined) {
            if (!isValidUrl(input.destination_url))
                throw new ValidationError("destination_url must be a valid http(s) URL");
            updates.destination_url = input.destination_url;
        }
        if (input.active !== undefined)
            updates.active = input.active;
        if (input.metadata !== undefined)
            updates.metadata = ensureObject(input.metadata, "metadata");
        try {
            await this.db.updateSource(id, updates);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to update attribution source");
        }
    }
    async listSources(opts) {
        return this.db.listSources(opts);
    }
    async resolveSource(slug) {
        if (!slug)
            throw new ValidationError("slug is required");
        const source = await this.db.getSourceBySlug(normalizeSlug(slug));
        if (!source || !source.active)
            throw new NotFoundError("attribution source not found");
        return source;
    }
    buildTrackedUrl(baseRedirectUrl, slug, extraQuery) {
        if (!isValidUrl(baseRedirectUrl))
            throw new ValidationError("baseRedirectUrl must be a valid http(s) URL");
        if (!slug)
            throw new ValidationError("slug is required");
        const url = new URL(baseRedirectUrl);
        url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeURIComponent(normalizeSlug(slug))}`;
        if (extraQuery) {
            for (const [key, value] of Object.entries(extraQuery)) {
                if (value !== undefined)
                    url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }
    async recordClick(input) {
        const source = input.sourceId
            ? await this.db.getSourceById(input.sourceId)
            : input.slug
                ? await this.db.getSourceBySlug(normalizeSlug(input.slug))
                : null;
        if (!source || !source.active)
            throw new NotFoundError("attribution source not found");
        const click = {
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
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to record attribution click");
        }
        return { click, source };
    }
    async recordConversion(input) {
        if (!input.event?.trim())
            throw new ValidationError("event is required");
        if (input.valueCents !== undefined && input.valueCents < 0)
            throw new ValidationError("valueCents must be non-negative");
        const source = input.sourceId
            ? await this.db.getSourceById(input.sourceId)
            : input.slug
                ? await this.db.getSourceBySlug(normalizeSlug(input.slug))
                : null;
        if (!source)
            throw new NotFoundError("attribution source not found");
        const conversion = {
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
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to record attribution conversion");
        }
        return conversion;
    }
    async getSourceStats(sourceId, opts) {
        if (!sourceId)
            throw new ValidationError("sourceId is required");
        const source = await this.db.getSourceById(sourceId);
        if (!source)
            throw new NotFoundError("attribution source not found");
        const clicks = await this.db.listClicks({ source_id: sourceId, since: opts?.since });
        const conversions = await this.db.listConversions({ source_id: sourceId, since: opts?.since });
        const conversionsByEvent = {};
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
    async getChannelStats(opts) {
        const sources = await this.db.listSources({ active: opts?.active });
        const clicks = await this.db.listClicks({ since: opts?.since });
        const conversions = await this.db.listConversions({ since: opts?.since });
        return aggregateStats(sources, clicks, conversions, (source) => source.channel);
    }
    async getCampaignStats(opts) {
        const sources = (await this.db.listSources({ active: opts?.active })).filter((source) => !!source.campaign);
        const clicks = await this.db.listClicks({ since: opts?.since });
        const conversions = await this.db.listConversions({ since: opts?.since });
        return aggregateStats(sources, clicks, conversions, (source) => source.campaign || "");
    }
}
//# sourceMappingURL=index.js.map