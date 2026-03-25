export interface PremiumGrant {
    id: string;
    user_id: string;
    granted_by: string;
    reason: string;
    product_id?: string;
    expires_at?: Date;
    created_at: Date;
    revoked_at?: Date;
}
export interface GrantDB {
    createGrant(grant: PremiumGrant): Promise<void>;
    getActiveGrant(userId: string): Promise<PremiumGrant | null>;
    listGrants(userId: string): Promise<PremiumGrant[]>;
    revokeGrant(grantId: string, revokedAt: Date): Promise<void>;
    listAllActiveGrants(): Promise<PremiumGrant[]>;
}
export declare class GrantService {
    private db;
    constructor(db: GrantDB);
    grantPremium(input: {
        userId?: string;
        grantedBy?: string;
        reason?: string;
        productId?: string;
        days?: number;
    }): Promise<PremiumGrant>;
    isGrantedPremium(userId: string): Promise<boolean>;
    getActiveGrant(userId: string): Promise<PremiumGrant | null>;
    revokeGrant(grantId: string): Promise<void>;
    listGrants(userId: string): Promise<PremiumGrant[]>;
    listAllActiveGrants(): Promise<PremiumGrant[]>;
}
//# sourceMappingURL=index.d.ts.map