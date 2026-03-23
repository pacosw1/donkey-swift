/** A background job that runs periodically. */
export interface Task {
  name: string;
  run: (signal: AbortSignal) => Promise<void>;
}

/** Wraps a function as a Task. */
export function funcTask(
  name: string,
  fn: (signal: AbortSignal) => Promise<void>
): Task {
  return { name, run: fn };
}

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
export class Scheduler {
  private intervalMs: number;
  private tasks: TaskConfig[];
  private ticks = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor(cfg: SchedulerConfig) {
    this.intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
    this.tasks = [...(cfg.tasks ?? [])];
  }

  /** Add a task after creation. Safe to call after start. */
  addTask(tc: TaskConfig): void {
    this.tasks.push(tc);
  }

  /** Number of completed ticks. */
  tickCount(): number {
    return this.ticks;
  }

  /** Start the scheduler loop. */
  start(): void {
    this.abortController = new AbortController();
    this.interval = setInterval(
      () => this.tick(this.abortController!.signal),
      this.intervalMs
    );
    console.log(`[scheduler] started with interval ${this.intervalMs}ms`);
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.abortController?.abort();
    this.interval = null;
    this.abortController = null;
    console.log("[scheduler] stopped");
  }

  private async tick(signal: AbortSignal): Promise<void> {
    this.ticks++;
    const tick = this.ticks;
    const tasks = [...this.tasks];

    for (const tc of tasks) {
      if (signal.aborted) return;

      const every = tc.every ?? 1;

      // On first tick, run if runFirst is set OR if it's a regular interval match.
      if (tick === 1 && tc.runFirst) {
        // always run
      } else if (tick % every !== 0) {
        continue;
      }

      const start = Date.now();
      try {
        await tc.task.run(signal);
        console.log(
          `[scheduler] task "${tc.task.name}" done in ${Date.now() - start}ms`
        );
      } catch (err) {
        console.log(`[scheduler] task "${tc.task.name}" error: ${err}`);
      }
    }
  }
}
