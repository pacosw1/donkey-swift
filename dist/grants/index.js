import { ValidationError, ServiceError } from "../errors/index.js";
// ── Service ─────────────────────────────────────────────────────────────────
export class GrantService {
    db;
    constructor(db) {
        this.db = db;
    }
    async grantPremium(input) {
        if (!input.userId)
            throw new ValidationError("userId is required");
        if (!input.grantedBy)
            throw new ValidationError("grantedBy is required");
        if (!input.reason)
            throw new ValidationError("reason is required");
        let expiresAt;
        if (input.days && input.days > 0) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + input.days);
        }
        const grant = {
            id: crypto.randomUUID(),
            user_id: input.userId,
            granted_by: input.grantedBy,
            reason: input.reason,
            product_id: input.productId,
            expires_at: expiresAt,
            created_at: new Date(),
        };
        try {
            await this.db.createGrant(grant);
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to create grant");
        }
        return grant;
    }
    async isGrantedPremium(userId) {
        if (!userId)
            throw new ValidationError("userId is required");
        const grant = await this.db.getActiveGrant(userId);
        return grant !== null;
    }
    async getActiveGrant(userId) {
        if (!userId)
            throw new ValidationError("userId is required");
        return this.db.getActiveGrant(userId);
    }
    async revokeGrant(grantId) {
        if (!grantId)
            throw new ValidationError("grantId is required");
        try {
            await this.db.revokeGrant(grantId, new Date());
        }
        catch {
            throw new ServiceError("INTERNAL", "failed to revoke grant");
        }
    }
    async listGrants(userId) {
        if (!userId)
            throw new ValidationError("userId is required");
        return this.db.listGrants(userId);
    }
    async listAllActiveGrants() {
        return this.db.listAllActiveGrants();
    }
}
//# sourceMappingURL=index.js.map