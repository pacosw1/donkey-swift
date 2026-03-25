import { ValidationError, NotFoundError, ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

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

// ── Service ─────────────────────────────────────────────────────────────────

export class GrantService {
  constructor(private db: GrantDB) {}

  async grantPremium(input: {
    userId?: string;
    grantedBy?: string;
    reason?: string;
    productId?: string;
    days?: number;
  }): Promise<PremiumGrant> {
    if (!input.userId) throw new ValidationError("userId is required");
    if (!input.grantedBy) throw new ValidationError("grantedBy is required");
    if (!input.reason) throw new ValidationError("reason is required");

    let expiresAt: Date | undefined;
    if (input.days && input.days > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + input.days);
    }

    const grant: PremiumGrant = {
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
    } catch {
      throw new ServiceError("INTERNAL", "failed to create grant");
    }
    return grant;
  }

  async isGrantedPremium(userId: string): Promise<boolean> {
    if (!userId) throw new ValidationError("userId is required");
    const grant = await this.db.getActiveGrant(userId);
    return grant !== null;
  }

  async getActiveGrant(userId: string): Promise<PremiumGrant | null> {
    if (!userId) throw new ValidationError("userId is required");
    return this.db.getActiveGrant(userId);
  }

  async revokeGrant(grantId: string): Promise<void> {
    if (!grantId) throw new ValidationError("grantId is required");

    try {
      await this.db.revokeGrant(grantId, new Date());
    } catch {
      throw new ServiceError("INTERNAL", "failed to revoke grant");
    }
  }

  async listGrants(userId: string): Promise<PremiumGrant[]> {
    if (!userId) throw new ValidationError("userId is required");
    return this.db.listGrants(userId);
  }

  async listAllActiveGrants(): Promise<PremiumGrant[]> {
    return this.db.listAllActiveGrants();
  }
}
