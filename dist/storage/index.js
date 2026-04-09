import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors/index.js";
// ── S3-Compatible Client ────────────────────────────────────────────────────
export class StorageClient {
    client;
    bucket;
    _configured;
    constructor(cfg) {
        this._configured = !!(cfg.bucket && cfg.accessKeyId);
        if (cfg.accessKeyId && !cfg.secretAccessKey) {
            throw new Error("storage: secretAccessKey is required when accessKeyId is provided");
        }
        this.bucket = cfg.bucket;
        this.client = new S3Client({
            region: cfg.region ?? "us-east-1",
            endpoint: cfg.endpoint,
            credentials: cfg.accessKeyId
                ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
                : undefined,
            forcePathStyle: !!cfg.endpoint, // for S3-compatible services
        });
    }
    configured() {
        return this._configured;
    }
    async put(key, contentType, data) {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
            Body: data,
        }));
    }
    async get(key) {
        const result = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
        const body = await result.Body.transformToByteArray();
        return {
            data: new Uint8Array(body),
            contentType: result.ContentType ?? "application/octet-stream",
        };
    }
}
export class StorageUploadService {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    async uploadObject(input) {
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
            const allowed = input.allowedContentTypes.some((allowedType) => matchesContentType(contentType, allowedType));
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
export function buildStorageObjectKey(keyPrefix, fileName, contentType) {
    const prefix = sanitizeKeyPrefix(keyPrefix);
    const extension = detectExtension(contentType, fileName);
    const safeBaseName = sanitizeBaseName(fileName);
    const objectId = randomUUID();
    return `${prefix}/${safeBaseName}-${objectId}${extension}`;
}
function sanitizeKeyPrefix(value) {
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
function sanitizeBaseName(fileName) {
    const rawBaseName = fileName?.split("/").pop()?.split("\\").pop()?.replace(/\.[^.]+$/, "") || "upload";
    const cleaned = rawBaseName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return cleaned || "upload";
}
function detectExtension(contentType, fileName) {
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
function matchesContentType(contentType, allowedType) {
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
export class NoopStorageProvider {
    configured() { return false; }
    async put() { throw new Error("storage not configured"); }
    async get() { throw new Error("storage not configured"); }
}
//# sourceMappingURL=index.js.map