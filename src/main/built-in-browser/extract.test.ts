import { describe, expect, it } from 'vitest'
import { articleHtmlToText, extractReadableContent } from './extract'

const paragraph = (index: number) =>
  `<p>Paragraph ${index} explains how the rendered page keeps its structure after extraction, with enough words to count as article text.</p>`

describe('articleHtmlToText', () => {
  it('keeps headings, list items and paragraph breaks', () => {
    const text = articleHtmlToText(
      '<h2>Setup</h2><p>First  step.</p><ul><li>One</li><li>Two</li></ul><p>Done<br>now</p>'
    )
    expect(text).toBe('## Setup\n\nFirst step.\n\n- One\n- Two\n\nDone\nnow')
  })
})

describe('extractReadableContent', () => {
  it('extracts the article body and drops navigation chrome', () => {
    const html = `<!doctype html><html><head><title>Guide - Example</title></head><body>
      <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
      <article><h1>Guide</h1>${Array.from({ length: 8 }, (_, i) => paragraph(i)).join('')}</article>
      <footer>Copyright</footer></body></html>`
    const visibleText = `Home Pricing\nGuide\n${Array.from({ length: 8 }, (_, i) => `Paragraph ${i}`).join('\n')}`

    const result = extractReadableContent({ html, url: 'https://example.com/guide', visibleText })

    expect(result.content).toContain('Paragraph 0 explains')
    expect(result.content).toContain('Paragraph 7 explains')
    expect(result.content).not.toContain('Pricing')
  })

  it('falls back to visible text when there is no article', () => {
    const html = '<!doctype html><html><head><title>Search</title></head><body><div>a</div></body></html>'
    const result = extractReadableContent({
      html,
      url: 'https://example.com/',
      visibleText: 'Result one\n\n\n\nResult two',
    })
    expect(result).toEqual({ content: 'Result one\n\nResult two', mode: 'text' })
  })
})
