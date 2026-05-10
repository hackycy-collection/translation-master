import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { extractLines, finalizeSegments, leadingSpaces, replaceTranslations } from './range'

const MARKDOWN_CODE_FENCE_RE = /```[^`]*(?:`(?!``)[^`]*)*```/g

export const markdownParser: FileParser = {
  supportedExtensions: ['.md'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractMarkdownSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractMarkdownSegments(content: string, filePath: string) {
  const masked = content.replace(MARKDOWN_CODE_FENCE_RE, match => ' '.repeat(match.length))
  return extractLines(masked, filePath, 'markdown', 'MarkdownText')
    .map(segment => ({
      ...segment,
      text: content.slice(segment.start, segment.end).trim(),
      start: segment.start + leadingSpaces(content.slice(segment.start, segment.end)),
    }))
}
