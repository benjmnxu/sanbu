interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LruTtlCache<K, V> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private map = new Map<K, CacheEntry<V>>();

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const existing = this.map.get(key);
    if (!existing) {
      return undefined;
    }

    if (existing.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, existing);
    return existing.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });

    this.evictExpired();
    this.evictOverflow();
  }

  private evictExpired(): void {
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= Date.now()) {
        this.map.delete(key);
      }
    }
  }

  private evictOverflow(): void {
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.map.delete(oldestKey);
    }
  }
}
