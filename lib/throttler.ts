function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PromiseThrottler {
  private readonly minIntervalMs: number;
  private nextAvailableAt = 0;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    // Synchronously calculate and reserve the next available start time
    const now = Date.now();
    const startAt = Math.max(now, this.nextAvailableAt);
    const waitMs = startAt - now;
    this.nextAvailableAt = startAt + this.minIntervalMs;

    // Each request waits independently for its reserved slot
    if (waitMs > 0) {
      return sleep(waitMs).then(task);
    }
    return Promise.resolve().then(task);
  }
}
