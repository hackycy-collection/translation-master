import type { BackupMeta, BackupMetaEntry } from './types'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile, writeJsonFile } from './fs-utils'
import { toPosixPath } from './paths'

const EMPTY_BACKUP_META: BackupMeta = {
  version: 1,
  backups: {},
}

export async function loadBackupMeta(cwd = process.cwd()): Promise<BackupMeta> {
  return readJsonFile<BackupMeta>(path.join(cwd, '.tmigrate', 'backups', 'backup-meta.json'), EMPTY_BACKUP_META)
}

export async function saveBackupMeta(cwd: string, meta: BackupMeta): Promise<void> {
  await writeJsonFile(path.join(cwd, '.tmigrate', 'backups', 'backup-meta.json'), meta)
}

export async function backupFile(cwd: string, sourcePath: string, batchId: string): Promise<BackupMetaEntry> {
  const normalized = toPosixPath(sourcePath)
  const backupPath = toPosixPath(path.join('.tmigrate', 'backups', normalized))
  await mkdir(path.dirname(path.join(cwd, backupPath)), { recursive: true })
  await copyFile(path.join(cwd, normalized), path.join(cwd, backupPath))
  const entry: BackupMetaEntry = {
    sourcePath: normalized,
    backupPath,
    backedUpAt: new Date().toISOString(),
    batchId,
  }
  const meta = await loadBackupMeta(cwd)
  meta.backups[normalized] = entry
  await saveBackupMeta(cwd, meta)
  return entry
}

export function listBackupEntries(meta: BackupMeta, targetPath?: string): BackupMetaEntry[] {
  const normalizedTarget = targetPath ? toPosixPath(targetPath).replace(/\/$/, '') : undefined
  return Object.values(meta.backups)
    .filter(entry => !normalizedTarget || entry.sourcePath === normalizedTarget || entry.sourcePath.startsWith(`${normalizedTarget}/`))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
}
