import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { INPUT_SURFACE_CLASS_NAME } from './inputSurface'

describe('composer surface over a chat wallpaper', () => {
  test('the composer turns translucent and blurred only under the wallpaper marker', () => {
    const globalStyles = readFileSync(path.resolve(process.cwd(), 'src/renderer/static/globals.css'), 'utf8')

    expect(INPUT_SURFACE_CLASS_NAME).toContain('chatbox-composer-surface')
    expect(globalStyles).toMatch(
      /\n\[data-chat-wallpaper\] \.chatbox-composer-surface {\s*background-color: color-mix\(in srgb, var\(--chatbox-background-primary\) 72%, transparent\);\s*-webkit-backdrop-filter: blur\(16px\);\s*backdrop-filter: blur\(16px\);\s*}/
    )
    expect(globalStyles).toMatch(
      /:root\[data-mantine-color-scheme="dark"\] \[data-chat-wallpaper\] \.chatbox-composer-surface {\s*background-color: color-mix\(in srgb, var\(--chatbox-background-composer\) 72%, transparent\);\s*}/
    )
  })
})
