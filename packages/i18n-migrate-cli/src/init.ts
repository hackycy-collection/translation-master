import type { MigrateConfig } from './types'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { DEFAULT_CONFIG, defineConfig } from './config'
import { isNodeError, writeJsonFile } from './fs-utils'

export interface InitOptions {
  cwd?: string
  from?: string
  to?: string
  overwrite?: boolean
  interactive?: boolean
}

export interface InitResult {
  created: string[]
  skipped: string[]
}

export async function initProject(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd()
  const root = path.join(cwd, '.tmigrate')
  const created: string[] = []
  const skipped: string[] = []

  for (const dir of ['', 'maps', 'cache', 'backups']) {
    const dirPath = path.join(root, dir)
    await mkdir(dirPath, { recursive: true })
    created.push(path.relative(cwd, dirPath) || '.tmigrate')
  }

  const config = defineConfig({
    sourceLocale: options.from ?? DEFAULT_CONFIG.sourceLocale,
    targetLocale: options.to ?? DEFAULT_CONFIG.targetLocale,
  })

  await writeIfAllowed(path.join(root, 'config.json'), config, options.overwrite !== false, created, skipped)
  await writeIfAllowed(path.join(root, 'glossary.json'), {}, options.overwrite !== false, created, skipped)

  for (const dir of ['maps', 'cache', 'backups'])
    await writeIfAllowed(path.join(root, dir, '.gitkeep'), '', false, created, skipped)

  return { created, skipped }
}

async function writeIfAllowed(
  filePath: string,
  value: MigrateConfig | Record<string, never> | string,
  overwrite: boolean,
  created: string[],
  skipped: string[],
): Promise<void> {
  try {
    if (typeof value === 'string')
      await writeFile(filePath, value, { flag: overwrite ? 'w' : 'wx' })
    else
      await writeJsonFileWithFlag(filePath, value, overwrite)
    created.push(filePath)
  }
  catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      skipped.push(filePath)
      return
    }
    throw error
  }
}

async function writeJsonFileWithFlag(filePath: string, value: unknown, overwrite: boolean): Promise<void> {
  if (overwrite) {
    await writeJsonFile(filePath, value)
    return
  }
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}
