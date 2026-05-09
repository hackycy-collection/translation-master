import type { TranslatorOptions } from '@translation-master/core'
import { Translator as CoreTranslator } from '@translation-master/core'

export class Translator extends CoreTranslator {
  constructor(options?: TranslatorOptions) {
    super({
      ...options,
      // Node.js always uses CPU backend
      device: options?.device ?? 'cpu',
      transformersLoader: async () => {
        // Load transformers.js — it will auto-detect onnxruntime-node
        return import('@huggingface/transformers')
      },
    })
  }
}
