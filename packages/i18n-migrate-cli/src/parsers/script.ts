import type { FileParser, TextContext, TextSegment, TranslationEntry } from '../types'
import { parse as babelParse } from '@babel/parser'
import { extractQuotedStrings, finalizeSegments, replaceTranslations } from './range'

export const scriptParser: FileParser = {
  supportedExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractScriptSegments(content, filePath, 'script'), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractScriptSegments(content: string, filePath: string, context: TextContext, offset = 0) {
  try {
    babelParse(content, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    })
  }
  catch {
    // Keep extraction resilient for partially valid source files.
  }

  return extractQuotedStrings(content, filePath, context, 'StringLiteral', offset)
    .filter(segment => !isLikelyObjectKey(content, segment.start - offset, segment.end - offset))
}

function isLikelyObjectKey(content: string, start: number, end: number): boolean {
  const before = content.slice(Math.max(0, start - 24), start)
  const after = content.slice(end, end + 12)
  return /[{,]\s*$/.test(before) && /^\s*:/.test(after)
}
