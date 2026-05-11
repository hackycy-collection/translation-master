import { BUSINESS_ZH_EN } from './business'
import { COMMON_ZH_EN } from './common'
import { UI_ZH_EN } from './ui'

export const GLOSSARY_PRESETS = {
  ui: {
    ...COMMON_ZH_EN,
    ...UI_ZH_EN,
  },
  business: {
    ...COMMON_ZH_EN,
    ...BUSINESS_ZH_EN,
  },
  all: {
    ...COMMON_ZH_EN,
    ...UI_ZH_EN,
    ...BUSINESS_ZH_EN,
  },
} satisfies Record<'ui' | 'business' | 'all', Record<string, string>>
