import { describe, expect, test } from 'vitest'
import { GLASS_SURFACE_CLASS, GLASS_TINT_CLASS } from '@/lib/glass-surface'
import {
  COMPOSER_NOTICE_CLASS_NAME,
  COMPOSER_NOTICE_STYLE,
  INPUT_SURFACE_CLASS_NAME,
  SKILL_MENU_SURFACE_CLASS_NAME,
} from './inputSurface'

describe('composer surface', () => {
  test('is a glass surface over a chat wallpaper, sharing the popover glass rules', () => {
    const classes = INPUT_SURFACE_CLASS_NAME.split(/\s+/)
    expect(classes).toContain('chatbox-composer-surface')
    expect(classes).toContain(GLASS_SURFACE_CLASS)
  })
})

describe('composer popups and notices', () => {
  test('the slash skill list floats as a glass surface', () => {
    expect(SKILL_MENU_SURFACE_CLASS_NAME.split(/\s+/)).toContain(GLASS_SURFACE_CLASS)
  })

  test('warnings inside the composer are tints, with no inline background that would cover the glass', () => {
    expect(COMPOSER_NOTICE_CLASS_NAME.split(/\s+/)).toContain(GLASS_TINT_CLASS)
    expect(COMPOSER_NOTICE_STYLE).not.toHaveProperty('background')
    expect(COMPOSER_NOTICE_STYLE).not.toHaveProperty('backgroundColor')
  })
})
