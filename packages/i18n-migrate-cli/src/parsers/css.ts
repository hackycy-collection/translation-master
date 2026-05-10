import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { extractQuotedStrings, finalizeSegments, replaceTranslations } from './range'

export const cssParser: FileParser = {
  supportedExtensions: ['.css', '.scss', '.less'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractStyleSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractStyleSegments(content: string, filePath: string, offset = 0) {
  return extractQuotedStrings(content, filePath, 'style', 'CSSContent', offset)
    .filter(segment => /content\s*:\s*$/.test(content.slice(Math.max(0, segment.start - offset - 32), segment.start - offset - 1)))
}
