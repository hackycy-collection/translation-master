import type { FileParser, TextSegment, TranslationEntry } from '../types'
import YAML from 'yaml'
import { extractLines, finalizeSegments, leadingSpaces, replaceTranslations } from './range'

export const yamlParser: FileParser = {
  supportedExtensions: ['.yaml', '.yml'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractYamlSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractYamlSegments(content: string, filePath: string) {
  try {
    YAML.parse(content)
  }
  catch {
    return []
  }
  return extractLines(content, filePath, 'yaml-value', 'YAMLScalar')
    .map((segment) => {
      const colonIndex = segment.text.indexOf(':')
      if (colonIndex === -1)
        return segment
      const rawValue = segment.text.slice(colonIndex + 1)
      const trimmedValue = rawValue.trim()
      const quote = trimmedValue[0]
      const quoted = (quote === '\'' || quote === '"') && trimmedValue.endsWith(quote)
      const text = quoted ? trimmedValue.slice(1, -1) : trimmedValue
      const start = segment.start + colonIndex + 1 + leadingSpaces(rawValue) + (quoted ? 1 : 0)
      return {
        ...segment,
        text,
        start,
        end: start + text.length,
      }
    })
    .filter(segment => segment.text.trim())
}
