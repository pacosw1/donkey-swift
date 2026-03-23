import type { Context } from "hono";

// ── Types & Interfaces ──────────────────────────────────────────────────────

export interface AccountDB {
  getUserEmail(userId: string): Promise<string>;
  deleteUserData(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  anonymizeUser(userId: string): Promise<void>;
  exportUserData(userId: string): Promise<UserDataExport>;
}

export interface AppCleanup {
  deleteAppData(userId: string): Promise<void>;
}

export interface AppExporter {
  exportAppData(userId: string): Promise<unknown>;
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

  constructor(
    private cfg: AccountConfig,
    private db: AccountDB,
    ...opts: unknown[]
  ) {
    for (const opt of opts) {
      if (opt && typeof (opt as AppCleanup).deleteAppData === "function") this.appCleanup = opt as AppCleanup;
      if (opt && typeof (opt as AppExporter).exportAppData === "function") this.appExport = opt as AppExporter;
    }
  }

  /** DELETE /api/v1/account */
  handleDeleteAccount = async (c: Context) => {
    const userId = c.get("userId") as string;
    const email = await this.db.getUserEmail(userId).catch(() => "");

    // 1. App-specific tables first
    if (this.appCleanup) {
      try { await this.appCleanup.deleteAppData(userId); }
      catch { return c.json({ error: "failed to delete app data" }, 500); }
    }

    // 2. All donkeygo-managed tables
    try { await this.db.deleteUserData(userId); }
    catch { return c.json({ error: "failed to delete user data" }, 500); }

    // 3. Delete user record last
    try { await this.db.deleteUser(userId); }
    catch { return c.json({ error: "failed to delete user" }, 500); }

    // 4. Callback
    if (this.cfg.onDelete && email) this.cfg.onDelete(userId, email);

    return c.json({ status: "deleted" });
  };

  /** POST /api/v1/account/anonymize */
  handleAnonymizeAccount = async (c: Context) => {
    const userId = c.get("userId") as string;
    try {
      await this.db.anonymizeUser(userId);
    } catch {
      return c.json({ error: "failed to anonymize account" }, 500);
    }
    return c.json({ status: "anonymized" });
  };

  /** GET /api/v1/account/export */
  handleExportData = async (c: Context) => {
    const userId = c.get("userId") as string;

    let exportData: UserDataExport;
    try {
      exportData = await this.db.exportUserData(userId);
    } catch {
      return c.json({ error: "failed to export data" }, 500);
    }

    if (this.appExport) {
      const appData = await this.appExport.exportAppData(userId).catch(() => null);
      if (appData) exportData.app_data = appData;
    }

    c.header("Content-Disposition", "attachment; filename=account-data.json");
    return c.json(exportData);
  };
}
