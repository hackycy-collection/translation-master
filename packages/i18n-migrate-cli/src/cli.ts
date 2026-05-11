import type { ScanProgressEvent } from './types'
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
    .description('Create the .tmigrate directory structure and default configuration.')
    .option('-i, --interactive', 'prompt for configuration values')
    .option('--from <locale>', 'source locale')
    .option('--to <locale>', 'target locale')
    .option('--no-overwrite', 'preserve existing files')
    .action(async (command: { interactive?: boolean, from?: string, to?: string, overwrite?: boolean }) => {
      const result = await initProject(command)
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

  const startOrUpdate = (message: string) => {
    if (finished)
      return
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
        startOrUpdate(event.message)
        return
      }
      if (event.phase === 'discover') {
        startOrUpdate(event.message)
        return
      }
      if (event.phase === 'file') {
        startOrUpdate(`Scanning ${event.filePath} (${event.current}/${event.total})`)
        return
      }
      if (event.phase === 'model-load') {
        startOrUpdate(formatModelLoadMessage(event))
        return
      }
      if (event.phase === 'translate') {
        if (event.totalTexts === 0) {
          startOrUpdate(`No machine translation needed for ${event.filePath}`)
        }
        else {
          startOrUpdate(`Translating ${event.filePath}: ${event.completedTexts}/${event.totalTexts} text(s), batch ${event.completedBatches}/${event.totalBatches}`)
        }
        return
      }
      if (event.phase === 'write') {
        startOrUpdate(`Writing map for ${event.filePath} (${event.current}/${event.total})`)
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

function formatModelLoadMessage(event: Extract<ScanProgressEvent, { phase: 'model-load' }>): string {
  if (event.state === 'ready')
    return `Local model ready: ${event.modelId}`

  const progress = Number.isFinite(event.progress) && event.progress > 0
    ? ` ${Math.round(event.progress)}%`
    : ''
  const file = event.file ? ` (${event.file})` : ''
  return `Loading local model: ${event.modelId}${progress}${file}`
}
