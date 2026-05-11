import path from 'node:path'
import process from 'node:process'
import { loadConfig } from './config'
import { readJsonFile, writeJsonFile } from './fs-utils'
import { toPosixPath } from './paths'

export type Glossary = Record<string, string>
export type GlossaryPresetName = 'ui' | 'business' | 'all'

export interface InitGlossaryOptions {
  cwd?: string
  from?: string
  to?: string
  preset?: GlossaryPresetName | string
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

const GLOSSARY_PRESETS: Record<GlossaryPresetName, Glossary> = {
  ui: {
    确定: 'OK',
    取消: 'Cancel',
    提交: 'Submit',
    保存: 'Save',
    删除: 'Delete',
    编辑: 'Edit',
    新增: 'Add',
    添加: 'Add',
    创建: 'Create',
    搜索: 'Search',
    查询: 'Search',
    重置: 'Reset',
    返回: 'Back',
    关闭: 'Close',
    打开: 'Open',
    启用: 'Enable',
    禁用: 'Disable',
    登录: 'Log in',
    退出: 'Log out',
    注册: 'Sign up',
    用户名: 'Username',
    密码: 'Password',
    邮箱: 'Email',
    手机号: 'Phone number',
    验证码: 'Verification code',
    首页: 'Home',
    详情: 'Details',
    列表: 'List',
    设置: 'Settings',
    状态: 'Status',
    操作: 'Actions',
    更多: 'More',
    加载中: 'Loading',
    暂无数据: 'No data',
    成功: 'Success',
    失败: 'Failed',
    错误: 'Error',
    警告: 'Warning',
    提示: 'Tip',
    确认: 'Confirm',
    全选: 'Select all',
    导入: 'Import',
    导出: 'Export',
    下载: 'Download',
    上传: 'Upload',
    预览: 'Preview',
    复制: 'Copy',
    刷新: 'Refresh',
    上一页: 'Previous',
    下一页: 'Next',
  },
  business: {
    订单: 'Order',
    用户: 'User',
    角色: 'Role',
    权限: 'Permission',
    菜单: 'Menu',
    商品: 'Product',
    库存: 'Inventory',
    价格: 'Price',
    金额: 'Amount',
    数量: 'Quantity',
    支付: 'Payment',
    退款: 'Refund',
    地址: 'Address',
    物流: 'Shipping',
    客户: 'Customer',
    供应商: 'Vendor',
    部门: 'Department',
    系统: 'System',
    审核: 'Review',
    审批: 'Approval',
    待处理: 'Pending',
    已完成: 'Completed',
    已取消: 'Canceled',
    已启用: 'Enabled',
    已禁用: 'Disabled',
    创建时间: 'Created at',
    更新时间: 'Updated at',
    开始时间: 'Start time',
    结束时间: 'End time',
  },
  all: {},
}

GLOSSARY_PRESETS.all = {
  ...GLOSSARY_PRESETS.ui,
  ...GLOSSARY_PRESETS.business,
}

export async function loadGlossary(cwd = process.cwd()): Promise<Glossary> {
  return readJsonFile<Glossary>(path.join(cwd, '.tmigrate', 'glossary.json'), {})
}

export async function initGlossary(options: InitGlossaryOptions = {}): Promise<InitGlossaryResult> {
  const cwd = options.cwd ?? process.cwd()
  const overrides = {
    ...(options.from ? { sourceLocale: options.from } : {}),
    ...(options.to ? { targetLocale: options.to } : {}),
  }
  const config = await loadConfig(cwd, overrides)
  const sourceLocale = normalizeLocale(config.sourceLocale)
  const targetLocale = normalizeLocale(config.targetLocale)
  const presetName = normalizePresetName(options.preset ?? 'ui')
  const glossaryPath = path.join(cwd, '.tmigrate', 'glossary.json')
  const existing = await loadGlossary(cwd)
  const seed = glossaryPresetForLocalePair(presetName, sourceLocale, targetLocale)
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
    const exact = glossary[`${context}/${text}`]
    if (exact)
      return exact
  }

  const plain = glossary[text]
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
    .filter(term => term.source && !term.source.endsWith('*'))
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

function glossaryPresetForLocalePair(preset: GlossaryPresetName, from: string, to: string): Glossary {
  const zhToEn = GLOSSARY_PRESETS[preset]
  if (from === 'zh' && to === 'en')
    return zhToEn
  if (from === 'en' && to === 'zh')
    return invertGlossary(zhToEn)
  throw new Error(`No built-in glossary preset for ${from}->${to}. Supported pairs: zh->en, en->zh.`)
}

function normalizeLocale(locale: string): string {
  return locale.toLocaleLowerCase().split(/[-_]/)[0] ?? locale
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
