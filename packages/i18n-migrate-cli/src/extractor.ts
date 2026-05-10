import type { FileParser, MigrateConfig, TextSegment } from './types'
import path from 'node:path'
import { simpleParser } from './parsers/simple'
import { shouldTranslate } from './utils/filter'

export class Extractor {
  constructor(
    private readonly parser: FileParser = simpleParser,
    private readonly config: MigrateConfig,
  ) {}

  extract(content: string, filePath: string): TextSegment[] {
    const extension = path.extname(filePath).toLowerCase()
    if (!this.parser.supportedExtensions.includes(extension))
      return []

    return this.parser.extract(content, filePath)
      .filter(segment => shouldTranslate({ text: segment.text, context: segment.context }, this.config.rules))
  }
}
