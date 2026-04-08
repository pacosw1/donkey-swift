import { ServiceError } from "../errors/index.js";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AccountDB {
  getUserEmail(userId: string): Promise<string>;
  deleteUserData(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  anonymizeUser(userId: string): Promise<void>;
  exportUserData(userId: string): Promise<UserDataExport>;
  /**
   * Execute a callback inside a database transaction.
   * If the callback throws, the transaction must be rolled back.
   * Optional — if not provided, deletion steps run without a transaction wrapper.
   */
  withTransaction?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface AppCleanup {
  deleteAppData(userId: string): Promise<void>;
}

export interface AppExporter {
  exportAppData(userId: string): Promise<unknown>;
}

export interface IdentityRevocationResult {
  provider: string;
  attempted: boolean;
  revoked: boolean;
  reason?: string;
}

export interface IdentityRevoker {
  revokeIdentity(userId: string): Promise<IdentityRevocationResult>;
}

export interface UserDataExport {
  user: unknown;
  subscription?: unknown;
  events?: unknown;
  sessions?: unknown;
  feedback?: unknown;
  chat_messages?: unknown;
  device_tokens?: unknown;
  notification_preferences?: unknown;
  transactions?: unknown;
  app_data?: unknown;
}

export interface AccountConfig {
  onDelete?: (userId: string, email: string) => void;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class AccountService {
  private appCleanup?: AppCleanup;
  private appExport?: AppExporter;
  private identityRevoker?: IdentityRevoker;

  constructor(
    private cfg: AccountConfig,
    private db: AccountDB,
    opts?: { cleanup?: AppCleanup; exporter?: AppExporter; revoker?: IdentityRevoker }
  ) {
    this.appCleanup = opts?.cleanup;
    this.appExport = opts?.exporter;
    this.identityRevoker = opts?.revoker;
  }

  /** Delete a user account and all associated data. */
  async deleteAccount(
    userId: string
  ): Promise<{ status: string; identityRevocation?: IdentityRevocationResult }> {
    const email = await this.db.getUserEmail(userId).catch(() => "");
    let identityRevocation: IdentityRevocationResult | undefined;

    if (this.identityRevoker) {
      try {
        identityRevocation = await this.identityRevoker.revokeIdentity(userId);
      } catch {
        throw new ServiceError("INTERNAL", "failed to revoke account identity");
      }
    }

    const deleteAll = async () => {
      // 1. App-specific tables first
      if (this.appCleanup) {
        await this.appCleanup.deleteAppData(userId);
      }
      // 2. All donkeygo-managed tables
      await this.db.deleteUserData(userId);
      // 3. Delete user record last
      await this.db.deleteUser(userId);
    };

    try {
      if (this.db.withTransaction) {
        await this.db.withTransaction(deleteAll);
      } else {
        await deleteAll();
      }
    } catch {
      throw new ServiceError("INTERNAL", "failed to delete account");
    }

    // Callback (outside transaction — fire and forget)
    if (this.cfg.onDelete && email) this.cfg.onDelete(userId, email);

    return { status: "deleted", identityRevocation };
  }

  /** Anonymize a user account (remove PII but keep the record). */
  async anonymizeAccount(userId: string): Promise<{ status: string }> {
    try {
      await this.db.anonymizeUser(userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to anonymize account");
    }
    return { status: "anonymized" };
  }

  /** Export all user data. */
  async exportData(userId: string): Promise<UserDataExport> {
    let exportData: UserDataExport;
    try {
      exportData = await this.db.exportUserData(userId);
    } catch {
      throw new ServiceError("INTERNAL", "failed to export data");
    }

    if (this.appExport) {
      const appData = await this.appExport.exportAppData(userId).catch(() => null);
      if (appData) exportData.app_data = appData;
    }

    return exportData;
  }
}
