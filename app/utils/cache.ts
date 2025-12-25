/**
 * Advanced Caching Utility
 * Provides intelligent caching with TTL, LRU eviction, and persistence
 */

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of entries
  persistent?: boolean; // Whether to persist to localStorage
  onEvict?: (key: string, value: unknown) => void;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

export class Cache<T = unknown> {
  private cache: Map<string, CacheEntry<T>>;
  private options: Required<CacheOptions>;
  private storageKey: string;

  constructor(
    name: string,
    options: CacheOptions = {},
  ) {
    this.storageKey = `bolt_cache_${name}`;
    this.options = {
      ttl: options.ttl ?? 3600000, // 1 hour default
      maxSize: options.maxSize ?? 100,
      persistent: options.persistent ?? false,
      onEvict: options.onEvict ?? (() => {}),
    };

    this.cache = new Map();
    
    if (this.options.persistent) {
      this.loadFromStorage();
    }
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T): void {
    // Check if we need to evict entries
    if (this.cache.size >= this.options.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.cache.set(key, entry);

    if (this.options.persistent) {
      this.saveToStorage();
    }
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.delete(key);
      return undefined;
    }

    // Update access metadata
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.value;
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (entry) {
      this.options.onEvict(key, entry.value);
    }

    const result = this.cache.delete(key);

    if (this.options.persistent) {
      this.saveToStorage();
    }

    return result;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.forEach((entry, key) => {
      this.options.onEvict(key, entry.value);
    });

    this.cache.clear();

    if (this.options.persistent) {
      this.saveToStorage();
    }
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    entries: Array<{
      key: string;
      age: number;
      accessCount: number;
      lastAccessed: number;
    }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: Date.now() - entry.timestamp,
      accessCount: entry.accessCount,
      lastAccessed: entry.lastAccessed,
    }));

    const totalAccesses = entries.reduce((sum, e) => sum + e.accessCount, 0);
    const hitRate = totalAccesses > 0 ? totalAccesses / entries.length : 0;

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hitRate,
      entries,
    };
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.options.ttl) {
        this.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > this.options.ttl;
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const data = Array.from(this.cache.entries());
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save cache to storage:', error);
    }
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const data = localStorage.getItem(this.storageKey);
      
      if (data) {
        const entries = JSON.parse(data) as Array<[string, CacheEntry<T>]>;
        
        for (const [key, entry] of entries) {
          // Only load non-expired entries
          if (!this.isExpired(entry)) {
            this.cache.set(key, entry);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load cache from storage:', error);
    }
  }
}

// Create commonly used cache instances
export const apiCache = new Cache('api', {
  ttl: 300000, // 5 minutes
  maxSize: 50,
});

export const fileCache = new Cache('files', {
  ttl: 600000, // 10 minutes
  maxSize: 100,
});

export const cognitiveCache = new Cache('cognitive', {
  ttl: 1800000, // 30 minutes
  maxSize: 200,
  persistent: true,
});

/**
 * Memoization decorator for caching function results
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  options: CacheOptions = {},
): T {
  const cache = new Cache<ReturnType<T>>('memoize', options);

  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = fn(...args);
    cache.set(key, result);
    
    return result;
  }) as T;
}
