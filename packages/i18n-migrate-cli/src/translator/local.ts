import type { ModelLoadProgress } from '@translation-master/node'
import type { TranslateOptions, TranslateResult, Translator } from '../types'
import { Translator as NodeTranslator } from '@translation-master/node'
import { toError } from '../error-utils'

export class LocalTranslator implements Translator {
  private readonly translator: NodeTranslator
  private readonly modelBaseUrl?: string

  constructor(options: { modelBaseUrl?: string, onModelLoadProgress?: (event: ModelLoadProgress) => void } = {}) {
    this.modelBaseUrl = options.modelBaseUrl
    this.translator = new NodeTranslator({
      autoDetect: false,
      dtype: 'q8',
      modelBaseUrl: options.modelBaseUrl,
    })
    if (options.onModelLoadProgress)
      this.translator.events.on('modelLoad', options.onModelLoadProgress)
  }

  async translate(texts: string[], options: TranslateOptions): Promise<TranslateResult[]> {
    let results
    try {
      results = await this.translator.translateBatch(texts, {
        from: options.sourceLocale,
        to: options.targetLocale,
      })
    }
    catch (error) {
      const source = this.modelBaseUrl
        ? `modelBaseUrl=${this.modelBaseUrl}`
        : 'default model source'
      throw new Error(`Local translator failed for ${options.sourceLocale}->${options.targetLocale} (${texts.length} text(s), ${source})`, {
        cause: toError(error),
      })
    }

    return results.map((result, index) => ({
      source: texts[index] ?? '',
      translation: result.text,
      translationSource: 'machine',
      confidence: result.confidence,
    }))
  }
}
