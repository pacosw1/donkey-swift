export interface StorageProvider {
    /** Whether storage is configured and ready. */
    configured(): boolean;
    /** Upload an object. */
    put(key: string, contentType: string, data: Buffer | Uint8Array): Promise<void>;
    /** Download an object. */
    get(key: string): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
}
export interface StorageConfig {
    region?: string;
    bucket: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
}
export declare class NoopStorageProvider implements StorageProvider {
    configured(): boolean;
    put(): Promise<void>;
    get(): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
}
//# sourceMappingURL=index.d.ts.map