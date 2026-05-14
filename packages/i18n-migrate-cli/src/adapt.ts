import type { AdaptConfig, AdaptOptions, AdaptResult, AdaptSkip, TextSegment, TranslationEntry } from './types'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { backupFile } from './backup'
import { loadConfig } from './config'
import { Extractor } from './extractor'
import { paramNameForExpression } from './keygen'
import { findMapPaths } from './map-paths'
import { readMapFile } from './mapping'
import { mapPathToSourcePath, toPosixPath } from './paths'
import { createUnifiedDiff } from './reporter'

interface AdaptReplacement {
  start: number
  end: number
  text: string
  needsVueScriptRuntime?: boolean
}

interface AdaptFileResult {
  content: string
  applied: number
  skipped: AdaptSkip[]
}

interface AdaptParam {
  name: string
  expression: string
}

export async function adaptSources(options: AdaptOptions = {}): Promise<AdaptResult> {
  const cwd = options.cwd ?? process.cwd()
  options.onProgress?.({ phase: 'prepare', message: options.dryRun ? 'Preparing i18n adapt preview' : 'Preparing i18n source adaptation' })
  const config = await loadConfig(cwd)
  const adaptConfig = resolveAdaptConfig(config.adapt, options)
  const extractor = new Extractor(config)
  const sourcePaths = (await findMapPaths(cwd, options.path)).map(mapPathToSourcePath).sort()
  const batchId = new Date().toISOString()
  const files: AdaptResult['files'] = []
  const allSkipped: AdaptSkip[] = []
  options.onProgress?.({ phase: 'discover', message: `Found ${sourcePaths.length} source file(s) with maps`, total: sourcePaths.length })

  for (const [index, sourcePath] of sourcePaths.entries()) {
    options.onProgress?.({
      phase: 'file',
      path: sourcePath,
      current: index + 1,
      total: sourcePaths.length,
      action: 'adapt',
      dryRun: options.dryRun,
    })

    const absolutePath = path.join(cwd, sourcePath)
    const content = await readFile(absolutePath, 'utf8')
    const mapFile = await readMapFile(cwd, sourcePath)
    const translations = new Map<string, TranslationEntry>(Object.entries(mapFile.entries))
    const segments = extractor.extract(content, sourcePath)
    const adapted = adaptContent(content, sourcePath, segments, translations, adaptConfig)
    const changed = adapted.content !== content

    if (changed && !options.dryRun) {
      await backupFile(cwd, sourcePath, batchId)
      await writeFile(absolutePath, adapted.content, 'utf8')
      options.onProgress?.({ phase: 'write', path: sourcePath, current: index + 1, total: sourcePaths.length, action: 'adapt' })
    }

    allSkipped.push(...adapted.skipped)
    files.push({
      sourcePath,
      changed,
      applied: adapted.applied,
      skipped: adapted.skipped,
      diff: options.dryRun ? createUnifiedDiff(sourcePath, content, adapted.content) : undefined,
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Adapt finished' })
  return { files, dryRun: options.dryRun === true, skipped: allSkipped }
}

export function adaptContent(
  content: string,
  sourcePath: string,
  segments: TextSegment[],
  translations: Map<string, TranslationEntry>,
  config: AdaptConfig,
): AdaptFileResult {
  const replacements: AdaptReplacement[] = []
  const skipped: AdaptSkip[] = []
  let needsVueScriptRuntime = false

  for (const segment of segments) {
    const entry = translations.get(segment.text)
    const ready = entry && entry.approved && (entry.translationApproved ?? true) && (entry.keyApproved ?? true) && !entry.skip && !entry.deprecated
    if (!ready)
      continue

    if (!entry.key) {
      skipped.push(skip(sourcePath, segment.text, undefined, 'missing-key', 'Approve or assign an i18n key in the map file.'))
      continue
    }

    const replacement = replacementForSegment(content, sourcePath, segment, entry, config)
    if (!replacement) {
      skipped.push(skip(sourcePath, segment.text, entry.key, 'unsupported-context', 'Rewrite this occurrence manually or adjust adapt configuration.'))
      continue
    }

    if (replacement.needsVueScriptRuntime)
      needsVueScriptRuntime = true
    replacements.push(replacement)
  }

  let next = content
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`

  if (needsVueScriptRuntime)
    next = injectVueScriptRuntime(next, config)

  return {
    content: next,
    applied: replacements.length,
    skipped,
  }
}

function replacementForSegment(
  content: string,
  sourcePath: string,
  segment: TextSegment,
  entry: TranslationEntry,
  config: AdaptConfig,
): AdaptReplacement | undefined {
  const key = keyReference(sourcePath, entry.key!, config)
  const params = paramsForSegment(segment)

  if (sourcePath.endsWith('.vue') && segment.context === 'template' && segment.nodeType === 'VueTemplateText') {
    return {
      start: segment.start,
      end: segment.end,
      text: `{{ ${callExpression(config.callee.vue, key, params)} }}`,
    }
  }

  if (sourcePath.endsWith('.vue') && segment.context === 'html-attr' && segment.nodeType === 'VueStaticAttribute') {
    const attr = staticAttributeRange(content, segment)
    return attr
      ? {
          start: attr.start,
          end: attr.end,
          text: `:${attr.name}="${callExpression(config.callee.vue, key, params)}"`,
        }
      : undefined
  }

  if (segment.context === 'script' && segment.nodeType === 'StringLiteral') {
    if (sourcePath.endsWith('.vue') && config.import.script.enabled && !isInsideVueScriptSetup(content, segment.start))
      return undefined

    const replacement = scriptStringReplacement(content, segment, callExpression(config.callee.script, key, params))
    return replacement
      ? {
          ...replacement,
          needsVueScriptRuntime: sourcePath.endsWith('.vue') && config.import.script.enabled,
        }
      : undefined
  }

  return undefined
}

function scriptStringReplacement(content: string, segment: TextSegment, expression: string): AdaptReplacement | undefined {
  const quote = content[segment.start - 1]
  const after = content[segment.end]
  if (!quote || quote !== after || (quote !== '\'' && quote !== '"'))
    return undefined

  return {
    start: segment.start - 1,
    end: segment.end + 1,
    text: expression,
  }
}

function staticAttributeRange(content: string, segment: TextSegment): { start: number, end: number, name: string } | undefined {
  const before = content.slice(0, segment.start)
  const match = before.match(/([:@a-z_][\w:.-]*)\s*=\s*["'][^"'<>]*$/i)
  if (!match?.[1])
    return undefined

  const start = before.length - match[0].length
  const quote = content[segment.start - 1]
  if (!quote || (quote !== '"' && quote !== '\''))
    return undefined

  let end = segment.end
  if (content[end] === quote)
    end += 1

  return {
    start,
    end,
    name: match[1],
  }
}

function callExpression(callee: string, key: string, params: AdaptParam[]): string {
  const keyLiteral = quoteString(key)
  const paramObject = params.map(formatParam).join(', ')
  return params.length
    ? `${callee}(${keyLiteral}, { ${paramObject} })`
    : `${callee}(${keyLiteral})`
}

function keyReference(sourcePath: string, key: string, config: AdaptConfig): string {
  if (config.keyReference.mode === 'local')
    return key

  const modulePath = sourcePath
    .replace(/^(?:src|source)\//, '')
    .replace(/\.[^.]+$/, '')
    .split('/')
    .filter(Boolean)
    .join(config.keyReference.separator)

  return modulePath
    ? `${modulePath}${config.keyReference.separator}${key}`
    : key
}

function paramsForSegment(segment: TextSegment): AdaptParam[] {
  const params = (segment.interpolation?.segments ?? [])
    .map(raw => raw.replace(/^\{\{|\}\}$/g, '').replace(/^\$\{|\}$/g, '').trim())
    .filter(expression => /^[a-z_$][\w$]*(?:\.[a-z_$][\w$]*|\[[^\]]+\])*$/i.test(expression))
    .map(expression => ({
      name: paramNameForExpression(expression),
      expression,
    }))

  return uniqueParams(params)
}

function formatParam(param: AdaptParam): string {
  return param.name === param.expression
    ? param.name
    : `${param.name}: ${param.expression}`
}

function uniqueParams(params: AdaptParam[]): AdaptParam[] {
  const seen = new Set<string>()
  return params.filter((param) => {
    const signature = `${param.name}:${param.expression}`
    if (seen.has(signature))
      return false
    seen.add(signature)
    return true
  })
}

function resolveAdaptConfig(config: AdaptConfig, options: AdaptOptions): AdaptConfig {
  if (options.injectRuntime === undefined)
    return config

  return {
    ...config,
    import: {
      ...config.import,
      script: {
        ...config.import.script,
        enabled: options.injectRuntime,
      },
    },
  }
}

function injectVueScriptRuntime(content: string, config: AdaptConfig): string {
  if (!isIdentifier(config.callee.script))
    return content

  const setupBlock = findVueScriptBlock(content, true)
  if (setupBlock)
    return replaceScriptBlockContent(content, setupBlock, injectRuntimeIntoScript(setupBlock.content, config))

  const scriptBlock = findVueScriptBlock(content, false)
  if (scriptBlock)
    return replaceScriptBlockContent(content, scriptBlock, injectRuntimeIntoScript(scriptBlock.content, config))

  return insertScriptSetupBlock(content, injectRuntimeIntoScript('', config))
}

interface VueScriptBlock {
  content: string
  contentStart: number
  contentEnd: number
}

const IDENTIFIER_SOURCE = String.raw`[$_\p{L}][$_\p{L}\p{N}]*`

function findVueScriptBlock(content: string, setup: boolean): VueScriptBlock | undefined {
  const openTagPattern = /<script\b[^>]*>/gi
  for (const openTag of content.matchAll(openTagPattern)) {
    const isSetup = /\ssetup(?:[\s=>]|$)/i.test(openTag[0])
    if (isSetup !== setup)
      continue

    const contentStart = openTag.index + openTag[0].length
    const closeTag = /<\/script>/i.exec(content.slice(contentStart))
    if (!closeTag || closeTag.index === undefined)
      return undefined

    const contentEnd = contentStart + closeTag.index
    return {
      content: content.slice(contentStart, contentEnd),
      contentStart,
      contentEnd,
    }
  }

  return undefined
}

function isInsideVueScriptSetup(content: string, index: number): boolean {
  const setupBlock = findVueScriptBlock(content, true)
  return Boolean(setupBlock && index >= setupBlock.contentStart && index <= setupBlock.contentEnd)
}

function replaceScriptBlockContent(content: string, block: VueScriptBlock, nextContent: string): string {
  const formatted = `\n${nextContent.replace(/^\n+/, '').replace(/\n*$/, '\n')}`
  return `${content.slice(0, block.contentStart)}${formatted}${content.slice(block.contentEnd)}`
}

function injectRuntimeIntoScript(content: string, config: AdaptConfig): string {
  const importLocalName = existingImportLocalName(content, config)
    ?? config.import.script.localName
    ?? config.import.script.specifier
  const withImport = ensureRuntimeImport(content, config, importLocalName)

  if (hasRuntimeBinding(withImport, config.callee.script, importLocalName))
    return withImport

  return insertAfterImports(withImport, `${runtimeBindingStatement(config.callee.script, importLocalName)}\n`)
}

function existingImportLocalName(content: string, config: AdaptConfig): string | undefined {
  const source = escapeRegExp(config.import.script.source)
  if (config.import.script.importKind === 'default') {
    const match = new RegExp(`import\\s+(${IDENTIFIER_SOURCE})\\s+from\\s+['"]${source}['"]`, 'u').exec(content)
    return match?.[1]
  }

  const importPattern = new RegExp(`import\\s*\\{([^}]+)\\}\\s+from\\s+['"]${source}['"]`, 'g')
  for (const match of content.matchAll(importPattern)) {
    const localName = namedImportLocalName(match[1] ?? '', config.import.script.specifier)
    if (localName)
      return localName
  }

  return undefined
}

function namedImportLocalName(namedImports: string, specifier: string): string | undefined {
  for (const item of namedImports.split(',')) {
    const [imported, local] = item.trim().split(/\s+as\s+/)
    if (imported === specifier)
      return local?.trim() || imported
  }
  return undefined
}

function ensureRuntimeImport(content: string, config: AdaptConfig, importLocalName: string): string {
  if (existingImportLocalName(content, config))
    return content

  return insertAfterImports(content, `${runtimeImportStatement(config, importLocalName)}\n`)
}

function runtimeImportStatement(config: AdaptConfig, importLocalName: string): string {
  const { importKind, source, specifier } = config.import.script
  if (importKind === 'default')
    return `import ${importLocalName} from '${source}'`

  const namedImport = importLocalName === specifier
    ? specifier
    : `${specifier} as ${importLocalName}`
  return `import { ${namedImport} } from '${source}'`
}

function runtimeBindingStatement(callee: string, importLocalName: string): string {
  const binding = callee === 't' ? 't' : `t: ${callee}`
  return `const { ${binding} } = ${importLocalName}()`
}

function hasRuntimeBinding(content: string, callee: string, importLocalName: string): boolean {
  const escapedCallee = escapeRegExp(callee)
  const escapedImportLocalName = escapeRegExp(importLocalName)
  const destructured = new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b(?:t\\s*:\\s*)?${escapedCallee}\\b[^}]*\\}\\s*=\\s*${escapedImportLocalName}\\s*\\(`)
  const variable = new RegExp(`\\b(?:const|let|var)\\s+${escapedCallee}\\b`)
  return destructured.test(content) || variable.test(content)
}

function insertAfterImports(content: string, text: string): string {
  let lastImportEnd = 0
  for (const match of content.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?\n?/gm))
    lastImportEnd = (match.index ?? 0) + match[0].length

  if (lastImportEnd > 0)
    return `${content.slice(0, lastImportEnd)}${text}${content.slice(lastImportEnd)}`

  return content
    ? `${text}\n${content.replace(/^\n+/, '')}`
    : text
}

function insertScriptSetupBlock(content: string, scriptContent: string): string {
  const block = `<script setup lang="ts">\n${scriptContent.trimEnd()}\n</script>\n`
  const templateClose = /<\/template>/i.exec(content)
  if (!templateClose || templateClose.index === undefined)
    return `${block}${content}`

  const insertAt = templateClose.index + templateClose[0].length
  return `${content.slice(0, insertAt)}\n${block}${content.slice(insertAt)}`
}

function isIdentifier(value: string): boolean {
  return new RegExp(`^${IDENTIFIER_SOURCE}$`, 'u').test(value)
}

function quoteString(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function skip(sourcePath: string, text: string, key: string | undefined, reason: string, suggestion: string): AdaptSkip {
  return {
    sourcePath: toPosixPath(sourcePath),
    text,
    key,
    reason,
    suggestion,
  }
}
