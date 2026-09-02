import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

function readRendererSource(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), 'src/renderer', relativePath), 'utf8')
}

describe('global scrollbar defaults', () => {
  test('leaves global scrollbars to the browser and operating system', () => {
    const entrySource = readRendererSource('index.tsx')
    const indexStyles = readRendererSource('static/index.css')
    const globalStyles = readRendererSource('static/globals.css')
    const unscopedScrollbarGeometry =
      /^\s*(?:(?:\*|html|body)\s*)?::(?:-webkit-)?scrollbar\s*{[^}]*(?:width|height|display)\s*:/ms

    expect(entrySource).not.toContain("import './setup/scrollbar_visibility'")
    expect(indexStyles).not.toContain('scrollbar-scrolling')
    expect(indexStyles).not.toMatch(unscopedScrollbarGeometry)
    expect(globalStyles).not.toMatch(unscopedScrollbarGeometry)
  })

  test('keeps native scrollbar surfaces transparent', () => {
    const indexStyles = readRendererSource('static/index.css')

    expect(indexStyles).toMatch(
      /::-webkit-scrollbar,\s*::-webkit-scrollbar-track,\s*::-webkit-scrollbar-corner\s*{\s*background: transparent;/
    )
    expect(indexStyles).toMatch(
      /::-webkit-scrollbar-thumb\s*{[^}]*background-color: color-mix\(in srgb, var\(--chatbox-tint-secondary\) 70%, transparent\);/s
    )
  })

  test('keeps explicitly scoped scrollbar behavior', () => {
    const globalStyles = readRendererSource('static/globals.css')

    expect(globalStyles).toContain('.katex-display::-webkit-scrollbar')
    expect(globalStyles).toContain('.scrollbar-custom::-webkit-scrollbar')
  })

  test('keeps display math wide enough for equation tags', () => {
    const globalStyles = readRendererSource('static/globals.css')

    expect(globalStyles).toMatch(/\.katex-display\s*>\s*\.katex\s*\{[^}]*min-width:\s*100%;/s)
  })
})
