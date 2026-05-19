// src/memory/l1_cache.ts

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class L1Cache<K, V> {
  private cache: Map<K, CacheEntry<V>> = new Map();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 50, ttlMs = 60000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  public get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh insertion order for LRU (move to end)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  public set(key: K, value: V, customTtlMs?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry (first item in Map insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const ttl = customTtlMs ?? this.ttlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  public delete(key: K): void {
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}
