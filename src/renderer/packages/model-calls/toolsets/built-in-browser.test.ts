import { describe, expect, it, vi } from 'vitest'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { getBuiltInBrowserToolSet } from './built-in-browser'

type ExecutableTool = {
  execute: (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<Record<string, unknown>>
  toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => { type: string; value: string }
}

function createBrowser(content: string): BuiltInBrowser {
  return {
    readPage: vi.fn().mockResolvedValue({ url: 'https://example.com/final', title: 'Example', content }),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setView: vi.fn().mockResolvedValue(null),
    getState: vi.fn(),
    onStateChange: vi.fn(),
    clearData: vi.fn(),
  }
}

function toolsOf(browser: BuiltInBrowser) {
  const toolSet = getBuiltInBrowserToolSet(browser, { hasParseLink: true })
  if (!toolSet) throw new Error('expected a toolset')
  return {
    browsePage: toolSet.tools.browse_page as unknown as ExecutableTool,
  }
}

describe('getBuiltInBrowserToolSet', () => {
  it('is unavailable without a built-in browser', () => {
    expect(getBuiltInBrowserToolSet(undefined, { hasParseLink: true })).toBeNull()
  })

  it('puts parse_link first only when it is available', () => {
    const browser = createBrowser('')
    expect(getBuiltInBrowserToolSet(browser, { hasParseLink: true })?.description).toContain(
      'Read pages with parse_link first.'
    )
    expect(getBuiltInBrowserToolSet(browser, { hasParseLink: false })?.description).not.toContain('parse_link')
  })

  it('reads a page through the built-in browser and forwards the abort signal', async () => {
    const browser = createBrowser('  Rendered article body.  ')
    const controller = new AbortController()

    const result = await toolsOf(browser).browsePage.execute(
      { url: 'https://example.com' },
      { abortSignal: controller.signal }
    )

    expect(browser.readPage).toHaveBeenCalledWith({ url: 'https://example.com', signal: controller.signal })
    expect(result).toEqual({
      url: 'https://example.com/final',
      title: 'Example',
      content: 'Rendered article body.',
      originalLength: 'Rendered article body.'.length,
      truncated: false,
    })
  })

  it('truncates long pages and tells the model how much it sees', async () => {
    const { browsePage } = toolsOf(createBrowser('a'.repeat(2_000)))

    const result = await browsePage.execute({ url: 'https://example.com', maxLength: 500 }, {})
    const output = browsePage.toModelOutput({ toolCallId: 'call', input: {}, output: result })

    expect(result).toMatchObject({ originalLength: 2_000, truncated: true })
    expect(output.value).toContain('Title: Example')
    expect(output.value).toContain('[Content truncated. Showing 500 of 2000 characters.]')
  })

  it('reads the page left open in the sidebar when no url is given', async () => {
    const browser = createBrowser('Signed-in page.')

    await toolsOf(browser).browsePage.execute({}, {})

    expect(browser.readPage).toHaveBeenCalledWith({ url: undefined, signal: undefined })
  })

  it('offers only browse_page and tells the model to hand sign-in to the user', () => {
    const toolSet = getBuiltInBrowserToolSet(createBrowser(''), { hasParseLink: false })

    expect(Object.keys(toolSet?.tools ?? {})).toEqual(['browse_page'])
    expect(toolSet?.description).toContain('ask them to do it in the sidebar')
  })
})
