import { describe, expect, it } from 'vitest'
import { buildWorkArtifactPreview, isWorkArtifactPreviewNavigation } from './artifact-preview'

describe('work artifact preview', () => {
  it('keeps document markup inside the sandboxed srcdoc attribute', () => {
    const html = buildWorkArtifactPreview('<script>"&</script><iframe src="https://example.com">')
    expect(html.match(/<iframe /g)).toHaveLength(1)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;&quot;&amp;&lt;/script&gt;')
    expect(html).toContain("frame-src 'none'")
    expect(html).toContain('sandbox="allow-scripts"')
  })
  it('allows only local preview documents and fragment navigation in the native host', () => {
    for (const url of ['about:blank', 'about:srcdoc', 'about:srcdoc#section']) {
      expect(isWorkArtifactPreviewNavigation(url)).toBe(true)
    }
    for (const url of [
      'https://example.com',
      'http://localhost',
      'file:///private',
      'data:text/html,test',
      'about:blank.evil',
    ]) {
      expect(isWorkArtifactPreviewNavigation(url)).toBe(false)
    }
  })
})
