export type CommissionModel = {
    type: "revenue_share";
    percent: number;
} | {
    type: "flat_per_purchase";
    amount_cents: number;
    currency: string;
} | {
    type: "flat_per_redemption";
    amount_cents: number;
    currency: string;
};
export interface Influencer {
    id: string;
    name: string;
    email?: string;
    portal_token: string;
    commission: CommissionModel;
    active: boolean;
    created_at: Date;
}
export interface PromoCode {
    code: string;
    influencer_id: string;
    type: "discount" | "trial_extension" | "premium_grant";
    discount_pct?: number;
    grant_days?: number;
    max_redemptions: number;
    redeemed_count: number;
    expires_at?: Date;
    active: boolean;
    created_at: Date;
}
export interface PromoRedemption {
    id: string;
    user_id: string;
    code: string;
    influencer_id: string;
    redeemed_at: Date;
    purchase_amount_cents?: number;
    commission_cents?: number;
}
export interface PromoDB {
    getCode(code: string): Promise<PromoCode | null>;
    createCode(code: PromoCode): Promise<void>;
    updateCode(code: string, updates: Partial<PromoCode>): Promise<void>;
    listCodes(opts?: {
        influencer_id?: string;
        active?: boolean;
    }): Promise<PromoCode[]>;
    incrementRedeemed(code: string): Promise<void>;
    recordRedemption(redemption: PromoRedemption): Promise<void>;
    hasRedeemed(userId: string, code: string): Promise<boolean>;
    listRedemptions(opts: {
        influencer_id?: string;
        code?: string;
    }): Promise<PromoRedemption[]>;
    getInfluencer(id: string): Promise<Influencer | null>;
    getInfluencerByToken(portalToken: string): Promise<Influencer | null>;
    createInfluencer(influencer: Influencer): Promise<void>;
    updateInfluencer(id: string, updates: Partial<Influencer>): Promise<void>;
    listInfluencers(): Promise<Influencer[]>;
}
export declare class PromoService {
    private db;
    constructor(db: PromoDB);
    redeemCode(userId: string, code: string): Promise<{
        type: PromoCode["type"];
        discount_pct?: number;
        grant_days?: number;
    }>;
    recordPurchase(userId: string, code: string, amountCents: number): Promise<void>;
    getInfluencerStats(influencerId: string): Promise<{
        totalRedemptions: number;
        totalPurchases: number;
        totalEarningsCents: number;
        codes: PromoCode[];
    }>;
    getInfluencerPortal(portalToken: string): Promise<{
        influencer: Omit<Influencer, "portal_token">;
        stats: {
            totalRedemptions: number;
            totalPurchases: number;
            totalEarningsCents: number;
        };
        recentRedemptions: Array<{
            code: string;
            redeemed_at: Date;
        }>;
    }>;
    createCode(input: {
        code?: string;
        influencer_id?: string;
        type?: PromoCode["type"];
        discount_pct?: number;
        grant_days?: number;
        max_redemptions?: number;
        expires_at?: Date;
    }): Promise<PromoCode>;
    updateCode(code: string, input: {
        discount_pct?: number;
        grant_days?: number;
        max_redemptions?: number;
        expires_at?: Date;
        active?: boolean;
    }): Promise<PromoCode>;
    deactivateCode(code: string): Promise<void>;
    listCodes(opts?: {
        influencer_id?: string;
        active?: boolean;
    }): Promise<PromoCode[]>;
    createInfluencer(input: {
        id?: string;
        name?: string;
        email?: string;
        commission?: CommissionModel;
    }): Promise<Influencer>;
    updateInfluencer(id: string, input: {
        name?: string;
        email?: string;
        commission?: CommissionModel;
        active?: boolean;
    }): Promise<void>;
    listInfluencers(): Promise<Influencer[]>;
    private calculateCommission;
}
//# sourceMappingURL=index.d.ts.map