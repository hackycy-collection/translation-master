import type { MigrateConfigInput } from './config'
import process from 'node:process'
import { cancel, confirm, isCancel, multiselect, select, spinner, text } from '@clack/prompts'
import { getSupportedLanguages } from '@translation-master/core'

const PREFERRED_LOCALE_ORDER = [
  'zh',
  'zh-TW',
  'en',
  'ja',
  'ko',
  'es',
  'fr',
  'de',
  'ru',
  'ar',
  'pt',
  'it',
  'vi',
  'id',
  'tr',
  'hi',
  'th',
  'pl',
  'nl',
  'sv',
  'da',
  'fi',
  'no',
  'cs',
  'el',
  'he',
  'hu',
  'ro',
  'bg',
  'hr',
  'sk',
  'sr',
  'ca',
  'et',
  'lv',
  'lt',
  'bn',
  'ta',
  'te',
  'ml',
  'mr',
  'ur',
  'sw',
] as const

export async function promptInitConfig(defaults: MigrateConfigInput): Promise<MigrateConfigInput> {
  const localeOptions = getInitLocaleOptions()

  const sourceLocale = await select({
    message: 'Source locale',
    initialValue: defaults.sourceLocale ?? 'zh',
    options: localeOptions,
  })
  assertPromptValue(sourceLocale)

  const targetLocale = await select({
    message: 'Target locale',
    initialValue: defaults.targetLocale ?? 'en',
    options: localeOptions,
  })
  assertPromptValue(targetLocale)

  const fileTypes = await multiselect({
    message: 'File types to scan',
    initialValues: ['vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'html'],
    options: [
      { value: 'vue', label: 'Vue SFC' },
      { value: 'ts', label: 'TypeScript' },
      { value: 'tsx', label: 'TSX' },
      { value: 'js', label: 'JavaScript' },
      { value: 'jsx', label: 'JSX' },
      { value: 'json', label: 'JSON' },
      { value: 'html', label: 'HTML' },
      { value: 'css', label: 'CSS / SCSS / Less' },
      { value: 'md', label: 'Markdown' },
      { value: 'yaml', label: 'YAML' },
    ],
  })
  assertPromptValue(fileTypes)

  const sourceRoot = await text({
    message: 'Source root',
    initialValue: 'src',
    placeholder: 'src',
  })
  assertPromptValue(sourceRoot)

  return {
    sourceLocale,
    targetLocale,
    include: [`${sourceRoot}/**/*.{${expandFileTypes(fileTypes).join(',')}}`],
  }
}

export async function confirmOverwriteTmigrate(): Promise<boolean> {
  const answer = await confirm({
    message: '.tmigrate already exists. Overwrite existing config and glossary?',
    initialValue: false,
  })
  assertPromptValue(answer)
  return answer
}

export function createSpinner() {
  return spinner()
}

export function getInitLocaleOptions() {
  const supported = getSupportedLanguages()
  const byCode = new Map(supported.map(language => [language.code, language]))
  const seen = new Set<string>()
  const options = []

  for (const code of PREFERRED_LOCALE_ORDER) {
    const language = byCode.get(code)
    if (!language)
      continue
    options.push(toPromptOption(language.code, language.name, language.nativeName))
    seen.add(language.code)
  }

  for (const language of supported) {
    if (seen.has(language.code))
      continue
    options.push(toPromptOption(language.code, language.name, language.nativeName))
  }

  return options
}

function assertPromptValue<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel('Cancelled')
    process.exit(0)
  }
}

function toPromptOption(code: string, name: string, nativeName?: string) {
  const label = nativeName && nativeName !== name
    ? `${name} (${code}) · ${nativeName}`
    : `${name} (${code})`

  return { value: code, label }
}

function expandFileTypes(types: string[]): string[] {
  return types.flatMap((type) => {
    if (type === 'css')
      return ['css', 'scss', 'less']
    if (type === 'yaml')
      return ['yaml', 'yml']
    return [type]
  })
}
