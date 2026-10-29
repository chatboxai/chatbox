import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
])

interface DomNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<DomNode>
}

/** Converts article HTML to plain text that keeps headings, list items and paragraph breaks. */
export function articleHtmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  const out: string[] = []

  const walk = (node: DomNode) => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? '').replace(/\s+/g, ' '))
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.nodeName.toUpperCase()
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return
    if (tag === 'BR') {
      out.push('\n')
      return
    }
    const heading = /^H([1-6])$/.exec(tag)
    if (heading) {
      out.push(`\n\n${'#'.repeat(Number(heading[1]))} ${(node.textContent ?? '').trim()}\n\n`)
      return
    }
    if (tag === 'PRE') {
      out.push(`\n\n${node.textContent ?? ''}\n\n`)
      return
    }
    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock) out.push(tag === 'LI' ? '\n- ' : '\n\n')
    for (const child of Array.from(node.childNodes)) walk(child)
    if (isBlock && tag !== 'LI') out.push('\n')
  }

  walk(document.body as unknown as DomNode)
  return out
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extracts the readable body of a rendered page. Falls back to the page's visible text
 * when Readability cannot identify an article (search results, dashboards, feeds).
 */
export function extractReadableContent(params: { html: string; url: string; visibleText: string }): {
  title?: string
  content: string
  mode: 'article' | 'text'
} {
  const visibleText = params.visibleText.replace(/\n{3,}/g, '\n\n').trim()
  try {
    const { document } = parseHTML(params.html)
    const base = document.createElement('base')
    base.setAttribute('href', params.url)
    document.head?.prepend(base)
    const article = new Readability(document as unknown as Document, { charThreshold: 300 }).parse()
    const articleText = article?.content ? articleHtmlToText(article.content) : ''
    // Readability occasionally keeps only a teaser; prefer visible text when it clearly holds more.
    if (articleText && articleText.length * 3 >= Math.min(visibleText.length, 20_000)) {
      return { title: article?.title || undefined, content: articleText, mode: 'article' }
    }
  } catch {
    // Malformed markup: visible text is still a faithful reading of the page.
  }
  return { content: visibleText, mode: 'text' }
}
