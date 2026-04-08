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
    listSources(opts?: {
        channel?: string;
        campaign?: string;
        active?: boolean;
    }): Promise<AttributionSource[]>;
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
export declare class AttributionService {
    private db;
    constructor(db: AttributionDB);
    createSource(input: {
        id?: string;
        slug?: string;
        name?: string;
        channel?: string;
        source?: string;
        campaign?: string;
        platform?: string;
        destination_url?: string;
        metadata?: Record<string, unknown>;
    }): Promise<AttributionSource>;
    updateSource(id: string, input: {
        slug?: string;
        name?: string;
        channel?: string;
        source?: string;
        campaign?: string;
        platform?: string;
        destination_url?: string;
        active?: boolean;
        metadata?: Record<string, unknown>;
    }): Promise<void>;
    listSources(opts?: {
        channel?: string;
        campaign?: string;
        active?: boolean;
    }): Promise<AttributionSource[]>;
    resolveSource(slug: string): Promise<AttributionSource>;
    buildTrackedUrl(baseRedirectUrl: string, slug: string, extraQuery?: Record<string, string | number | boolean | undefined>): string;
    recordClick(input: {
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
    }): Promise<{
        click: AttributionClick;
        source: AttributionSource;
    }>;
    recordConversion(input: {
        sourceId?: string;
        slug?: string;
        clickId?: string;
        userId?: string;
        event?: string;
        valueCents?: number;
        currency?: string;
        metadata?: Record<string, unknown>;
        created_at?: Date | string;
    }): Promise<AttributionConversion>;
    getSourceStats(sourceId: string, opts?: {
        since?: Date | string;
    }): Promise<SourceStats>;
    getChannelStats(opts?: {
        since?: Date | string;
        active?: boolean;
    }): Promise<GroupStats[]>;
    getCampaignStats(opts?: {
        since?: Date | string;
        active?: boolean;
    }): Promise<GroupStats[]>;
}
//# sourceMappingURL=index.d.ts.map