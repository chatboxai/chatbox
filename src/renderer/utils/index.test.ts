import { describe, expect, it } from 'vitest'
import { isKeyboardEventComposing } from './index'

describe('isKeyboardEventComposing', () => {
  it('detects native composition events', () => {
    expect(isKeyboardEventComposing({ nativeEvent: { isComposing: true }, keyCode: 13 })).toBe(true)
  })

  it('detects browser IME keyCode fallback', () => {
    expect(isKeyboardEventComposing({ keyCode: 229 })).toBe(true)
  })

  it('allows normal Enter key events', () => {
    expect(isKeyboardEventComposing({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false)
  })
})
