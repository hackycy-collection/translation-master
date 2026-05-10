import type { MigrateConfig, Translator } from '../types'
import { ApiTranslator } from './api'
import { LocalTranslator } from './local'

export function createTranslator(config: MigrateConfig): Translator {
  if (config.translator === 'api') {
    return new ApiTranslator({
      apiKey: config.translatorOptions.apiKey,
    })
  }

  return new LocalTranslator({
    modelBaseUrl: config.translatorOptions.modelBaseUrl,
  })
}
