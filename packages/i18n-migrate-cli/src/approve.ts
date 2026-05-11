import type { ApproveOptions, ApproveResult, TranslationEntry } from './types'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile, writeJsonFile } from './fs-utils'
import { findMapPaths } from './map-paths'
import { createMapFile } from './mapping'
import { mapPathToSourcePath } from './paths'

export async function approveTranslations(options: ApproveOptions = {}): Promise<ApproveResult> {
  const cwd = options.cwd ?? process.cwd()
  const mapPaths = await findMapPaths(cwd, options.path)
  const files: ApproveResult['files'] = []
  options.onProgress?.({ phase: 'prepare', message: options.dryRun ? 'Preparing approval preview' : 'Preparing to approve map entries' })
  options.onProgress?.({ phase: 'discover', message: `Found ${mapPaths.length} map file(s)`, total: mapPaths.length })

  for (const [index, mapPath] of mapPaths.entries()) {
    options.onProgress?.({
      phase: 'file',
      path: mapPathToSourcePath(mapPath),
      current: index + 1,
      total: mapPaths.length,
      action: 'approve',
      dryRun: options.dryRun,
    })
    const absolutePath = path.join(cwd, mapPath)
    const mapFile = await readJsonFile(absolutePath, createMapFile())
    let approved = 0
    let alreadyApproved = 0
    let skipped = 0

    for (const entry of Object.values(mapFile.entries)) {
      if (!isApprovableEntry(entry, options)) {
        skipped += 1
        continue
      }
      if (entry.approved) {
        alreadyApproved += 1
        continue
      }
      entry.approved = true
      approved += 1
    }

    const changed = approved > 0
    if (changed && !options.dryRun) {
      await writeJsonFile(absolutePath, mapFile)
      options.onProgress?.({
        phase: 'write',
        path: mapPathToSourcePath(mapPath),
        current: index + 1,
        total: mapPaths.length,
        action: 'approve',
      })
    }

    files.push({
      sourcePath: mapPathToSourcePath(mapPath),
      mapPath,
      changed,
      approved,
      alreadyApproved,
      skipped,
      total: Object.keys(mapFile.entries).length,
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Approve finished' })
  return { files, dryRun: options.dryRun === true }
}

function isApprovableEntry(entry: TranslationEntry, options: ApproveOptions): boolean {
  if (!options.includeSkipped && entry.skip)
    return false
  if (!options.includeDeprecated && entry.deprecated)
    return false
  if (!options.allowEmpty && !entry.translation)
    return false
  return true
}
