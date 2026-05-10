import type { ScanMeta } from './types'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile, writeJsonFile } from './fs-utils'

export async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

export async function loadScanMeta(cwd = process.cwd()): Promise<ScanMeta> {
  return readJsonFile<ScanMeta>(path.join(cwd, '.tmigrate', 'cache', 'scan-meta.json'), {})
}

export async function saveScanMeta(cwd: string, meta: ScanMeta): Promise<void> {
  await writeJsonFile(path.join(cwd, '.tmigrate', 'cache', 'scan-meta.json'), meta)
}
