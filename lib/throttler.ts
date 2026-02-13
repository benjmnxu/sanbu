function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PromiseThrottler {
  private readonly minIntervalMs: number;
  private lastStartedAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const now = Date.now();
      const elapsed = now - this.lastStartedAt;
      const waitMs = Math.max(0, this.minIntervalMs - elapsed);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.lastStartedAt = Date.now();
      return task();
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
