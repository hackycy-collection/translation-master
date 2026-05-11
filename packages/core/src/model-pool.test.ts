import { describe, expect, it } from 'vitest'
import { ModelPool } from './model-pool'

describe('modelPool', () => {
  it('marks only first acquisition as freshly loaded', async () => {
    const pool = new ModelPool()
    const loadCalls: string[] = []

    const first = await pool.acquire(
      'model-a',
      'translation',
      {},
      async (modelId) => {
        loadCalls.push(modelId)
        return async () => [{ translation_text: 'ok' }]
      },
    )
    const second = await pool.acquire(
      'model-a',
      'translation',
      {},
      async (modelId) => {
        loadCalls.push(modelId)
        return async () => [{ translation_text: 'ok' }]
      },
    )

    expect(first.freshlyLoaded).toBe(true)
    expect(second.freshlyLoaded).toBe(false)
    expect(loadCalls).toEqual(['model-a'])
  })
})
