export interface StorageProvider {
    configured(): boolean;
    put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
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
export interface StorageConfig {
    region?: string;
    bucket: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
}
export declare class StorageClient implements StorageProvider {
    private client;
    private bucket;
    private _configured;
    constructor(cfg: StorageConfig);
    configured(): boolean;
    put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
}
export declare class StorageUploadService {
    private storage;
    constructor(storage: StorageProvider);
    uploadObject(input: UploadObjectInput): Promise<StoredObjectRef>;
}
export declare function buildStorageObjectKey(keyPrefix: string, fileName: string | null | undefined, contentType: string): string;
export declare class NoopStorageProvider implements StorageProvider {
    configured(): boolean;
    put(): Promise<void>;
    get(): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
}
//# sourceMappingURL=index.d.ts.map