import type { MapFile, MapStatsBucket, MapStatsFile, MapStatsReport, TranslationEntry } from './types'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pc from 'picocolors'
import { readJsonFile } from './fs-utils'
import { findMapPaths } from './map-paths'
import { createMapFile } from './mapping'
import { mapPathToSourcePath } from './paths'

export interface MapStatsOptions {
  cwd?: string
  path?: string
}

export async function collectMapStats(options: MapStatsOptions = {}): Promise<MapStatsReport> {
  const cwd = options.cwd ?? process.cwd()
  const mapPaths = await findMapPaths(cwd, options.path)
  const report: MapStatsReport = {
    discoveredMapFiles: mapPaths.length,
    validMapFiles: 0,
    current: createEmptyBucket(),
    orphaned: createEmptyBucket(),
    invalidFiles: [],
    files: [],
  }

  for (const mapPath of mapPaths) {
    const sourcePath = mapPathToSourcePath(mapPath)
    const absoluteMapPath = path.join(cwd, mapPath)
    const absoluteSourcePath = path.join(cwd, sourcePath)

    let mapFile: MapFile
    try {
      mapFile = await readJsonFile<MapFile>(absoluteMapPath, createMapFile())
    }
    catch (error) {
      report.invalidFiles.push({
        mapPath,
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    const sourceExists = await exists(absoluteSourcePath)
    const fileStats = summarizeMapFile(mapFile, { sourcePath, mapPath, sourceExists })
    report.validMapFiles += 1
    report.files.push(fileStats)
    mergeBucket(sourceExists ? report.current : report.orphaned, fileStats)
  }

  return report
}

export function formatMapStatsReport(report: MapStatsReport): string {
  const lines: string[] = []
  const currentEntries = report.current.entries
  const orphanEntries = report.orphaned.entries
  const totalEntries = currentEntries + orphanEntries
  const activeEntries = report.current.readyToApplyEntries + report.current.pendingReviewEntries + report.current.untranslatedEntries
  const translatedEntries = report.current.readyToApplyEntries + report.current.pendingReviewEntries

  lines.push(pc.bold('tmigrate stats'))
  lines.push(pc.dim('统计口径：按 map 条目数，不是源码出现次数。'))
  lines.push(
    `Map 文件: ${formatCount(report.discoveredMapFiles)} 个`
    + ` (${formatCount(report.validMapFiles)} 个可读, ${formatCount(report.invalidFiles.length)} 个损坏)`,
  )
  lines.push(`当前源码仍存在: ${formatCount(report.current.mapFiles)} 个 map`)
  lines.push(`已失效/孤儿: ${formatCount(report.orphaned.mapFiles)} 个 map`)
  lines.push(`条目总数: ${formatCount(totalEntries)} 个`)
  lines.push('')

  lines.push(pc.cyan('当前工作集'))
  lines.push(`- 可回写: ${formatCount(report.current.readyToApplyEntries)}`)
  lines.push(`- 待人工校对: ${formatCount(report.current.pendingReviewEntries)}`)
  lines.push(`- 待补译: ${formatCount(report.current.untranslatedEntries)}`)
  lines.push(`- 已跳过: ${formatCount(report.current.skippedEntries)}`)
  lines.push(`- 已废弃: ${formatCount(report.current.deprecatedEntries)}`)
  lines.push(`- 已翻译可用: ${formatCount(translatedEntries)} / ${formatCount(activeEntries)} (${formatPercent(translatedEntries, activeEntries)})`)
  lines.push('')

  lines.push(pc.cyan('来源分布'))
  lines.push(`- glossary: ${formatCount(report.current.translationSourceCounts.glossary)}`)
  lines.push(`- machine: ${formatCount(report.current.translationSourceCounts.machine)}`)
  lines.push(`- manual: ${formatCount(report.current.translationSourceCounts.manual)}`)

  if (report.orphaned.mapFiles > 0) {
    lines.push('')
    lines.push(pc.yellow('孤儿 map'))
    lines.push(`- map 文件: ${formatCount(report.orphaned.mapFiles)} 个`)
    lines.push(`- 条目: ${formatCount(orphanEntries)} 个`)
  }

  if (report.invalidFiles.length > 0) {
    lines.push('')
    lines.push(pc.red('无法解析的 map 文件'))
    for (const file of report.invalidFiles)
      lines.push(`- ${file.mapPath}: ${file.error}`)
  }

  lines.push('')
  lines.push(pc.cyan('文件明细'))
  if (report.files.length === 0) {
    lines.push('- 暂无可统计的 map 文件。')
  }
  else {
    for (const file of report.files) {
      const label = file.sourceExists ? file.sourcePath : `${file.sourcePath} (orphan)`
      lines.push(
        `- ${label} | total ${formatCount(file.totalEntries)}`
        + ` | ready ${formatCount(file.readyToApplyEntries)}`
        + ` | review ${formatCount(file.pendingReviewEntries)}`
        + ` | empty ${formatCount(file.untranslatedEntries)}`
        + ` | skip ${formatCount(file.skippedEntries)}`
        + ` | deprecated ${formatCount(file.deprecatedEntries)}`,
      )
    }
  }

  lines.push('')
  lines.push(pc.cyan('下一步'))
  if (report.current.untranslatedEntries > 0)
    lines.push(`- 先补齐 ${formatCount(report.current.untranslatedEntries)} 条待翻译文本。`)
  if (report.current.pendingReviewEntries > 0)
    lines.push(`- 再校对 ${formatCount(report.current.pendingReviewEntries)} 条译文，然后执行 \`tmigrate approve\`。`)
  if (report.current.readyToApplyEntries > 0)
    lines.push(`- 当前已有 ${formatCount(report.current.readyToApplyEntries)} 条可回写，执行 \`tmigrate apply\`。`)
  if (report.current.deprecatedEntries > 0)
    lines.push(`- 有 ${formatCount(report.current.deprecatedEntries)} 条废弃条目，可执行 \`tmigrate scan --clean-deprecated\`。`)
  if (report.orphaned.mapFiles > 0)
    lines.push(`- 有 ${formatCount(report.orphaned.mapFiles)} 个孤儿 map 文件，建议删除对应文件或重新扫描。`)
  if (report.invalidFiles.length > 0)
    lines.push(`- 先修复 ${formatCount(report.invalidFiles.length)} 个损坏的 map 文件，再继续统计或回写。`)
  if (
    report.current.untranslatedEntries === 0
    && report.current.pendingReviewEntries === 0
    && report.current.readyToApplyEntries === 0
    && report.current.deprecatedEntries === 0
    && report.orphaned.mapFiles === 0
    && report.invalidFiles.length === 0
  ) {
    lines.push('- 当前没有明显待处理项。')
  }

  return lines.join('\n')
}

function createEmptyBucket(): MapStatsBucket {
  return {
    mapFiles: 0,
    entries: 0,
    readyToApplyEntries: 0,
    pendingReviewEntries: 0,
    untranslatedEntries: 0,
    skippedEntries: 0,
    deprecatedEntries: 0,
    translationSourceCounts: {
      glossary: 0,
      machine: 0,
      manual: 0,
    },
  }
}

function summarizeMapFile(
  mapFile: MapFile,
  file: Pick<MapStatsFile, 'sourcePath' | 'mapPath' | 'sourceExists'>,
): MapStatsFile {
  const stats = createEmptyBucket()
  const entries = Object.values(mapFile.entries)
  stats.entries = entries.length

  for (const entry of entries)
    classifyEntry(entry, stats)

  return {
    ...file,
    totalEntries: entries.length,
    readyToApplyEntries: stats.readyToApplyEntries,
    pendingReviewEntries: stats.pendingReviewEntries,
    untranslatedEntries: stats.untranslatedEntries,
    skippedEntries: stats.skippedEntries,
    deprecatedEntries: stats.deprecatedEntries,
    translationSourceCounts: stats.translationSourceCounts,
  }
}

function classifyEntry(entry: TranslationEntry, stats: MapStatsBucket): void {
  if (entry.deprecated) {
    stats.deprecatedEntries += 1
    return
  }

  if (entry.skip) {
    stats.skippedEntries += 1
    return
  }

  if (!hasMeaningfulTranslation(entry.translation)) {
    stats.untranslatedEntries += 1
    return
  }

  stats.translationSourceCounts[entry.translationSource] += 1

  if (entry.approved)
    stats.readyToApplyEntries += 1
  else
    stats.pendingReviewEntries += 1
}

function mergeBucket(target: MapStatsBucket, source: MapStatsFile): void {
  target.mapFiles += 1
  target.entries += source.totalEntries
  target.readyToApplyEntries += source.readyToApplyEntries
  target.pendingReviewEntries += source.pendingReviewEntries
  target.untranslatedEntries += source.untranslatedEntries
  target.skippedEntries += source.skippedEntries
  target.deprecatedEntries += source.deprecatedEntries
  target.translationSourceCounts.glossary += source.translationSourceCounts.glossary
  target.translationSourceCounts.machine += source.translationSourceCounts.machine
  target.translationSourceCounts.manual += source.translationSourceCounts.manual
}

function hasMeaningfulTranslation(translation: string): boolean {
  return translation.trim().length > 0
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0)
    return '0%'
  return `${(numerator / denominator * 100).toFixed(1)}%`
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}
