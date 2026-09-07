import { describe, expect, it } from 'vitest'
import { matchModelBrand } from './model-logo-patterns'

describe('matchModelBrand', () => {
  it('matches MiMo model ids to the Xiaomi brand', () => {
    expect(matchModelBrand('mimo-v2.5')).toBe('xiaomi')
    expect(matchModelBrand('mimo-v2.5-pro')).toBe('xiaomi')
    expect(matchModelBrand('xiaomi/mimo-v2-flash')).toBe('xiaomi')
  })

  it('matches LongCat model ids to the LongCat brand', () => {
    expect(matchModelBrand('LongCat-2.0')).toBe('longcat')
    expect(matchModelBrand('meituan/longcat-2.0')).toBe('longcat')
  })
})
