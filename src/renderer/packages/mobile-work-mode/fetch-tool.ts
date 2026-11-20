import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'
import { nativeFetch } from '@/native/native-fetch'

const DEFAULT_MAX_CHARS = 20_000
const MAX_BYTES = 4 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

const FETCH_URL_DESCRIPTION = `Fetch one URL over the network and return its readable text.
Use it for a page the user links to or that a search result points at. HTML pages are reduced to
title + body text (scripts, styles and markup removed); plain text, JSON, Markdown and CSV come back
as-is. Binary files are rejected. Response text is truncated to max_chars.`

const BLOCK_TAGS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

/** Reduces an HTML document to title + readable text without pulling a parser into the bundle. */
export function htmlToReadableText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : ''
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style)[^>]*\/>/gi, ' ')
  const blockPattern = new RegExp(`</?(?:${BLOCK_TAGS.join('|')})[^>]*>`, 'gi')
  body = body.replace(blockPattern, '\n').replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return { title, text }
}

function looksBinary(contentType: string): boolean {
  if (!contentType) return false
  const type = contentType.toLowerCase()
  if (type.startsWith('text/')) return false
  if (/(json|xml|javascript|markdown|csv|yaml|html)/.test(type)) return false
  return /(image|audio|video|font|octet-stream|zip|pdf|wasm)/.test(type)
}

export interface FetchUrlToolOptions {
  fetchImpl?: typeof fetch
  maxChars?: number
}

/** `fetch_url` gives the model a network read that does not depend on a search provider. */
export function createFetchUrlTool(options: FetchUrlToolOptions = {}): ToolSet {
  const fetchImpl = options.fetchImpl ?? nativeFetch
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  return {
    fetch_url: tool({
      description: FETCH_URL_DESCRIPTION,
      inputSchema: z.object({
        url: z.string().url().describe('Absolute http(s) URL to read.'),
        max_chars: z.number().int().min(500).max(200_000).optional().describe('Truncate the returned text to this many characters.'),
      }),
      execute: async ({ url, max_chars }, { abortSignal }) => {
        const target = new URL(url)
        if (target.protocol !== 'http:' && target.protocol !== 'https:')
          throw new Error('fetch_url only supports http and https URLs')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        const onAbort = () => controller.abort()
        abortSignal?.addEventListener('abort', onAbort, { once: true })
        try {
          const response = await fetchImpl(target.href, {
            method: 'GET',
            redirect: 'follow',
            headers: {
              accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
              'user-agent': 'Mozilla/5.0 (compatible; ChatboxFetch/1.0)',
            },
            signal: controller.signal,
          })
          const contentType = response.headers.get('content-type') ?? ''
          if (!response.ok) throw new Error(`fetch_url failed with status ${response.status}${contentType ? ` (${contentType})` : ''}`)
          const buffer = await response.arrayBuffer()
          const bytes = buffer.byteLength
          if (bytes > MAX_BYTES) throw new Error(`fetch_url response is too large (${bytes} bytes)`)
          if (looksBinary(contentType)) throw new Error(`fetch_url cannot read binary content (${contentType})`)
          const raw = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
          const isHtml = /html/i.test(contentType) || (/^\s*<(!doctype|html)/i.test(raw) && !/json/i.test(contentType))
          const limit = max_chars ?? maxChars
          const { title, text: body } = isHtml ? htmlToReadableText(raw) : { title: '', text: raw.trim() }
          const text = body.slice(0, limit)
          const truncated = body.length > text.length
          return {
            url: response.url || target.href,
            status: response.status,
            content_type: contentType,
            title,
            text,
            truncated,
          }
        } finally {
          clearTimeout(timer)
          abortSignal?.removeEventListener('abort', onAbort)
        }
      },
    }),
  }
}
