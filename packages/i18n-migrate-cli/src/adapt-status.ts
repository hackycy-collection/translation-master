import type { MapAdaptMeta, MapFile, TranslationEntry } from './types'

export interface AdaptExecutionStats {
  applied: number
  skipped: number
  changed: boolean
}

export function readyAdaptEntryRefs(mapFile: Pick<MapFile, 'entries'>): string[] {
  return Object.values(mapFile.entries)
    .filter(isReadyForAdapt)
    .map(entry => `${entry.id}:${entry.key ?? ''}`)
    .sort()
}

export function hasReadyAdaptEntries(mapFile: Pick<MapFile, 'entries'>): boolean {
  return readyAdaptEntryRefs(mapFile).length > 0
}

export function isMapAdapted(mapFile: MapFile): boolean {
  const refs = readyAdaptEntryRefs(mapFile)
  if (refs.length === 0 || !mapFile.adapt?.adaptedAt)
    return false

  return sameRefs(mapFile.adapt.entryRefs, refs)
}

export function createMapAdaptMeta(
  mapFile: Pick<MapFile, 'entries'>,
  stats: AdaptExecutionStats,
  now = new Date(),
): MapAdaptMeta {
  return {
    adaptedAt: now.toISOString(),
    entryRefs: readyAdaptEntryRefs(mapFile),
    applied: stats.applied,
    skipped: stats.skipped,
    changed: stats.changed,
  }
}

function isReadyForAdapt(entry: TranslationEntry): boolean {
  return Boolean(
    entry.approved
    && (entry.translationApproved ?? true)
    && (entry.keyApproved ?? true)
    && entry.key
    && !entry.skip
    && !entry.deprecated,
  )
}

function sameRefs(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length)
    return false

  return left.every((value, index) => value === right[index])
}
