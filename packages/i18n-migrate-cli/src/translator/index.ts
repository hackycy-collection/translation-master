import type { ModelLoadProgress } from '@translation-master/node'
import type { MigrateConfig, Translator } from '../types'
import { ApiTranslator } from './api'
import { LocalTranslator } from './local'

export interface CreateTranslatorOptions {
  onModelLoadProgress?: (event: ModelLoadProgress) => void
}

export function createTranslator(config: MigrateConfig, options: CreateTranslatorOptions = {}): Translator {
  if (config.translator === 'api' && config.translatorOptions.endpoint) {
    return new ApiTranslator({
      apiKey: config.translatorOptions.apiKey,
      endpoint: config.translatorOptions.endpoint,
      timeout: config.translatorOptions.timeout,
    })
  }

  return new LocalTranslator({
    modelBaseUrl: config.translatorOptions.modelBaseUrl,
    onModelLoadProgress: options.onModelLoadProgress,
  })
}
