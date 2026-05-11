import type { ModelLoadProgress } from '@translation-master/node'
import type { TranslateOptions, TranslateResult, Translator } from '../types'
import { Translator as NodeTranslator } from '@translation-master/node'

export class LocalTranslator implements Translator {
  private readonly translator: NodeTranslator

  constructor(options: { modelBaseUrl?: string, onModelLoadProgress?: (event: ModelLoadProgress) => void } = {}) {
    this.translator = new NodeTranslator({
      autoDetect: false,
      dtype: 'q8',
      modelBaseUrl: options.modelBaseUrl,
    })
    if (options.onModelLoadProgress)
      this.translator.events.on('modelLoad', options.onModelLoadProgress)
  }

  async translate(texts: string[], options: TranslateOptions): Promise<TranslateResult[]> {
    const results = await this.translator.translateBatch(texts, {
      from: options.sourceLocale,
      to: options.targetLocale,
    })

    return results.map((result, index) => ({
      source: texts[index] ?? '',
      translation: result.text,
      translationSource: 'machine',
      confidence: result.confidence,
    }))
  }
}
