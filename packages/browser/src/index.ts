export { BrowserCacheAdapter } from './cache'
export {
  DOMTranslationCancelledError,
  DOMTranslationInProgressError,
} from './dom-errors'
export { DOMTranslator } from './dom-translator'
export type {
  DOMTranslateProgressEvent,
  DOMTranslatorOptions,
  TextFragment,
  TextGroup,
} from './dom-types'
export { isBrowser, isSSR, isWorker, isWorkerSupported } from './env'
export { Translator } from './translator'
export { ToastUI } from './ui'
export { WorkerTranslator } from './worker-translator'

// Re-export core types and utilities for convenience
export { TranslationResultCache, TranslatorEventEmitter } from '@translation-master/core'
export type {
  CacheAdapter,
  DOMTranslateEvent,
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
