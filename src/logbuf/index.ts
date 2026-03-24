/** Ring-buffer log capture for admin panels. */
export class LogBuffer {
  private lines: string[];
  private pos = 0;
  private full = false;

  constructor(private capacity: number) {
    this.lines = new Array(capacity).fill("");
  }

  /** Write log text to the buffer. */
  write(text: string): void {
    for (const line of text.trimEnd().split("\n")) {
      if (!line) continue;
      this.lines[this.pos] = line;
      this.pos = (this.pos + 1) % this.capacity;
      if (this.pos === 0) this.full = true;
    }
  }

  /** Return the last n lines from the buffer. */
  getLines(n?: number): string[] {
    const total = this.full ? this.capacity : this.pos;
    if (!n || n <= 0 || n > total) n = total;

    const result: string[] = [];
    if (this.full) {
      const start = ((this.pos - n) % this.capacity + this.capacity) % this.capacity;
      for (let i = 0; i < n; i++) {
        result.push(this.lines[(start + i) % this.capacity]);
      }
    } else {
      const start = Math.max(0, this.pos - n);
      for (let i = start; i < this.pos; i++) {
        result.push(this.lines[i]);
      }
    }
    return result;
  }

  /** Query logs with optional limit and filter. */
  queryLogs(opts?: { limit?: number; filter?: string }): { lines: string[]; count: number } {
    const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 5000);
    let lines = this.getLines(limit);
    if (opts?.filter) {
      const f = opts.filter.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(f));
    }
    return { lines, count: lines.length };
  }
}

/**
 * Intercept console.log to also capture into the LogBuffer.
 * Returns a restore function.
 */
export function setupLogCapture(buf: LogBuffer): () => void {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    buf.write(msg);
    originalLog.apply(console, args);
  };
  return () => {
    console.log = originalLog;
  };
}
