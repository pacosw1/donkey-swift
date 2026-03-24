/** Result of a push send attempt. */
export interface PushResult {
    success: boolean;
    /** APNs error reason if failed (e.g. "BadDeviceToken", "Unregistered"). */
    reason?: string;
    statusCode?: number;
}
/** Callback invoked when a device token is invalid. Use to disable the token in your DB. */
export type BadTokenHandler = (deviceToken: string, reason: string) => void;
export interface PushProvider {
    send(deviceToken: string, title: string, body: string): Promise<void>;
    sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
    sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
    /** Send a rich notification with full APNs payload control. */
    sendRich?(deviceToken: string, payload: APNsPayload): Promise<PushResult>;
}
export interface APNsAlert {
    title: string;
    subtitle?: string;
    body: string;
    /** Localization key for the title. */
    "title-loc-key"?: string;
    "title-loc-args"?: string[];
    "loc-key"?: string;
    "loc-args"?: string[];
    "launch-image"?: string;
}
export interface APNsSound {
    /** Default: "default". Set to a filename in the app bundle. */
    name?: string;
    critical?: 0 | 1;
    volume?: number;
}
export interface APNsAps {
    alert?: APNsAlert | string;
    badge?: number;
    sound?: string | APNsSound;
    /** Set to 1 to enable background fetch. */
    "content-available"?: number;
    /** Set to 1 to enable notification service extension (for rich media). */
    "mutable-content"?: number;
    /** Notification category for actionable notifications. */
    category?: string;
    /** Thread ID for notification grouping. */
    "thread-id"?: string;
    /** URL to media attachment (processed by notification service extension). */
    "target-content-id"?: string;
    /** Interruption level: passive, active (default), time-sensitive, critical. */
    "interruption-level"?: "passive" | "active" | "time-sensitive" | "critical";
    /** Relevance score 0-1 for notification summary ranking. */
    "relevance-score"?: number;
    /** Filter criteria for notification filtering. */
    "filter-criteria"?: string;
    /** Stale date for time-sensitive notifications. */
    "stale-date"?: number;
    /** Timestamp for Live Activities. */
    "timestamp"?: number;
    /** Event type for Live Activities (update, end). */
    "event"?: string;
    /** Content state for Live Activities. */
    "content-state"?: Record<string, unknown>;
    /** Dismissal date for Live Activities. */
    "dismissal-date"?: number;
}
export interface APNsPayload {
    aps: APNsAps;
    /** Custom data merged into the top-level payload. Keys must not conflict with "aps". */
    [key: string]: unknown;
}
export interface APNsHeaders {
    /** Push type: alert, background, voip, complication, fileprovider, mdm, liveactivity. */
    pushType?: string;
    /** Priority: "10" for immediate, "5" for power-saving, "1" for background. */
    priority?: string;
    /** Expiration timestamp (0 = deliver now or not at all). */
    expiration?: string;
    /** Collapse ID for coalescing notifications. */
    collapseId?: string;
    /** Override the APNs topic (default: bundle ID from config). */
    topic?: string;
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
    /** Called when APNs reports a bad device token. Use to disable the token in your DB. */
    onBadToken?: BadTokenHandler;
}
/** Creates a push provider. Returns APNs if keyPath is set, LogProvider otherwise. */
export declare function newProvider(cfg: PushConfig): Promise<PushProvider>;
/** Build an alert payload with optional rich features. */
export declare function alertPayload(opts: {
    title: string;
    body: string;
    subtitle?: string;
    badge?: number;
    sound?: string;
    category?: string;
    threadId?: string;
    interruptionLevel?: "passive" | "active" | "time-sensitive" | "critical";
    relevanceScore?: number;
    /** Set true to enable notification service extension (for image/media attachments). */
    mutableContent?: boolean;
    data?: Record<string, string>;
}): APNsPayload;
/** Build a critical alert payload (requires Apple entitlement). */
export declare function criticalAlertPayload(opts: {
    title: string;
    body: string;
    soundName?: string;
    volume?: number;
    data?: Record<string, string>;
}): APNsPayload;
/** Build a Live Activity push update payload. */
export declare function liveActivityPayload(opts: {
    event: "update" | "end";
    contentState: Record<string, unknown>;
    timestamp: number;
    dismissalDate?: number;
    alert?: {
        title: string;
        body: string;
    };
    sound?: string;
}): APNsPayload;
export declare class LogProvider implements PushProvider {
    send(deviceToken: string, title: string, body: string): Promise<void>;
    sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
    sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
    sendRich(deviceToken: string, payload: APNsPayload): Promise<PushResult>;
}
export declare class NoopProvider implements PushProvider {
    send(): Promise<void>;
    sendWithData(): Promise<void>;
    sendSilent(): Promise<void>;
    sendRich(): Promise<PushResult>;
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
    private _connectingPromise;
    private onBadToken?;
    private constructor();
    static create(cfg: PushConfig): Promise<APNsProvider>;
    private getToken;
    /** Close the HTTP/2 connection. Call on shutdown. */
    close(): void;
    send(deviceToken: string, title: string, body: string): Promise<void>;
    sendWithData(deviceToken: string, title: string, body: string, data: Record<string, string>): Promise<void>;
    sendSilent(deviceToken: string, data: Record<string, string>): Promise<void>;
    sendRich(deviceToken: string, payload: APNsPayload, headers?: APNsHeaders): Promise<PushResult>;
    /** Get or create H2 client, deduplicated across concurrent callers. */
    private getH2Client;
}
//# sourceMappingURL=index.d.ts.map