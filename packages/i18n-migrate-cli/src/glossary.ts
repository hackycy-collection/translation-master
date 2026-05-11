import type { MigrateConfigInput } from './config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { githubTreeToRawBaseUrl, loadConfig } from './config'
import { readJsonFile, writeJsonFile } from './fs-utils'
import { toPosixPath } from './paths'

export type Glossary = Record<string, string>
export type GlossaryPresetName = 'ui' | 'business' | 'all'

export interface InitGlossaryOptions {
  cwd?: string
  from?: string
  to?: string
  preset?: GlossaryPresetName | string
  presetIndex?: string
  overwrite?: boolean
  dryRun?: boolean
}

export interface InitGlossaryResult {
  glossaryPath: string
  preset: GlossaryPresetName
  sourceLocale: string
  targetLocale: string
  added: number
  updated: number
  unchanged: number
  skipped: number
  entries: Glossary
  dryRun: boolean
}

const INTERPOLATION_RE = /(\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\})/
const DROPPABLE_SOURCE_WORDS = new Set(['a', 'an', 'the', 'has', 'to', 'of'])
const KNOWN_TERM_MISTRANSLATIONS: Record<string, string[]> = {
  订单: ['命令', '顺序'],
}
const RESOURCE_TEXT_CACHE = new Map<string, Promise<string>>()

interface GlossaryPresetIndex {
  version?: number
  base?: string
  presets: Record<string, Partial<Record<`${string}->${string}`, string[]>>>
}

type GlossaryLocalePair = `${string}->${string}`

export async function loadGlossary(cwd = process.cwd()): Promise<Glossary> {
  return readJsonFile<Glossary>(path.join(cwd, '.tmigrate', 'glossary.json'), {})
}

export async function initGlossary(options: InitGlossaryOptions = {}): Promise<InitGlossaryResult> {
  const cwd = options.cwd ?? process.cwd()
  const overrides: MigrateConfigInput = {
    ...(options.from ? { sourceLocale: options.from } : {}),
    ...(options.to ? { targetLocale: options.to } : {}),
    ...(options.presetIndex ? { glossaryPresets: { index: options.presetIndex } } : {}),
  }
  const config = await loadConfig(cwd, overrides)
  const sourceLocale = normalizeLocale(config.sourceLocale)
  const targetLocale = normalizeLocale(config.targetLocale)
  const presetName = normalizePresetName(options.preset ?? 'ui')
  const glossaryPath = path.join(cwd, '.tmigrate', 'glossary.json')
  const existing = await loadGlossary(cwd)
  const seed = await glossaryPresetForLocalePair(
    presetName,
    sourceLocale,
    targetLocale,
    cwd,
    config.glossaryPresets?.index,
  )
  const entries: Glossary = { ...existing }
  let added = 0
  let updated = 0
  let unchanged = 0
  let skipped = 0

  for (const [source, translation] of Object.entries(seed)) {
    if (!(source in entries)) {
      entries[source] = translation
      added++
      continue
    }
    if (entries[source] === translation) {
      unchanged++
      continue
    }
    if (options.overwrite) {
      entries[source] = translation
      updated++
    }
    else {
      skipped++
    }
  }

  const sortedEntries = sortGlossary(entries)
  if (!options.dryRun)
    await writeJsonFile(glossaryPath, sortedEntries)

  return {
    glossaryPath,
    preset: presetName,
    sourceLocale,
    targetLocale,
    added,
    updated,
    unchanged,
    skipped,
    entries: sortedEntries,
    dryRun: Boolean(options.dryRun),
  }
}

export function matchGlossary(text: string, glossary: Glossary, filePath?: string): string | undefined {
  const contexts = filePath ? contextCandidates(filePath) : []

  for (const context of contexts) {
    const exact = findGlossaryValue(glossary, `${context}/${text}`)
    if (exact)
      return exact
  }

  const plain = findGlossaryValue(glossary, text)
  if (plain)
    return plain

  for (const context of contexts) {
    const prefix = glossary[`${context}/*`]
    if (prefix)
      return prefix
  }

  return undefined
}

export function composeGlossaryTranslation(text: string, glossary: Glossary, filePath?: string): string | undefined {
  const terms = glossaryTerms(glossary, filePath)
  if (!terms.length)
    return undefined

  const normalizedText = text.trim()
  const chunks: string[] = []
  let cursor = 0

  while (cursor < normalizedText.length) {
    const nextWhitespace = normalizedText.slice(cursor).match(/^\s+/)?.[0]
    if (nextWhitespace) {
      cursor += nextWhitespace.length
      continue
    }

    const interpolation = normalizedText.slice(cursor).match(INTERPOLATION_RE)?.[0]
    if (interpolation && normalizedText.startsWith(interpolation, cursor)) {
      chunks.push(interpolation)
      cursor += interpolation.length
      continue
    }

    const punctuation = normalizedText.slice(cursor).match(/^[,.;:!?()[\]{}"'`-]+/)?.[0]
    if (punctuation) {
      chunks.push(punctuation)
      cursor += punctuation.length
      continue
    }

    const term = findMatchingTerm(normalizedText, cursor, terms)
    if (term) {
      chunks.push(term.translation)
      cursor += term.length
      continue
    }

    const word = normalizedText.slice(cursor).match(/^[a-z]+/i)?.[0]
    if (word && DROPPABLE_SOURCE_WORDS.has(word.toLocaleLowerCase())) {
      cursor += word.length
      continue
    }

    if (!term)
      return undefined
  }

  return joinGlossaryChunks(chunks)
}

export function enforceGlossaryTerms(source: string, translation: string, glossary: Glossary, filePath?: string): string {
  const terms = matchingGlossaryTerms(source, glossary, filePath)
  if (!terms.length)
    return translation

  let next = translation
  for (const term of terms) {
    if (next.includes(term.translation))
      continue

    const mistranslation = KNOWN_TERM_MISTRANSLATIONS[term.translation]?.find(value => next.includes(value))
    if (mistranslation) {
      next = next.replaceAll(mistranslation, term.translation)
    }
  }

  return next
}

function contextCandidates(filePath: string): string[] {
  const parts = toPosixPath(filePath).split('/').filter(Boolean)
  const basename = parts.at(-1)
  const withoutFile = basename && basename.includes('.') ? parts.slice(0, -1) : parts
  const candidates: string[] = []

  for (let index = withoutFile.length; index > 0; index--)
    candidates.push(withoutFile.slice(Math.max(0, index - 2), index).join('/'))

  return Array.from(new Set(candidates.filter(Boolean)))
}

function glossaryTerms(glossary: Glossary, filePath?: string): Array<{ source: string, translation: string }> {
  const contexts = filePath ? contextCandidates(filePath) : []
  const contextPrefixes = new Set(contexts.map(context => `${context}/`))

  return Object.entries(glossary)
    .map(([source, translation]) => ({
      source: stripContextPrefix(source, contextPrefixes),
      translation,
    }))
    .filter(term => term.source && !term.source.endsWith('*') && isComposableGlossarySource(term.source))
    .sort((a, b) => b.source.length - a.source.length)
}

function matchingGlossaryTerms(sourceText: string, glossary: Glossary, filePath?: string): Array<{ source: string, translation: string }> {
  return glossaryTerms(glossary, filePath)
    .filter(term => findMatchingTerm(sourceText, 0, [{ source: term.source, translation: term.translation }])
      || sourceContainsTerm(sourceText, term.source))
}

function sourceContainsTerm(sourceText: string, source: string): boolean {
  for (let index = 0; index < sourceText.length; index++) {
    if (matchTermLength(sourceText, index, source))
      return true
  }
  return false
}

function stripContextPrefix(source: string, contextPrefixes: Set<string>): string {
  for (const prefix of contextPrefixes) {
    if (source.startsWith(prefix))
      return source.slice(prefix.length)
  }
  return source
}

function findGlossaryValue(glossary: Glossary, key: string): string | undefined {
  const exact = glossary[key]
  if (exact)
    return exact

  if (!/[a-z]/i.test(key))
    return undefined

  const normalizedKey = key.toLocaleLowerCase()
  for (const [candidate, value] of Object.entries(glossary)) {
    if (candidate.toLocaleLowerCase() === normalizedKey)
      return value
  }

  return undefined
}

function isComposableGlossarySource(source: string): boolean {
  return !(source.length === 1 && hasCjk(source))
}

function findMatchingTerm(
  text: string,
  start: number,
  terms: Array<{ source: string, translation: string }>,
): { translation: string, length: number } | undefined {
  for (const term of terms) {
    const length = matchTermLength(text, start, term.source)
    if (length)
      return { translation: term.translation, length }
  }
  return undefined
}

function matchTermLength(text: string, start: number, source: string): number | undefined {
  for (const variant of termVariants(source)) {
    if (
      text.slice(start, start + variant.length).toLocaleLowerCase() === variant.toLocaleLowerCase()
      && isWordBoundary(text[start - 1])
      && isWordBoundary(text[start + variant.length])
    ) {
      return variant.length
    }
  }
  return undefined
}

function termVariants(source: string): string[] {
  const variants = [source]
  const plural = pluralizeEnglishTerm(source)
  if (plural && plural !== source)
    variants.push(plural)
  return variants.sort((a, b) => b.length - a.length)
}

function pluralizeEnglishTerm(source: string): string | undefined {
  if (!/^[a-z][a-z\s-]*$/i.test(source))
    return undefined

  const lastWord = source.match(/[a-z]+$/i)?.[0]
  if (!lastWord)
    return undefined

  const plural = lastWord.endsWith('y')
    ? `${lastWord.slice(0, -1)}ies`
    : /(?:[sxz]|ch|sh)$/i.test(lastWord)
      ? `${lastWord}es`
      : `${lastWord}s`

  return `${source.slice(0, -lastWord.length)}${plural}`
}

function isWordBoundary(char: string | undefined): boolean {
  return !char || !/[a-z0-9]/i.test(char)
}

function joinGlossaryChunks(chunks: string[]): string {
  return chunks.reduce((result, chunk) => {
    if (!result)
      return chunk
    if (isPunctuation(chunk))
      return `${result}${chunk}`
    if (hasCjk(result) || hasCjk(chunk))
      return `${result}${chunk}`
    return `${result} ${chunk}`
  }, '')
}

function isPunctuation(text: string): boolean {
  return /^[,.;:!?()[\]{}"'`-]+$/.test(text)
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text)
}

function normalizePresetName(preset: string): GlossaryPresetName {
  if (preset === 'ui' || preset === 'business' || preset === 'all')
    return preset
  throw new Error(`Unsupported glossary preset "${preset}". Available presets: ui, business, all.`)
}

async function glossaryPresetForLocalePair(
  preset: GlossaryPresetName,
  from: string,
  to: string,
  cwd: string,
  presetIndex = '',
): Promise<Glossary> {
  const indexLocation = resolvePresetIndexLocation(presetIndex, cwd)
  const index = await loadJsonResource<GlossaryPresetIndex>(indexLocation)
  const presetDefinition = index.presets[preset]

  if (!presetDefinition) {
    throw new Error(`Glossary preset "${preset}" was not found in ${presetIndex}.`)
  }

  const directPair = `${from}->${to}` as GlossaryLocalePair
  const inversePair = `${to}->${from}` as GlossaryLocalePair
  const baseLocation = resolvePresetBaseLocation(indexLocation, index.base)

  if (presetDefinition[directPair])
    return loadGlossaryFragments(presetDefinition[directPair], baseLocation)

  if (presetDefinition[inversePair])
    return invertGlossary(await loadGlossaryFragments(presetDefinition[inversePair], baseLocation))

  throw new Error(`No glossary preset for ${from}->${to} in ${presetIndex}. Supported pairs: ${Object.keys(presetDefinition).join(', ') || 'none'}.`)
}

function normalizeLocale(locale: string): string {
  return locale.toLocaleLowerCase().split(/[-_]/)[0] ?? locale
}

function resolvePresetIndexLocation(presetIndex: string, cwd: string): string {
  if (isRemoteResource(presetIndex))
    return normalizeRemoteIndexLocation(presetIndex)
  return path.isAbsolute(presetIndex) ? presetIndex : path.resolve(cwd, presetIndex)
}

function normalizeRemoteIndexLocation(resource: string): string {
  if (resource.endsWith('.json'))
    return resource

  const rawBase = githubTreeToRawBaseUrl(resource)
  if (rawBase)
    return new URL('src/glossary-presets/index.json', rawBase).toString()

  return new URL('index.json', ensureTrailingSlash(resource)).toString()
}

function resolvePresetBaseLocation(indexLocation: string, base: string | undefined): string {
  if (!base)
    return parentResourceLocation(indexLocation)
  if (isRemoteResource(base))
    return ensureTrailingSlash(base)
  if (isRemoteResource(indexLocation))
    return new URL(base, indexLocation).toString()
  return path.isAbsolute(base) ? base : path.resolve(path.dirname(indexLocation), base)
}

function parentResourceLocation(resource: string): string {
  if (isRemoteResource(resource))
    return new URL('./', resource).toString()
  return path.dirname(resource)
}

function resolveFragmentLocation(baseLocation: string, fragment: string): string {
  if (isRemoteResource(fragment))
    return fragment
  if (isRemoteResource(baseLocation))
    return new URL(fragment, ensureTrailingSlash(baseLocation)).toString()
  return path.isAbsolute(fragment) ? fragment : path.resolve(baseLocation, fragment)
}

async function loadGlossaryFragments(fragments: string[], baseLocation: string): Promise<Glossary> {
  const glossary: Glossary = {}
  for (const fragment of fragments) {
    Object.assign(glossary, await loadJsonResource<Glossary>(resolveFragmentLocation(baseLocation, fragment)))
  }
  return glossary
}

async function loadJsonResource<T>(resource: string): Promise<T> {
  const raw = await readTextResource(resource)
  try {
    return JSON.parse(raw) as T
  }
  catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse JSON from ${resource}: ${details}`)
  }
}

async function readTextResource(resource: string): Promise<string> {
  const cached = RESOURCE_TEXT_CACHE.get(resource)
  if (cached)
    return cached

  const pending = isRemoteResource(resource)
    ? fetchRemoteResource(resource)
    : readFile(resource, 'utf8')

  RESOURCE_TEXT_CACHE.set(resource, pending)
  try {
    return await pending
  }
  catch (error) {
    RESOURCE_TEXT_CACHE.delete(resource)
    throw error
  }
}

async function fetchRemoteResource(resource: string): Promise<string> {
  const response = await fetch(resource)
  if (!response.ok)
    throw new Error(`Failed to fetch ${resource}: ${response.status} ${response.statusText}`)
  return response.text()
}

function isRemoteResource(resource: string): boolean {
  return /^https?:\/\//i.test(resource)
}

function ensureTrailingSlash(resource: string): string {
  return resource.endsWith('/') ? resource : `${resource}/`
}

function invertGlossary(glossary: Glossary): Glossary {
  const entries: Glossary = {}
  for (const [source, translation] of Object.entries(glossary)) {
    if (!(translation in entries))
      entries[translation] = source
  }
  return entries
}

function sortGlossary(glossary: Glossary): Glossary {
  return Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b)))
}
