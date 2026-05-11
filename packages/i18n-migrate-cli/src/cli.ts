import type { ScanProgressEvent } from './types'
import process from 'node:process'
import { Command } from 'commander'
import pc from 'picocolors'
import { applyTranslations, restoreBackups } from './apply'
import { initProject } from './init'
import { createSpinner } from './prompts'
import { scanProject } from './scanner'

export interface CreateCliOptions {
  version: string
}

export function createCli(options: CreateCliOptions): Command {
  const program = new Command()

  program
    .name('tmigrate')
    .description('Extract Chinese text from source files and manage i18n migration maps.')
    .version(options.version)

  program
    .command('init')
    .description('Create the .tmigrate directory structure with an interactive setup flow.')
    .option('-i, --interactive', 'force interactive setup prompts')
    .option('-y, --yes', 'skip prompts and use defaults')
    .option('--from <locale>', 'source locale')
    .option('--to <locale>', 'target locale')
    .option('--no-overwrite', 'preserve existing files')
    .action(async (command: { interactive?: boolean, yes?: boolean, from?: string, to?: string, overwrite?: boolean }) => {
      const interactive = command.yes ? false : command.interactive ?? Boolean(process.stdin.isTTY)
      const result = await initProject({
        ...command,
        interactive,
      })
      console.log(pc.green(`Initialized .tmigrate (${result.created.length} created, ${result.skipped.length} skipped).`))
    })

  program
    .command('scan [path]')
    .description('Scan source files and write split map files under .tmigrate/maps.')
    .option('--to <locale>', 'target locale')
    .option('--incremental', 'scan only changed files')
    .option('--clean-deprecated', 'remove deprecated entries from map files')
    .action(async (targetPath: string | undefined, command: { to?: string, incremental?: boolean, cleanDeprecated?: boolean }) => {
      const progress = createScanProgressRenderer()
      const result = await scanProjectWithProgress({
        path: targetPath,
        to: command.to,
        incremental: command.incremental,
        cleanDeprecated: command.cleanDeprecated,
        onProgress: progress.update,
      }, progress)
      console.log(pc.green(`Scanned ${result.scannedFiles} file(s), skipped ${result.skippedFiles}, extracted ${result.extractedTexts} text(s).`))
    })

  program
    .command('apply')
    .description('Apply approved translations back to source files.')
    .option('--dry-run', 'print a diff without writing files')
    .option('--path <path>', 'limit apply to a file or directory')
    .action(async (command: { dryRun?: boolean, path?: string }) => {
      const result = await applyTranslations({
        dryRun: command.dryRun,
        path: command.path,
      })
      for (const file of result.files) {
        if (file.diff)
          console.log(file.diff)
      }
      const changed = result.files.filter(file => file.changed).length
      console.log(pc.green(`${result.dryRun ? 'Previewed' : 'Applied'} ${changed} changed file(s).`))
    })

  program
    .command('restore')
    .description('Restore files from .tmigrate/backups.')
    .option('--path <path>', 'restore a specific file')
    .option('--list', 'list available backups')
    .action(async (command: { path?: string, list?: boolean }) => {
      const result = await restoreBackups({
        path: command.path,
        list: command.list,
      })
      if (command.list) {
        for (const entry of result.available)
          console.log(`${entry.sourcePath}\t${entry.backedUpAt}`)
        return
      }
      console.log(pc.green(`Restored ${result.restored.length} file(s).`))
    })

  return program
}

type ScanCommandOptions = Parameters<typeof scanProject>[0]

async function scanProjectWithProgress(options: ScanCommandOptions, progress: { stop: (message: string) => void }) {
  try {
    const result = await scanProject(options)
    progress.stop('Scan finished.')
    return result
  }
  catch (error) {
    progress.stop('Scan failed.')
    throw error
  }
}

function createScanProgressRenderer(): { update: (event: ScanProgressEvent) => void, stop: (message: string) => void } {
  const spinner = createSpinner()
  let started = false
  let finished = false
  let currentFilePath: string | undefined
  let currentFileIndex = 0
  let currentFileTotal = 0
  let lastMessage = ''

  const startOrUpdate = (message: string) => {
    if (finished)
      return
    if (message === lastMessage)
      return
    lastMessage = message
    if (started) {
      spinner.message(message)
      return
    }
    spinner.start(message)
    started = true
  }

  return {
    update(event) {
      if (event.phase === 'config') {
        startOrUpdate('Preparing translation workspace')
        return
      }
      if (event.phase === 'discover') {
        if (event.totalFiles !== undefined) {
          startOrUpdate(`Scanning source files (${event.totalFiles} found)`)
        }
        else {
          startOrUpdate('Scanning source files')
        }
        return
      }
      if (event.phase === 'file') {
        currentFilePath = event.filePath
        currentFileIndex = event.current
        currentFileTotal = event.total
        startOrUpdate(`Processing ${event.filePath} (${event.current}/${event.total})`)
        return
      }
      if (event.phase === 'model-load') {
        if (event.state === 'ready' || event.state === 'done')
          return
        startOrUpdate(formatModelLoadMessage(event, currentFilePath, currentFileIndex, currentFileTotal))
        return
      }
      if (event.phase === 'translate') {
        if (event.totalTexts === 0) {
          startOrUpdate(`Processing ${event.filePath} · glossary only`)
        }
        else {
          startOrUpdate(`Processing ${event.filePath} · translating ${event.completedTexts}/${event.totalTexts} texts (batch ${event.completedBatches}/${event.totalBatches})`)
        }
        return
      }
      if (event.phase === 'write') {
        currentFilePath = event.filePath
        currentFileIndex = event.current
        currentFileTotal = event.total
        startOrUpdate(`Processing ${event.filePath} · saving map`)
      }
    },
    stop(message) {
      if (finished)
        return
      finished = true
      if (started)
        spinner.stop(message)
    },
  }
}

function formatModelLoadMessage(
  event: Extract<ScanProgressEvent, { phase: 'model-load' }>,
  filePath: string | undefined,
  currentFileIndex: number,
  currentFileTotal: number,
): string {
  const filePrefix = filePath ? `Processing ${filePath}` : 'Loading local model'
  const fileProgress = currentFileTotal > 0 ? ` (${currentFileIndex}/${currentFileTotal})` : ''
  return `${filePrefix}${fileProgress} · loading local model (${event.modelId})`
}
