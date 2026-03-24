import type { Context } from "hono";
/** Ring-buffer log capture for admin panels. */
export declare class LogBuffer {
    private capacity;
    private lines;
    private pos;
    private full;
    constructor(capacity: number);
    /** Write log text to the buffer. */
    write(text: string): void;
    /** Return the last n lines from the buffer. */
    getLines(n?: number): string[];
}
/**
 * Intercept console.log to also capture into the LogBuffer.
 * Returns a restore function.
 */
export declare function setupLogCapture(buf: LogBuffer): () => void;
/** Returns a Hono handler that serves buffered log lines. ?limit=500&filter=error */
export declare function handleAdminLogs(buf: LogBuffer): (c: Context) => Promise<Response & import("hono").TypedResponse<{
    lines: string[];
    count: number;
}, import("hono/utils/http-status").ContentfulStatusCode, "json">>;
//# sourceMappingURL=index.d.ts.map