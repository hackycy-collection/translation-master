import type { TranslationEntry } from '../types'
import { describe, expect, it } from 'vitest'
import { Extractor } from '../extractor'
import { Replacer } from '../replacer'

const config = {
  sourceLocale: 'zh',
  targetLocale: 'en',
  include: [],
  exclude: [],
  rules: [],
  translator: 'local' as const,
  translatorOptions: {
    timeout: 30000,
    retries: 3,
    concurrency: 5,
  },
  batchSize: 20,
}

const expression = `$${'{name}'}`
const plainExpression = `$${'{value}'}`

describe('replacer syntax-aware writeback', () => {
  it('escapes translations for script string delimiters', () => {
    const content = [
      'export const title = \'账号安全\'',
      'export const copy = "保存路径"',
      'export const plain = \'普通字符串\'',
      `export const message = \`你好 ${expression}\``,
    ].join('\n')

    const next = replace(content, 'src/security.ts', [
      ['账号安全', 'Account\'s secure.'],
      ['保存路径', 'C:\\Users\\Tom "Home"'],
      ['普通字符串', `Keep ${plainExpression}'s text`],
      [`你好 ${expression}`, `Hello ${expression}\``],
    ])

    expect(next).toContain('export const title = \'Account\\\'s secure.\'')
    expect(next).toContain('export const copy = "C:\\\\Users\\\\Tom \\"Home\\""')
    expect(next).toContain(`export const plain = 'Keep ${plainExpression}\\'s text'`)
    expect(next).toContain(`export const message = \`Hello ${expression}\\\`\``)
  })

  it('escapes translations for data and markup formats', () => {
    expect(replace('{"title":"账号安全"}', 'src/copy.json', [
      ['账号安全', 'Account\'s "secure"\nNow'],
    ])).toBe('{"title":"Account\'s \\"secure\\"\\nNow"}')

    expect(replace('<button title=\'账号安全\'>保存当前值</button>', 'src/App.html', [
      ['账号安全', 'Account\'s <secure> & ready'],
      ['保存当前值', 'Save < current & continue'],
    ])).toBe('<button title=\'Account&#39;s &lt;secure&gt; &amp; ready\'>Save &lt; current &amp; continue</button>')

    expect(replace('.badge::after { content: "账号安全"; }', 'src/badge.css', [
      ['账号安全', 'Account "secure"\nready'],
    ])).toBe('.badge::after { content: "Account \\"secure\\"\\A ready"; }')
  })

  it('quotes unsafe yaml translations and preserves quoted yaml scalars', () => {
    expect(replace('title: 账号安全\n', 'src/messages.yaml', [
      ['账号安全', 'Account: secure #1'],
    ])).toBe('title: "Account: secure #1"\n')

    expect(replace('title: \'账号安全\'\n', 'src/messages.yaml', [
      ['账号安全', 'Account\'s secure.'],
    ])).toBe('title: \'Account\'\'s secure.\'\n')
  })
})

function replace(content: string, filePath: string, translations: Array<[string, string]>): string {
  const extractor = new Extractor(config)
  const segments = extractor.extract(content, filePath)
  const entries = new Map(translations.map(([source, translation]) => [source, entry(source, translation)]))
  return new Replacer().replace(content, filePath, segments, entries).content
}

function entry(id: string, translation: string): TranslationEntry {
  return {
    id,
    translation,
    translationSource: 'manual',
    approved: true,
    skip: false,
  }
}
