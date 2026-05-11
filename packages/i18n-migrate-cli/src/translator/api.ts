import type { TranslateOptions, TranslateResult, Translator } from '../types'
import { toError } from '../error-utils'

export class ApiTranslator implements Translator {
  constructor(private readonly options: { apiKey?: string, endpoint?: string, timeout?: number } = {}) {}

  async translate(texts: string[], options: TranslateOptions): Promise<TranslateResult[]> {
    if (!this.options.endpoint) {
      return texts.map(text => ({
        source: text,
        translation: text,
        translationSource: 'machine',
        confidence: 0,
      }))
    }

    const endpoint = this.options.endpoint
    const timeout = this.options.timeout ?? 30000

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          texts,
          sourceLocale: options.sourceLocale,
          targetLocale: options.targetLocale,
          glossary: options.glossary,
        }),
        signal: AbortSignal.timeout(timeout),
      })
    }
    catch (error) {
      throw new Error(`API translator request failed for ${endpoint} (${texts.length} text(s), timeout ${timeout}ms)`, {
        cause: toError(error),
      })
    }

    if (!response.ok) {
      const body = await safeReadResponseBody(response)
      throw new Error(`API translator request failed: ${response.status} ${response.statusText} (${endpoint})${body ? `\nResponse: ${body}` : ''}`)
    }

    try {
      return normalizeApiResponse(await response.json(), texts)
    }
    catch (error) {
      throw new Error(`API translator returned an invalid response from ${endpoint}`, {
        cause: toError(error),
      })
    }
  }
}

async function safeReadResponseBody(response: Response): Promise<string> {
  try {
    const body = (await response.text()).trim().replace(/\s+/g, ' ')
    return body.length > 200 ? `${body.slice(0, 200)}...` : body
  }
  catch {
    return ''
  }
}

function normalizeApiResponse(payload: unknown, texts: string[]): TranslateResult[] {
  const values = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.translations)
      ? payload.translations
      : undefined

  if (!values)
    throw new Error('API translator response must be an array or { translations: [...] }.')

  return texts.map((text, index) => {
    const value = values[index]
    if (typeof value === 'string') {
      return {
        source: text,
        translation: value,
        translationSource: 'machine',
      }
    }
    if (isRecord(value) && typeof value.translation === 'string') {
      return {
        source: typeof value.source === 'string' ? value.source : text,
        translation: value.translation,
        translationSource: value.translationSource === 'glossary' ? 'glossary' : 'machine',
        confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
      }
    }
    throw new Error(`API translator response item at index ${index} is invalid.`)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
