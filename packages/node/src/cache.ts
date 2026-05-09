import type { CacheAdapter } from '@translation-master/core'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * File-system based CacheAdapter for Node.js.
 * Stores cached model data as files in a directory.
 */
export class FileCacheAdapter implements CacheAdapter {
  private cacheDir: string

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }
  }

  private getFilePath(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex')
    return join(this.cacheDir, `${hash}.cache`)
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const filePath = this.getFilePath(key)
    if (!existsSync(filePath))
      return null
    try {
      const buffer = readFileSync(filePath)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
    catch {
      return null
    }
  }

  async set(key: string, data: ArrayBuffer): Promise<void> {
    const filePath = this.getFilePath(key)
    writeFileSync(filePath, Buffer.from(data))
  }

  async has(key: string): Promise<boolean> {
    return existsSync(this.getFilePath(key))
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key)
    if (existsSync(filePath)) {
      rmSync(filePath)
    }
  }

  async clear(): Promise<void> {
    if (!existsSync(this.cacheDir))
      return
    const files = readdirSync(this.cacheDir)
    for (const file of files) {
      if (file.endsWith('.cache')) {
        rmSync(join(this.cacheDir, file))
      }
    }
  }
}
