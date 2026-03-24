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
    /** Query logs with optional limit and filter. */
    queryLogs(opts?: {
        limit?: number;
        filter?: string;
    }): {
        lines: string[];
        count: number;
    };
}
/**
 * Intercept console.log to also capture into the LogBuffer.
 * Returns a restore function.
 */
export declare function setupLogCapture(buf: LogBuffer): () => void;
//# sourceMappingURL=index.d.ts.map