import type { TranslateOptions, TranslateResult, Translator } from '../types'

export class ApiTranslator implements Translator {
  constructor(private readonly options: { apiKey?: string, endpoint?: string } = {}) {}

  async translate(texts: string[], _options: TranslateOptions): Promise<TranslateResult[]> {
    if (!this.options.endpoint) {
      return texts.map(text => ({
        source: text,
        translation: text,
        translationSource: 'machine',
        confidence: 0,
      }))
    }

    throw new Error('API translator endpoint integration is not configured yet.')
  }
}
