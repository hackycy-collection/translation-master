import type { FileParser, TextSegment, TranslationEntry } from '../types'
import type { RangeSegment } from './range'
import { parse as parseVue } from '@vue/compiler-sfc'
import { extractStyleSegments } from './css'
import { extractHtmlSegments } from './html'
import { finalizeSegments, lineColumn, replaceTranslations } from './range'
import { extractScriptSegments } from './script'

export const vueParser: FileParser = {
  supportedExtensions: ['.vue'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractVueSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractVueSegments(content: string, filePath: string): RangeSegment[] {
  const { descriptor } = parseVue(content, { sourceMap: true })
  const segments: RangeSegment[] = []

  if (descriptor.template) {
    const offset = descriptor.template.loc.start.offset
    segments.push(...extractHtmlSegments(descriptor.template.content, filePath, offset, 'template'))
  }

  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) {
      const offset = block.loc.start.offset
      segments.push(...extractScriptSegments(block.content, filePath, 'script', offset))
    }
  }

  for (const style of descriptor.styles) {
    const offset = style.loc.start.offset
    segments.push(...extractStyleSegments(style.content, filePath, offset))
  }

  return segments.map((segment) => {
    const position = lineColumn(content, segment.start)
    return {
      ...segment,
      line: position.line,
      column: position.column,
    }
  })
}
