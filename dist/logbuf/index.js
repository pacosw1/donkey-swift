/** Ring-buffer log capture for admin panels. */
export class LogBuffer {
    capacity;
    lines;
    pos = 0;
    full = false;
    constructor(capacity) {
        this.capacity = capacity;
        this.lines = new Array(capacity).fill("");
    }
    /** Write log text to the buffer. */
    write(text) {
        for (const line of text.trimEnd().split("\n")) {
            if (!line)
                continue;
            this.lines[this.pos] = line;
            this.pos = (this.pos + 1) % this.capacity;
            if (this.pos === 0)
                this.full = true;
        }
    }
    /** Return the last n lines from the buffer. */
    getLines(n) {
        const total = this.full ? this.capacity : this.pos;
        if (!n || n <= 0 || n > total)
            n = total;
        const result = [];
        if (this.full) {
            const start = ((this.pos - n) % this.capacity + this.capacity) % this.capacity;
            for (let i = 0; i < n; i++) {
                result.push(this.lines[(start + i) % this.capacity]);
            }
        }
        else {
            const start = Math.max(0, this.pos - n);
            for (let i = start; i < this.pos; i++) {
                result.push(this.lines[i]);
            }
        }
        return result;
    }
}
/**
 * Intercept console.log to also capture into the LogBuffer.
 * Returns a restore function.
 */
export function setupLogCapture(buf) {
    const originalLog = console.log;
    console.log = (...args) => {
        const msg = args.map(String).join(" ");
        buf.write(msg);
        originalLog.apply(console, args);
    };
    return () => {
        console.log = originalLog;
    };
}
/** Returns a Hono handler that serves buffered log lines. ?limit=500&filter=error */
export function handleAdminLogs(buf) {
    return async (c) => {
        let limit = 500;
        const limitParam = c.req.query("limit");
        if (limitParam) {
            const parsed = parseInt(limitParam, 10);
            if (parsed > 0 && parsed <= 5000)
                limit = parsed;
        }
        const filter = c.req.query("filter")?.toLowerCase();
        let lines = buf.getLines(limit);
        if (filter) {
            lines = lines.filter((l) => l.toLowerCase().includes(filter));
        }
        return c.json({ lines, count: lines.length });
    };
}
//# sourceMappingURL=index.js.map