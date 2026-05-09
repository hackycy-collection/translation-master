import type { CacheAdapter } from '@translation-master/core'

const CACHE_VERSION_KEY = 'translation-master:cache-version'

/**
 * Default CacheAdapter using the browser Cache API.
 * Supports version-based cache invalidation.
 */
export class BrowserCacheAdapter implements CacheAdapter {
  private cacheName: string
  private version: string

  constructor(cacheName = 'translator-models', version = '1') {
    this.cacheName = cacheName
    this.version = version
  }

  private async getCache(): Promise<Cache | undefined> {
    if (typeof caches === 'undefined')
      return undefined
    await this.checkVersion()
    return caches.open(this.cacheName)
  }

  private async checkVersion(): Promise<void> {
    if (typeof localStorage === 'undefined')
      return
    const stored = localStorage.getItem(CACHE_VERSION_KEY)
    if (stored !== this.version) {
      await this.clear()
      localStorage.setItem(CACHE_VERSION_KEY, this.version)
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const cache = await this.getCache()
    if (!cache)
      return null
    const response = await cache.match(key)
    if (!response)
      return null
    return response.arrayBuffer()
  }

  async set(key: string, data: ArrayBuffer): Promise<void> {
    const cache = await this.getCache()
    if (!cache)
      return
    await cache.put(key, new Response(data))
  }

  async has(key: string): Promise<boolean> {
    const cache = await this.getCache()
    if (!cache)
      return false
    const response = await cache.match(key)
    return response !== undefined
  }

  async delete(key: string): Promise<void> {
    const cache = await this.getCache()
    if (!cache)
      return
    await cache.delete(key)
  }

  async clear(): Promise<void> {
    if (typeof caches === 'undefined')
      return
    await caches.delete(this.cacheName)
  }
}
