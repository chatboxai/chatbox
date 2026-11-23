// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { CHAT_WALLPAPER_ATTRIBUTE, setChatWallpaperMarker } from './glass-surface'

const globalStyles = readFileSync(path.resolve(process.cwd(), 'src/renderer/static/globals.css'), 'utf8')

describe('chat wallpaper marker', () => {
  test('marks the document root while a wallpaper is shown, so portaled popovers can match it', () => {
    const root = document.createElement('html')

    setChatWallpaperMarker(root, true)
    expect(root.hasAttribute(CHAT_WALLPAPER_ATTRIBUTE)).toBe(true)

    setChatWallpaperMarker(root, false)
    expect(root.hasAttribute(CHAT_WALLPAPER_ATTRIBUTE)).toBe(false)
  })
})

// Rendered behavior is covered by test/automation/web/chat-wallpaper-glass.spec.ts; these only pin the tokens.
describe('glass tokens', () => {
  test('one opacity and one blur token drive every glass tier', () => {
    expect(globalStyles).toMatch(/--chatbox-glass-opacity: 60%;/)
    expect(globalStyles).toMatch(/--chatbox-glass-blur: 16px;/)
  })

  test('sticky bars derive their opacity from the shared glass opacity', () => {
    expect(globalStyles).toMatch(/--chatbox-glass-bar-opacity: calc\([^;]*var\(--chatbox-glass-opacity\)[^;]*\);/)
  })

  test('reduced transparency makes glass near-opaque and drops the blur', () => {
    expect(globalStyles).toMatch(
      /@media \(prefers-reduced-transparency: reduce\) {\s*:root {\s*--chatbox-glass-opacity: 94%;\s*--chatbox-glass-blur: 0px;\s*}\s*}/
    )
  })
})
