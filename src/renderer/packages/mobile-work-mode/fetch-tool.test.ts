import { describe, expect, it, vi } from 'vitest'
import { createFetchUrlTool, htmlToReadableText } from './fetch-tool'

function response(body: string, init: { status?: number; contentType?: string } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
  })
}

async function run(toolset: ReturnType<typeof createFetchUrlTool>, input: unknown) {
  const execute = toolset.fetch_url.execute as unknown as (
    input: unknown,
    context: { abortSignal?: AbortSignal }
  ) => Promise<Record<string, unknown>>
  return execute(input, {})
}

describe('htmlToReadableText', () => {
  it('keeps the title and block structure but drops scripts and styles', () => {
    const html = `<html><head><title> Demo &amp; Co </title><style>body{color:red}</style></head>
      <body><script>alert(1)</script><h1>Welcome</h1><p>Line one</p><p>Line&nbsp;two &lt;ok&gt;</p></body></html>`
    const { title, text } = htmlToReadableText(html)
    expect(title).toBe('Demo & Co')
    expect(text).toBe('Welcome\nLine one\nLine two <ok>')
  })
})

describe('createFetchUrlTool', () => {
  it('returns readable text for HTML pages', async () => {
    const fetchImpl = vi.fn(async () => response('<title>My Server</title><p>Hello there</p>'))
    const toolset = createFetchUrlTool({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await run(toolset, { url: 'https://cf.a0x7fff.site' })
    expect(result).toMatchObject({ status: 200, title: 'My Server', text: 'Hello there', truncated: false })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cf.a0x7fff.site/',
      expect.objectContaining({ method: 'GET', redirect: 'follow' })
    )
  })

  it('passes JSON through untouched', async () => {
    const toolset = createFetchUrlTool({
      fetchImpl: (async () => response('{"ok":true}', { contentType: 'application/json' })) as unknown as typeof fetch,
    })
    const result = await run(toolset, { url: 'https://example.com/data.json' })
    expect(result.text).toBe('{"ok":true}')
    expect(result.title).toBe('')
  })

  it('truncates long output and reports it', async () => {
    const toolset = createFetchUrlTool({
      fetchImpl: (async () => response('x'.repeat(5_000), { contentType: 'text/plain' })) as unknown as typeof fetch,
    })
    const result = await run(toolset, { url: 'https://example.com/big.txt', max_chars: 1_000 })
    expect(String(result.text)).toHaveLength(1_000)
    expect(result.truncated).toBe(true)
  })

  it('rejects non-http schemes, binary payloads and error statuses', async () => {
    const okFetch = (async () => response('ok', { contentType: 'text/plain' })) as unknown as typeof fetch
    const toolset = createFetchUrlTool({ fetchImpl: okFetch })
    await expect(run(toolset, { url: 'ftp://example.com/file' })).rejects.toThrow(/http and https/)
    const binary = createFetchUrlTool({
      fetchImpl: (async () => response('PNG', { contentType: 'image/png' })) as unknown as typeof fetch,
    })
    await expect(run(binary, { url: 'https://example.com/a.png' })).rejects.toThrow(/binary/)
    const failing = createFetchUrlTool({
      fetchImpl: (async () => response('nope', { status: 404 })) as unknown as typeof fetch,
    })
    await expect(run(failing, { url: 'https://example.com/missing' })).rejects.toThrow(/status 404/)
  })
})
