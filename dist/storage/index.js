import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
//# sourceMappingURL=index.js.map