/** A background job that runs periodically. */
export interface Task {
    name: string;
    run: (signal: AbortSignal) => Promise<void>;
}
/** Wraps a function as a Task. */
export declare function funcTask(name: string, fn: (signal: AbortSignal) => Promise<void>): Task;
/** Scheduling options for a task. */
export interface TaskConfig {
    task: Task;
    /** Run every N ticks (1 = every tick, 96 = daily at 15min intervals). */
    every?: number;
    /** Run immediately on first tick. */
    runFirst?: boolean;
}
export interface SchedulerConfig {
    /** Tick interval in milliseconds (default: 15 minutes). */
    intervalMs?: number;
    tasks?: TaskConfig[];
}
/** Runs tasks periodically using setInterval. */
export declare class Scheduler {
    private intervalMs;
    private tasks;
    private ticks;
    private interval;
    private abortController;
    constructor(cfg: SchedulerConfig);
    /** Add a task after creation. Safe to call after start. */
    addTask(tc: TaskConfig): void;
    /** Number of completed ticks. */
    tickCount(): number;
    /** Start the scheduler loop. */
    start(): void;
    /** Stop the scheduler. */
    stop(): void;
    private tick;
}
//# sourceMappingURL=index.d.ts.map