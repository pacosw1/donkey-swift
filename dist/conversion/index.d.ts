export interface ConversionOffer {
    user_id: string;
    discount_pct: number;
    product_id?: string;
    expires_at: Date | string;
    trigger: "paywall_dismissals" | "lifecycle_stage" | "inactivity_winback";
    redeemed: boolean;
    created_at: Date | string;
}
export interface ConversionConfig {
    dismissalThreshold?: number;
    discountPct?: number;
    offerTtlMinutes?: number;
    cooldownDays?: number;
    triggerStages?: string[];
    inactivityDays?: number;
}
export interface ConversionDB {
    getActiveOffer(userId: string): Promise<ConversionOffer | null>;
    createOffer(offer: ConversionOffer): Promise<void>;
    markRedeemed(userId: string): Promise<void>;
    countDismissals(userId: string, since: Date): Promise<number>;
    recordDismissal(userId: string): Promise<void>;
    lastOfferDate(userId: string): Promise<Date | string | null>;
}
export declare class ConversionService {
    private db;
    private dismissalThreshold;
    private discountPct;
    private offerTtlMinutes;
    private cooldownDays;
    private triggerStages;
    private inactivityDays;
    constructor(cfg: ConversionConfig, db: ConversionDB);
    recordDismissal(userId: string): Promise<void>;
    checkEligibility(userId: string, opts?: {
        stage?: string;
        daysSinceActive?: number;
    }): Promise<ConversionOffer | null>;
    getActiveOffer(userId: string): Promise<ConversionOffer | null>;
    redeemOffer(userId: string): Promise<void>;
    private isInCooldown;
    private isExpired;
    private createOffer;
}
//# sourceMappingURL=index.d.ts.map