import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeGlossaryTranslation, initGlossary, initProject, loadGlossary, matchGlossary } from '../index'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('glossary presets', () => {
  it('seeds modular presets with expanded common and business terms', async () => {
    const cwd = await createTempProject()
    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })

    const seeded = await initGlossary({ cwd, preset: 'all' })

    expect(seeded.entries.标题).toBe('Title')
    expect(seeded.entries.订单号).toBe('Order number')
    expect(seeded.entries.发票).toBe('Invoice')
    expect(seeded.entries.购物车).toBe('Cart')
    expect(seeded.entries.手续费).toBe('Handling fee')
    expect(seeded.entries.可用余额).toBe('Available balance')
    expect(seeded.entries.应收账款).toBe('Accounts receivable')
    expect(seeded.entries.微信支付).toBe('WeChat Pay')
    expect(seeded.entries.税后金额).toBe('After-tax amount')
    expect(seeded.entries.元).toBe('Yuan')
  })

  it('matches lowercase English business terms for en to zh projects', async () => {
    const cwd = await createTempProject()
    await initProject({ cwd, overwrite: false, from: 'en', to: 'zh' })
    await initGlossary({ cwd, preset: 'business' })

    const glossary = await loadGlossary(cwd)

    expect(matchGlossary('order', glossary)).toBe('订单')
    expect(matchGlossary('invoice', glossary)).toBe('发票')
    expect(matchGlossary('alipay', glossary)).toBe('支付宝')
    expect(matchGlossary('cny', glossary)).toBe('人民币')
    expect(composeGlossaryTranslation('sales order', glossary)).toBe('销售单')
  })

  it('keeps single-character cjk terms for exact matches without composing partial phrases', () => {
    const glossary = {
      是: 'Yes',
      名称: 'Name',
    }

    expect(matchGlossary('是', glossary)).toBe('Yes')
    expect(composeGlossaryTranslation('是否', glossary)).toBeUndefined()
  })
})

async function createTempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tmigrate-glossary-'))
  tempDirs.push(dir)
  return dir
}
