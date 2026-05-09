export { FileCacheAdapter } from './cache'
export { isNode } from './env'
export { Translator } from './translator'

// Re-export core types and utilities for convenience
export { TranslationResultCache, TranslatorEventEmitter } from '@translation-master/core'
export type {
  CacheAdapter,
  ErrorEvent,
  LanguageInfo,
  ModelConfig,
  ModelLoadEvent,
  ModelLoadProgress,
  PoolStats,
  ResolvedModel,
  TranslateEvent,
  TranslateOptions,
  TranslateResult,
  TranslateResultMinimal,
  TranslatorOptions,
} from '@translation-master/core'
export {
  detectLanguage,
  DeviceNotAvailableError,
  getSupportedLanguages,
  LANG_TO_FLORES,
  ModelLoadError,
  ModelPool,
  ModelRouter,
  OutOfMemoryError,
  TranslationTimeoutError,
  UnsupportedLanguagePairError,
} from '@translation-master/core'
export type { PipelineInstance } from '@translation-master/core'
