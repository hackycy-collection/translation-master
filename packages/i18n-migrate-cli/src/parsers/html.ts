import type { FileParser, TextContext, TextSegment, TranslationEntry } from '../types'
import type { RangeSegment } from './range'
import { hasChinese } from '../utils/chinese-detector'
import { dedupeSegments, finalizeSegments, leadingSpaces, lineColumn, replaceTranslations } from './range'

export const htmlParser: FileParser = {
  supportedExtensions: ['.html'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractHtmlSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractHtmlSegments(content: string, filePath: string, offset = 0, textContext: TextContext = 'html-text'): RangeSegment[] {
  return [
    ...extractHtmlText(content, filePath, offset, textContext),
    ...extractHtmlAttrs(content, filePath, offset),
  ]
}

function extractHtmlText(content: string, filePath: string, offset: number, context: TextContext): RangeSegment[] {
  const segments: RangeSegment[] = []
  let cursor = 0
  while (cursor < content.length) {
    const startTagEnd = content.indexOf('>', cursor)
    if (startTagEnd === -1)
      break
    const endTagStart = content.indexOf('<', startTagEnd + 1)
    if (endTagStart === -1)
      break
    const raw = content.slice(startTagEnd + 1, endTagStart)
    const trimmed = raw.trim()
    if (hasChinese(trimmed)) {
      const leading = leadingSpaces(raw)
      const textStart = startTagEnd + 1 + leading
      const position = lineColumn(content, textStart)
      segments.push({
        text: trimmed,
        start: offset + textStart,
        end: offset + textStart + trimmed.length,
        line: position.line,
        column: position.column,
        context,
        nodeType: 'Text',
      })
    }
    cursor = endTagStart + 1
  }
  return dedupeSegments(segments, filePath)
}

function extractHtmlAttrs(content: string, filePath: string, offset: number): RangeSegment[] {
  const attrNames = new Set(['title', 'alt', 'placeholder', 'aria-label', 'label'])
  const segments: RangeSegment[] = []
  const attrRe = /\s([\w-]+)=["'][^"']*["']/g
  for (const match of content.matchAll(attrRe)) {
    const name = match[1]
    const rawAttr = match[0]
    if (!name || !attrNames.has(name))
      continue
    const quoteIndex = rawAttr.search(/["']/)
    const raw = rawAttr.slice(quoteIndex + 1, -1)
    if (!hasChinese(raw))
      continue
    const rawIndex = match.index ?? 0
    const textStart = rawIndex + quoteIndex + 1
    const position = lineColumn(content, textStart)
    segments.push({
      text: raw,
      start: offset + textStart,
      end: offset + textStart + raw.length,
      line: position.line,
      column: position.column,
      context: 'html-attr',
      nodeType: 'Attribute',
    })
  }
  return dedupeSegments(segments, filePath)
}
