export interface PushProvider {
    send(deviceToken: string, title: string, body: string): Promise<void>;
    sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
    sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
}
export interface PushConfig {
    /** Path to .p8 key file. */
    keyPath?: string;
    keyId: string;
    teamId: string;
    /** Bundle ID. */
    topic: string;
    /** "sandbox" or "production". */
    environment?: "sandbox" | "production";
}
/** Creates a push provider. Returns APNs if keyPath is set, LogProvider otherwise. */
export declare function newProvider(cfg: PushConfig): Promise<PushProvider>;
export declare class LogProvider implements PushProvider {
    send(deviceToken: string, title: string, body: string): Promise<void>;
    sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
    sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
}
export declare class NoopProvider implements PushProvider {
    send(): Promise<void>;
    sendWithData(): Promise<void>;
    sendSilent(): Promise<void>;
}
export declare class APNsProvider implements PushProvider {
    private key;
    private keyId;
    private teamId;
    private topic;
    private baseUrl;
    private cachedToken;
    private tokenExpiry;
    private _h2client;
    private constructor();
    static create(cfg: PushConfig): Promise<APNsProvider>;
    private getToken;
    send(deviceToken: string, title: string, body: string): Promise<void>;
    sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
    sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
    private getH2Client;
    private sendPayload;
}
//# sourceMappingURL=index.d.ts.map