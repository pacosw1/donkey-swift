import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler, funcTask } from "../scheduler/index.js";

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs task on each interval tick", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const s = new Scheduler({
      intervalMs: 1000,
      tasks: [{ task: funcTask("test", fn) }],
    });

    s.start();
    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    s.stop();
  });

  it("every=N skips ticks that are not multiples of N", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const s = new Scheduler({
      intervalMs: 100,
      tasks: [{ task: funcTask("periodic", fn), every: 3 }],
    });

    s.start();

    // Tick 1: 3 % 1 != 0, skip
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(0);

    // Tick 2: skip
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(0);

    // Tick 3: 3 % 3 == 0, run
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);

    // Tick 4, 5: skip
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);

    // Tick 6: run
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    s.stop();
  });

  it("runFirst runs task immediately on first tick", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const s = new Scheduler({
      intervalMs: 1000,
      tasks: [{ task: funcTask("eager", fn), every: 10, runFirst: true }],
    });

    s.start();

    // Tick 1: runFirst should trigger even though every=10
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Ticks 2-9: skip
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fn).toHaveBeenCalledTimes(1);

    // Tick 10: run
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    s.stop();
  });

  it("tracks tick count", async () => {
    const s = new Scheduler({ intervalMs: 100, tasks: [] });
    s.start();
    expect(s.tickCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(s.tickCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(s.tickCount()).toBe(3);

    s.stop();
  });

  it("handles task errors gracefully", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const passing = vi.fn().mockResolvedValue(undefined);
    const s = new Scheduler({
      intervalMs: 100,
      tasks: [
        { task: funcTask("fail", failing) },
        { task: funcTask("pass", passing) },
      ],
    });

    s.start();
    await vi.advanceTimersByTimeAsync(100);

    // Both should have been called despite the first one failing
    expect(failing).toHaveBeenCalledTimes(1);
    expect(passing).toHaveBeenCalledTimes(1);

    s.stop();
  });
});
