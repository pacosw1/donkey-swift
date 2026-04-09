import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors/index.js";

// ── Storage Interface ────────────────────────────────────────────────────────

export interface StorageProvider {
  configured(): boolean;
  put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string }>;
}

export interface StoredObjectRef {
  key: string;
  contentType: string;
  sizeBytes: number;
}

export interface UploadObjectInput {
  keyPrefix: string;
  contentType: string;
  data: Buffer | Uint8Array;
  fileName?: string | null;
  allowedContentTypes?: string[];
  maxBytes?: number;
}

// ── Config ──────────────────────────────────────────────────────────────────

export interface StorageConfig {
  region?: string;
  bucket: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// ── S3-Compatible Client ────────────────────────────────────────────────────

export class StorageClient implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private _configured: boolean;

  constructor(cfg: StorageConfig) {
    this._configured = !!(cfg.bucket && cfg.accessKeyId);
    if (cfg.accessKeyId && !cfg.secretAccessKey) {
      throw new Error("storage: secretAccessKey is required when accessKeyId is provided");
    }
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region ?? "us-east-1",
      endpoint: cfg.endpoint,
      credentials: cfg.accessKeyId
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey! }
        : undefined,
      forcePathStyle: !!cfg.endpoint, // for S3-compatible services
    });
  }

  configured(): boolean {
    return this._configured;
  }

  async put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        Body: data,
      })
    );
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string }> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    const body = await result.Body!.transformToByteArray();
    return {
      data: new Uint8Array(body),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }
}

export class StorageUploadService {
  constructor(private storage: StorageProvider) {}

  async uploadObject(input: UploadObjectInput): Promise<StoredObjectRef> {
    if (!this.storage.configured()) {
      throw new ValidationError("storage not configured");
    }

    const contentType = input.contentType.trim().toLowerCase();
    if (!contentType) {
      throw new ValidationError("contentType is required");
    }

    const sizeBytes = input.data.byteLength;
    if (input.maxBytes !== undefined && sizeBytes > input.maxBytes) {
      throw new ValidationError(`file too large (max ${input.maxBytes} bytes)`);
    }

    if (input.allowedContentTypes?.length) {
      const allowed = input.allowedContentTypes.some((allowedType) =>
        matchesContentType(contentType, allowedType),
      );
      if (!allowed) {
        throw new ValidationError(`unsupported content type: ${contentType}`);
      }
    }

    const key = buildStorageObjectKey(input.keyPrefix, input.fileName, contentType);
    await this.storage.put(key, contentType, input.data);

    return {
      key,
      contentType,
      sizeBytes,
    };
  }
}

export function buildStorageObjectKey(
  keyPrefix: string,
  fileName: string | null | undefined,
  contentType: string,
): string {
  const prefix = sanitizeKeyPrefix(keyPrefix);
  const extension = detectExtension(contentType, fileName);
  const safeBaseName = sanitizeBaseName(fileName);
  const objectId = randomUUID();
  return `${prefix}/${safeBaseName}-${objectId}${extension}`;
}

function sanitizeKeyPrefix(value: string): string {
  const cleaned = value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "-"));

  if (!cleaned.length) {
    throw new ValidationError("keyPrefix is required");
  }

  return cleaned.join("/");
}

function sanitizeBaseName(fileName: string | null | undefined): string {
  const rawBaseName = fileName?.split("/").pop()?.split("\\").pop()?.replace(/\.[^.]+$/, "") || "upload";
  const cleaned = rawBaseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "upload";
}

function detectExtension(contentType: string, fileName: string | null | undefined): string {
  const fileExtension = fileName?.match(/(\.[a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (fileExtension) {
    return fileExtension;
  }

  switch (contentType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    default:
      return "";
  }
}

function matchesContentType(contentType: string, allowedType: string): boolean {
  const normalizedAllowedType = allowedType.trim().toLowerCase();
  if (!normalizedAllowedType) {
    return false;
  }

  if (normalizedAllowedType.endsWith("/*")) {
    const prefix = normalizedAllowedType.slice(0, -1);
    return contentType.startsWith(prefix);
  }

  return contentType === normalizedAllowedType;
}

// ── NoopProvider ────────────────────────────────────────────────────────────

export class NoopStorageProvider implements StorageProvider {
  configured(): boolean { return false; }
  async put(): Promise<void> { throw new Error("storage not configured"); }
  async get(): Promise<{ data: Uint8Array; contentType: string }> { throw new Error("storage not configured"); }
}
