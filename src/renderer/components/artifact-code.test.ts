import { describe, expect, it } from 'vitest'
import { appendArtifactMarkdown, createArtifactCode, renderArtifactCode } from './artifact-code'

describe('artifact code aggregation', () => {
  it('keeps the newest complete block for each language across messages', () => {
    const code = createArtifactCode()
    appendArtifactMarkdown(code, 'prose\n```html\n<div>old</div>\n```\n```css\n.old {}\n```')
    appendArtifactMarkdown(code, '```js\noldJs()\n```\n```javascript\nkeepJavascript()\n```')
    appendArtifactMarkdown(code, '```css\n.new {}\n```\n```js\nnewJs()\n```')
    const html = renderArtifactCode(code, '```html\n<div>new</div>\n```')
    expect(html).toContain('<div>new</div>')
    expect(html).toContain('.new {}')
    expect(html).toContain('newJs()')
    expect(html).toContain('keepJavascript()')
    expect(html).not.toContain('old')
    expect(Object.keys(code.blocks)).toHaveLength(4)
    expect(code.currentContent).toBe('')
  })

  it('continues an unfinished fence across messages and leaves the history reusable', () => {
    const code = createArtifactCode()
    appendArtifactMarkdown(code, '```html\n<div>')
    const snapshot = structuredClone(code)
    expect(renderArtifactCode(code, 'first</div>\n```')).toContain('<div>\nfirst</div>')
    expect(renderArtifactCode(code, 'second</div>\n```')).toContain('<div>\nsecond</div>')
    expect(code).toEqual(snapshot)
  })

  it('does not retain prose or render a script without completed HTML', () => {
    const code = createArtifactCode()
    for (let index = 0; index < 1000; index++) appendArtifactMarkdown(code, `ordinary prose ${index}`)
    expect(code).toEqual(createArtifactCode())
    expect(renderArtifactCode(code, '```js\nrun()\n```')).toBe('')
  })
})
