export interface StorageConfig {
    region?: string;
    bucket: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
}
export declare class StorageClient {
    private client;
    private bucket;
    private _configured;
    constructor(cfg: StorageConfig);
    configured(): boolean;
    put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
    get(key: string): Promise<{
        data: Buffer;
        contentType: string;
    }>;
}
//# sourceMappingURL=index.d.ts.map