/**
 * In-memory LRU cache for translation results.
 */
export class TranslationResultCache {
  private cache = new Map<string, { result: string, timestamp: number }>()
  private maxSize: number
  private ttl: number

  constructor(maxSize = 1000, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize
    this.ttl = ttlMs
  }

  private makeKey(text: string, from: string, to: string): string {
    return `${from}:${to}:${text}`
  }

  get(text: string, from: string, to: string): string | null {
    const key = this.makeKey(text, from, to)
    const entry = this.cache.get(key)
    if (!entry)
      return null

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.result
  }

  set(text: string, from: string, to: string, result: string): void {
    const key = this.makeKey(text, from, to)

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }
}
