import type { ModelLoadProgress, ResolvedModel, TranslateOptions, TranslateResult, TranslatorOptions } from './types'
import { TranslationResultCache } from './cache'
import { resolveDevice } from './env'
import { detectLanguage, getSupportedLanguages, normalizeLang } from './lang'
import { ModelPool } from './model-pool'
import { ModelRouter } from './model-router'

export class Translator {
  private router: ModelRouter
  private pool: ModelPool
  private resultCache: TranslationResultCache
  private device: TranslatorOptions['device']
  private dtype: TranslatorOptions['dtype']
  private autoDetect: boolean
  private progressCallback?: TranslatorOptions['onModelLoadProgress']
  private transformersModule: typeof import('@huggingface/transformers') | null = null

  constructor(options?: TranslatorOptions) {
    this.router = new ModelRouter(options?.models)
    this.pool = new ModelPool(options?.maxPoolSize ?? 3)
    this.resultCache = new TranslationResultCache()
    this.device = options?.device ?? 'auto'
    // Do NOT set a default dtype — transformers.js v3 auto-selects the correct
    // ONNX variant (q8/_quantized.onnx) when dtype is omitted. Passing dtype
    // explicitly triggers bug #1581 which selects the wrong file and produces
    // garbage output.
    this.dtype = options?.dtype
    this.autoDetect = options?.autoDetect ?? true
    this.progressCallback = options?.onModelLoadProgress
  }

  /**
   * Translate text from source language to target language.
   */
  async translate(text: string, options: TranslateOptions): Promise<TranslateResult> {
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
      return {
        text: cached,
        from,
        to,
        model: 'cache',
        duration: Date.now() - startTime,
        confidence,
      }
    }

    // Resolve model
    const resolved = this.router.resolve(from, to)

    // Translate
    const translatedText = await this.doTranslate(text, resolved, options.signal)

    // Cache result
    this.resultCache.set(text, from, to, translatedText)

    return {
      text: translatedText,
      from,
      to,
      model: resolved.modelId,
      duration: Date.now() - startTime,
      confidence,
    }
  }

  /**
   * Translate multiple texts in batch.
   */
  async translateBatch(
    texts: string[],
    options: TranslateOptions,
  ): Promise<TranslateResult[]> {
    const startTime = Date.now()
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
      // Check cache first
      const cached = this.resultCache.get(text, from, to)
      if (cached) {
        results.push({
          text: cached,
          from,
          to,
          model: resolved.modelId,
          duration: Date.now() - startTime,
          confidence,
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
        duration: Date.now() - startTime,
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
   * Dispose all models and free resources.
   */
  async dispose(): Promise<void> {
    await this.pool.disposeAll()
    this.resultCache.clear()
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
  private async getPipeline(resolved: ResolvedModel): Promise<any> {
    const tf = await this.loadTransformers()
    const device = await resolveDevice(this.device ?? 'auto')

    const options: Record<string, unknown> = {
      device,
    }
    // Only pass dtype when explicitly set by user — omitting it lets the
    // library auto-select the correct ONNX variant (see transformers.js #1581)
    if (this.dtype) {
      options.dtype = this.dtype
    }

    const progressCallback = (event: unknown): void => {
      if (this.progressCallback) {
        const e = event as { status?: string, file?: string, progress?: number }
        this.progressCallback({
          modelId: resolved.modelId,
          progress: e.progress ?? 0,
          state: (e.status ?? 'progress') as ModelLoadProgress['state'],
          file: e.file,
        })
      }
    }

    return this.pool.acquire(
      resolved.modelId,
      'translation',
      options,
      (modelId, _task, opts) => tf.pipeline('translation', modelId, opts) as any,
      progressCallback,
    )
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
  private extractText(output: unknown): string {
    const result = output as Array<{ translation_text?: string }> | { translation_text?: string }
    if (Array.isArray(result)) {
      return result[0]?.translation_text ?? ''
    }
    return (result as { translation_text?: string }).translation_text ?? ''
  }

  /**
   * Lazily load the @huggingface/transformers module.
   */
  private async loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
    if (!this.transformersModule) {
      this.transformersModule = await import('@huggingface/transformers')
    }
    return this.transformersModule
  }
}
