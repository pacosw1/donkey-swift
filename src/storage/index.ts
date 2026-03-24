// ── Storage Interface ────────────────────────────────────────────────────────

export interface StorageProvider {
  /** Whether storage is configured and ready. */
  configured(): boolean;
  /** Upload an object. */
  put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
  /** Download an object. */
  get(key: string): Promise<{ data: Uint8Array; contentType: string }>;
}

// ── Config (for reference — implement with S3, R2, GCS, etc.) ───────────────

export interface StorageConfig {
  region?: string;
  bucket: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// ── NoopProvider ────────────────────────────────────────────────────────────

export class NoopStorageProvider implements StorageProvider {
  configured(): boolean { return false; }
  async put(): Promise<void> { throw new Error("storage not configured"); }
  async get(): Promise<{ data: Uint8Array; contentType: string }> { throw new Error("storage not configured"); }
}
