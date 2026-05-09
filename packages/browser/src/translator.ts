import type { TranslatorOptions } from '@translation-master/core'
import type { DOMTranslatorOptions } from './dom-types'
import { Translator as CoreTranslator } from '@translation-master/core'
import { isSSR, isWorker, isWorkerSupported, resolveDevice } from './env'
import { ToastUI } from './ui'

export class Translator extends CoreTranslator {
  /** Built-in toast UI */
  private toastUI: ToastUI | null = null

  /** DOM translator instance (lazy) */
  private _domTranslator: import('./dom-translator').DOMTranslator | null = null

  /** Web Worker translator for off-main-thread inference (lazy) */
  private _workerTranslator: import('./worker-translator').WorkerTranslator | null = null
  private _useWorker: boolean
  private _workerUrl?: URL | string

  constructor(options?: TranslatorOptions & {
    /** Enable built-in toast progress UI, default true */
    ui?: boolean
    /**
     * Run model inference in a Web Worker to keep the main thread free.
     * - `true` — always use worker (throws if Workers unavailable)
     * - `false` — always run on main thread
     * - `'auto'` (default) — use worker when available, fallback to main thread
     */
    useWorker?: boolean | 'auto'
    /**
     * Custom URL for the translation worker script.
     * Only used when useWorker is enabled.
     * Default: auto-resolved from the package's bundled worker entry.
     */
    workerUrl?: URL | string
  }) {
    if (isSSR()) {
      throw new Error(
        '[translation-master] SSR environment detected. Translator requires a browser environment with WebGPU/WASM support. '
        + 'If you are using Next.js/Nuxt, ensure Translator is only instantiated on the client side.',
      )
    }

    super({
      ...options,
      transformersLoader: () => import('@huggingface/transformers'),
    })

    // Determine whether to use Web Worker for inference
    const useWorkerOpt = options?.useWorker ?? 'auto'
    this._useWorker = useWorkerOpt === true
      || (useWorkerOpt === 'auto' && isWorkerSupported() && !isWorker())
    this._workerUrl = options?.workerUrl

    // Toast UI (enabled by default)
    const uiEnabled = options?.ui !== false
    this.toastUI = new ToastUI(this.events, uiEnabled)

    // Wire up deprecated onModelLoadProgress
    if (options?.onModelLoadProgress) {
      this.events.on('modelLoad', options.onModelLoadProgress)
    }
  }

  /**
   * Override device resolution with WebGPU auto-detection for browsers.
   */
  protected override async resolveDevice(requested: string): Promise<string> {
    return resolveDevice(requested as 'auto' | 'wasm' | 'webgpu')
  }

  /**
   * Lazily initialize the worker translator.
   * Returns null if worker mode is disabled.
   */
  private async getWorkerTranslator(): Promise<import('./worker-translator').WorkerTranslator | null> {
    if (!this._useWorker)
      return null

    if (!this._workerTranslator) {
      try {
        const { WorkerTranslator } = await import('./worker-translator')
        this._workerTranslator = new WorkerTranslator({
          device: this.device,
          dtype: this.dtype,
          models: this.router.getConfigs(),
          autoDetect: this.autoDetect,
          workerUrl: this._workerUrl,
          modelBaseUrl: this.modelBaseUrl,
        })
        // Forward events from worker to main event emitter
        this._workerTranslator.events.on('modelLoad', e => this.events.emit('modelLoad', e))
        this._workerTranslator.events.on('translate', e => this.events.emit('translate', e))
        this._workerTranslator.events.on('error', e => this.events.emit('error', e))
      }
      catch {
        // Worker unavailable — fall back to main thread
        this._useWorker = false
        return null
      }
    }

    return this._workerTranslator
  }

  /**
   * Translate the entire page or a specific DOM element.
   */
  async translatePage(options: DOMTranslatorOptions & { root?: Element }): Promise<void> {
    const { DOMTranslator } = await import('./dom-translator')
    if (!this._domTranslator) {
      this._domTranslator = new DOMTranslator(this)
    }

    // Wire up progress events to the event emitter
    const originalOnProgress = options.onProgress
    const wrappedOptions: typeof options = {
      ...options,
      onProgress: (event) => {
        this.events.emit('domTranslate', {
          phase: event.phase,
          translatedGroups: event.translatedGroups ?? 0,
          totalGroups: event.totalGroups ?? 0,
          currentBatch: event.currentBatch,
          totalBatches: event.totalBatches,
        })
        originalOnProgress?.(event)
      },
    }

    return this._domTranslator.translatePage(wrappedOptions)
  }

  /**
   * Restore all DOM content translated by `translatePage()` back to original text.
   */
  restorePage(): void {
    this._domTranslator?.restore()
  }

  /**
   * Start observing DOM changes for automatic incremental translation.
   * Must be called after `translatePage()`.
   */
  startDOMObserver(options?: { debounceMs?: number, root?: Element }): void {
    this._domTranslator?.startObserver(options)
  }

  /**
   * Stop the DOM change observer.
   */
  stopDOMObserver(): void {
    this._domTranslator?.stopObserver()
  }

  /**
   * Cancel an in-progress DOM translation. Already translated nodes are restored.
   */
  cancelPageTranslation(): void {
    this._domTranslator?.cancel()
  }

  /**
   * Dispose all models, clear caches, and remove toast UI.
   */
  override async dispose(): Promise<void> {
    this._domTranslator?.dispose()
    this._domTranslator = null
    if (this._workerTranslator) {
      await this._workerTranslator.dispose()
      this._workerTranslator = null
    }
    this.toastUI?.destroy()
    this.toastUI = null
    await super.dispose()
  }
}
