import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

export interface StorageConfig {
  region?: string;
  bucket: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class StorageClient {
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
