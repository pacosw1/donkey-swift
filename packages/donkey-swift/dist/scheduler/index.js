/** Wraps a function as a Task. */
export function funcTask(name, fn) {
    return { name, run: fn };
}
/** Runs tasks periodically using setInterval. */
export class Scheduler {
    intervalMs;
    tasks;
    ticks = 0;
    interval = null;
    abortController = null;
    constructor(cfg) {
        this.intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
        this.tasks = [...(cfg.tasks ?? [])];
    }
    /** Add a task after creation. Safe to call after start. */
    addTask(tc) {
        this.tasks.push(tc);
    }
    /** Number of completed ticks. */
    tickCount() {
        return this.ticks;
    }
    /** Start the scheduler loop. */
    start() {
        this.abortController = new AbortController();
        this.interval = setInterval(() => this.tick(this.abortController.signal), this.intervalMs);
        console.log(`[scheduler] started with interval ${this.intervalMs}ms`);
    }
    /** Stop the scheduler. */
    stop() {
        if (this.interval)
            clearInterval(this.interval);
        this.abortController?.abort();
        this.interval = null;
        this.abortController = null;
        console.log("[scheduler] stopped");
    }
    async tick(signal) {
        this.ticks++;
        const tick = this.ticks;
        const tasks = [...this.tasks];
        for (const tc of tasks) {
            if (signal.aborted)
                return;
            const every = tc.every ?? 1;
            // On first tick, run if runFirst is set OR if it's a regular interval match.
            if (tick === 1 && tc.runFirst) {
                // always run
            }
            else if (tick % every !== 0) {
                continue;
            }
            const start = Date.now();
            try {
                await tc.task.run(signal);
                console.log(`[scheduler] task "${tc.task.name}" done in ${Date.now() - start}ms`);
            }
            catch (err) {
                console.log(`[scheduler] task "${tc.task.name}" error: ${err}`);
            }
        }
    }
}
//# sourceMappingURL=index.js.map