import { describe, expect, test } from 'vitest'
import { resolveComposerMenuLayout, shouldUseComposerTouchLayout } from './composerTouchLayout'

describe('shouldUseComposerTouchLayout', () => {
  test('uses the touch layout on Capacitor mobile at any width', () => {
    expect(
      shouldUseComposerTouchLayout({
        platformType: 'mobile',
        isDesktopLike: false,
        isSmallScreen: false,
        coarsePointer: false,
      })
    ).toBe(true)
  })

  test('uses the touch layout on a narrow viewport', () => {
    expect(
      shouldUseComposerTouchLayout({
        platformType: 'desktop',
        isDesktopLike: true,
        isSmallScreen: true,
        coarsePointer: false,
      })
    ).toBe(true)
  })

  test('uses the touch layout on mobile web tablets with a coarse pointer', () => {
    expect(
      shouldUseComposerTouchLayout({
        platformType: 'web',
        isDesktopLike: false,
        isSmallScreen: false,
        coarsePointer: true,
      })
    ).toBe(true)
  })

  test('keeps the desktop flyout on a wide desktop-web window with a fine pointer', () => {
    expect(
      shouldUseComposerTouchLayout({
        platformType: 'web',
        isDesktopLike: false,
        isSmallScreen: false,
        coarsePointer: false,
      })
    ).toBe(false)
  })

  test('keeps the desktop flyout on a wide Electron window', () => {
    expect(
      shouldUseComposerTouchLayout({
        platformType: 'desktop',
        isDesktopLike: true,
        isSmallScreen: false,
        coarsePointer: false,
      })
    ).toBe(false)
  })
})

describe('resolveComposerMenuLayout', () => {
  test('honors an explicit layout override', () => {
    expect(resolveComposerMenuLayout('touch', false)).toBe('touch')
    expect(resolveComposerMenuLayout('desktop', true)).toBe('desktop')
  })

  test('falls back to the detected layout', () => {
    expect(resolveComposerMenuLayout(undefined, true)).toBe('touch')
    expect(resolveComposerMenuLayout(undefined, false)).toBe('desktop')
  })
})
