import { describe, expect, it, vi } from 'vitest'
import { formatErrorWithCauses } from '../error-utils'
import { ApiTranslator } from '../translator/api'

describe('error-utils', () => {
  it('formats nested causes with socket metadata', () => {
    const socketError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 11434,
    })
    const fetchError = new TypeError('fetch failed', { cause: socketError })
    const wrapped = new Error('Local translator failed for zh->en (1 text(s), default model source)', { cause: fetchError })

    expect(formatErrorWithCauses(wrapped)).toBe([
      'Local translator failed for zh->en (1 text(s), default model source)',
      'Caused by: TypeError: fetch failed',
      'Caused by: connect ECONNREFUSED 127.0.0.1:11434 (code=ECONNREFUSED, syscall=connect, address=127.0.0.1, port=11434)',
    ].join('\n'))
  })
})

describe('apiTranslator', () => {
  it('adds endpoint context when fetch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    const translator = new ApiTranslator({ endpoint: 'http://127.0.0.1:11434/api/translate', timeout: 1500 })
    await expect(translator.translate(['提交'], { sourceLocale: 'zh', targetLocale: 'en' })).rejects.toThrow(
      'API translator request failed for http://127.0.0.1:11434/api/translate (1 text(s), timeout 1500ms)',
    )

    vi.unstubAllGlobals()
  })
})
