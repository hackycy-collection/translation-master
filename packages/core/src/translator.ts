import type { PipelineInstance } from './model-pool'
import type { ModelLoadProgress, ResolvedModel, TranslateOptions, TranslateResult, TranslateResultMinimal, TranslatorOptions } from './types'
import { TranslationResultCache } from './cache'
import { TranslatorEventEmitter } from './event-emitter'
import { detectLanguage, getSupportedLanguages, normalizeLang } from './lang'
import { ModelPool } from './model-pool'
import { ModelRouter } from './model-router'

/**
 * Transformers module loader function.
 * Runtime packages (browser/node) provide their own loader.
 */
export type TransformersLoader = () => Promise<typeof import('@huggingface/transformers')>

export class Translator {
  protected router: ModelRouter
  private pool: ModelPool
  private resultCache: TranslationResultCache
  protected device: TranslatorOptions['device']
  protected dtype: TranslatorOptions['dtype']
  protected autoDetect: boolean
  private debug: boolean
  protected modelBaseUrl?: string
  private transformersModule: typeof import('@huggingface/transformers') | null = null
  private transformersLoader: TransformersLoader | null = null

  /** Event emitter for modelLoad, translate, error events */
  readonly events: TranslatorEventEmitter

  constructor(options?: TranslatorOptions & { transformersLoader?: TransformersLoader }) {
    this.router = new ModelRouter(options?.models)
    this.pool = ModelPool.getShared(options?.maxPoolSize ?? 3)
    this.resultCache = new TranslationResultCache()
    this.device = options?.device ?? 'wasm'
    this.dtype = options?.dtype
    this.autoDetect = options?.autoDetect ?? true
    this.debug = options?.debug ?? false
    this.modelBaseUrl = options?.modelBaseUrl
    this.events = new TranslatorEventEmitter()
    this.transformersLoader = options?.transformersLoader ?? null

    // Backward compat: wire up deprecated onModelLoadProgress
    if (options?.onModelLoadProgress) {
      this.events.on('modelLoad', options.onModelLoadProgress)
    }
  }

  /**
   * Translate text from source language to target language.
   */
  async translate(text: string, options: TranslateOptions): Promise<TranslateResult & TranslateResultMinimal> {
    const startTime = Date.now()
    const to = normalizeLang(options.to)

    // Detect source language
    let from: string
    let confidence: number | undefined
    if (options.from) {
      from = normalizeLang(options.from)
    }
    else if (this.autoDetect) {
      const detected = detectLanguage(text)
      from = detected.lang
      confidence = detected.confidence
    }
    else {
      throw new Error('Source language is required when autoDetect is disabled')
    }

    // Check result cache
    const cached = this.resultCache.get(text, from, to)
    if (cached) {
      const duration = Date.now() - startTime
      this.events.emit('translate', { text, from, to, result: cached, duration, cached: true })
      return { text: cached, from, to, model: 'cache', duration, confidence, cached: true }
    }

    // Resolve model
    const resolved = this.router.resolve(from, to)

    // Translate
    const translatedText = await this.doTranslate(text, resolved, options.signal)

    // Cache result
    this.resultCache.set(text, from, to, translatedText)

    const duration = Date.now() - startTime
    this.events.emit('translate', { text, from, to, result: translatedText, duration, model: resolved.modelId })

    return { text: translatedText, from, to, model: resolved.modelId, duration, confidence }
  }

  /**
   * Translate multiple texts in batch.
   */
  async translateBatch(
    texts: string[],
    options: TranslateOptions,
  ): Promise<TranslateResult[]> {
    const to = normalizeLang(options.to)

    let from: string
    let confidence: number | undefined
    if (options.from) {
      from = normalizeLang(options.from)
    }
    else if (this.autoDetect) {
      // Detect from first text
      const detected = detectLanguage(texts[0] ?? '')
      from = detected.lang
      confidence = detected.confidence
    }
    else {
      throw new Error('Source language is required when autoDetect is disabled')
    }

    const resolved = this.router.resolve(from, to)
    const pipe = await this.getPipeline(resolved)

    const results: TranslateResult[] = []
    const pipeOptions = this.buildPipeOptions(resolved)

    for (const text of texts) {
      const itemStart = Date.now()

      // Check cache first
      const cached = this.resultCache.get(text, from, to)
      if (cached) {
        results.push({
          text: cached,
          from,
          to,
          model: resolved.modelId,
          duration: Date.now() - itemStart,
          confidence,
          cached: true,
        })
        continue
      }

      const output = await pipe(text, pipeOptions)
      const translatedText = this.extractText(output)

      this.resultCache.set(text, from, to, translatedText)

      results.push({
        text: translatedText,
        from,
        to,
        model: resolved.modelId,
        duration: Date.now() - itemStart,
        confidence,
      })
    }

    return results
  }

  /**
   * Detect the language of a text.
   */
  detect(text: string): { lang: string, confidence: number } {
    return detectLanguage(text)
  }

  /**
   * Preload the model for a given language pair.
   */
  async preload(from: string, to: string): Promise<void> {
    const resolved = this.router.resolve(from, to)
    await this.getPipeline(resolved)
  }

  /**
   * Get the list of supported languages.
   */
  getSupportedLanguages(): import('./types').LanguageInfo[] {
    return getSupportedLanguages()
  }

  /**
   * Unload the model for a given language pair.
   */
  async unload(from: string, to: string): Promise<void> {
    const resolved = this.router.resolve(from, to)
    await this.pool.dispose(resolved.modelId)
  }

  /**
   * Clear the in-memory translation result cache.
   */
  clearCache(): void {
    this.resultCache.clear()
  }

  /**
   * Dispose all models, clear caches.
   */
  async dispose(): Promise<void> {
    await this.pool.disposeAll()
    this.resultCache.clear()
    this.events.removeAllListeners()
  }

  /**
   * Get pool statistics.
   */
  stats(): import('./types').PoolStats {
    return this.pool.stats()
  }

  /**
   * Internal: get or load a pipeline.
   */
  private async getPipeline(resolved: ResolvedModel): Promise<PipelineInstance> {
    const tf = await this.loadTransformers()
    const device = await this.resolveDevice(this.device ?? 'wasm')

    const options: Record<string, unknown> = {
      device,
    }
    // Only pass dtype when explicitly set by user — omitting it lets the
    // library auto-select the correct ONNX variant (see transformers.js #1581)
    if (this.dtype) {
      options.dtype = this.dtype
    }

    const progressCallback = (event: unknown): void => {
      const e = event as { status?: string, file?: string, progress?: number }
      const modelEvent = {
        modelId: resolved.modelId,
        progress: e.progress ?? 0,
        state: (e.status ?? 'progress') as ModelLoadProgress['state'],
        file: e.file,
      }
      this.events.emit('modelLoad', modelEvent)
    }

    const pipeline = await this.pool.acquire(
      resolved.modelId,
      'translation',
      options,
      (modelId, _task, opts) => tf.pipeline('translation', modelId, opts) as unknown as Promise<PipelineInstance>,
      progressCallback,
    )

    // Pipeline is fully loaded — emit 'ready' so listeners can react
    this.events.emit('modelLoad', {
      modelId: resolved.modelId,
      progress: 100,
      state: 'ready',
    })

    return pipeline
  }

  /**
   * Internal: perform single text translation.
   */
  private async doTranslate(
    text: string,
    resolved: ResolvedModel,
    signal?: AbortSignal,
  ): Promise<string> {
    // Check abort signal
    if (signal?.aborted) {
      throw new Error('Translation aborted')
    }

    const pipe = await this.getPipeline(resolved)
    const pipeOptions = this.buildPipeOptions(resolved)

    // Create a race between translation and abort
    const translatePromise = pipe(text, pipeOptions)

    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Translation aborted')), { once: true })
      })
      const output = await Promise.race([translatePromise, abortPromise])
      return this.extractText(output)
    }

    const output = await translatePromise
    return this.extractText(output)
  }

  /**
   * Build pipeline options based on resolved model config.
   * Includes generation parameters to prevent degenerate output.
   */
  private buildPipeOptions(resolved: ResolvedModel): Record<string, unknown> {
    const opts: Record<string, unknown> = {
      max_new_tokens: 512,
      no_repeat_ngram_size: 3,
      num_beams: 1,
    }
    if (resolved.requiresLangPrefix) {
      if (resolved.src_lang)
        opts.src_lang = resolved.src_lang
      if (resolved.tgt_lang)
        opts.tgt_lang = resolved.tgt_lang
    }
    return opts
  }

  /**
   * Extract translated text from pipeline output.
   */
  private extractText(output: Array<{ translation_text: string }>): string {
    return output[0]?.translation_text ?? ''
  }

  /**
   * Lazily load the transformers module.
   * Uses the provided loader, or dynamically imports @huggingface/transformers.
   */
  private async loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
    if (!this.transformersModule) {
      if (!this.transformersLoader) {
        throw new Error(
          '[translation-master] No transformers loader provided. '
          + 'Either pass a `transformersLoader` option or use the browser/node package.',
        )
      }
      const tf = await this.transformersLoader()
      if (this.modelBaseUrl) {
        tf.env.allowLocalModels = true
        tf.env.localModelPath = this.modelBaseUrl
      }
      this.transformersModule = tf
    }
    return this.transformersModule
  }

  /**
   * Resolve the device to use for inference.
   * Default: prefer wasm, no auto-detection.
   * Browser package overrides with WebGPU detection.
   */
  protected async resolveDevice(requested: string): Promise<string> {
    if (requested !== 'auto')
      return requested
    return 'wasm'
  }
}
