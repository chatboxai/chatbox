import { BUILT_IN_BROWSER_SCRIPT_HELPERS } from '@shared/built-in-browser'
import { describe, expect, it, vi } from 'vitest'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { getBuiltInBrowserToolSet } from './built-in-browser'
import { builtInBrowserSkillBody } from './built-in-browser-skill'
import type { ImageToolResults } from './view-image'

type BrowserTool = {
  description: string
  inputSchema: { jsonSchema: { properties: { command: { enum: string[] } } } }
  execute: (
    input: unknown,
    options: { abortSignal?: AbortSignal; toolCallId?: string }
  ) => Promise<Record<string, unknown>>
  toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => unknown
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
    dispose: vi.fn(),
  }
}

function createImageResults(): ImageToolResults {
  return {
    reserve: vi.fn(),
    record: vi.fn(async ({ label }) => ({
      file_path: label,
      image_storage_key: 'picture:view-image:session:1',
      media_type: 'image/jpeg',
    })),
    toModelOutput: vi.fn(async () => ({ type: 'text' as const, value: 'image' })),
  }
}

function browserTool(
  browser: BuiltInBrowser,
  options: { hasParseLink?: boolean; imageResults?: ImageToolResults } = {}
): BrowserTool {
  const toolSet = getBuiltInBrowserToolSet(browser, { hasParseLink: options.hasParseLink ?? true, ...options })
  if (!toolSet) throw new Error('expected a toolset')
  return toolSet.tools.browser as unknown as BrowserTool
}

describe('browser tool', () => {
  it('is unavailable without a built-in browser', () => {
    expect(getBuiltInBrowserToolSet(undefined, { hasParseLink: true })).toBeNull()
  })

  it('is one tool whose commands include screenshot only with image results', () => {
    const browser = createBrowser('')
    const textOnly = getBuiltInBrowserToolSet(browser, { hasParseLink: true })
    const vision = browserTool(browser, { imageResults: createImageResults() })

    expect(Object.keys(textOnly?.tools ?? {})).toEqual(['browser'])
    expect(browserTool(browser).inputSchema.jsonSchema.properties.command.enum).toEqual(['read', 'run'])
    expect(browserTool(browser).description).not.toContain('screenshot')
    expect(vision.inputSchema.jsonSchema.properties.command.enum).toEqual(['read', 'run', 'screenshot'])
  })

  it('puts parse_link first only when it is available, points to the skill and hands sign-in to the user', () => {
    const browser = createBrowser('')
    expect(browserTool(browser).description).toContain('prefer parse_link')
    expect(browserTool(browser, { hasParseLink: false }).description).not.toContain('parse_link')
    expect(browserTool(browser).description).toContain('load the built-in-browser skill')
    expect(browserTool(browser).description).toContain('ask them to do it in the sidebar')
  })

  it('reads a page and forwards the abort signal', async () => {
    const browser = createBrowser('  Rendered article body.  ')
    const controller = new AbortController()

    const result = await browserTool(browser).execute(
      { command: 'read', url: 'https://example.com' },
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
    const tool = browserTool(createBrowser('a'.repeat(2_000)))
    const input = { command: 'read', url: 'https://example.com', maxLength: 500 }

    const result = await tool.execute(input, {})
    const output = tool.toModelOutput({ toolCallId: 'call', input, output: result }) as { value: string }

    expect(result).toMatchObject({ originalLength: 2_000, truncated: true })
    expect(output.value).toContain('Title: Example')
    expect(output.value).toContain('[Content truncated. Showing 500 of 2000 characters.]')
  })

  it('reads the page left open in the sidebar when no url is given', async () => {
    const browser = createBrowser('Signed-in page.')

    await browserTool(browser).execute({ command: 'read' }, {})

    expect(browser.readPage).toHaveBeenCalledWith({ url: undefined, signal: undefined })
  })
})

describe('browser run command', () => {
  const input = { command: 'run', url: 'https://example.com/final', code: 'return document.title' }

  it('executes code directly with the expected page and bounded wait', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      url: input.url,
      title: 'Example',
      content: '',
      scriptResult: { value: 'Example', truncated: false },
    })
    const tool = browserTool(browser)
    const result = await tool.execute(input, { toolCallId: 'script' })

    expect(result).toEqual({ url: input.url, value: 'Example', truncated: false })
    expect(browser.readPage).toHaveBeenCalledWith({
      script: { code: input.code, expectedUrl: input.url },
      timeoutMs: 5000,
      signal: undefined,
    })
    expect(tool.toModelOutput({ toolCallId: 'script', input, output: result })).toEqual({
      type: 'text',
      value: JSON.stringify(result),
    })
  })

  it('needs both url and code', async () => {
    const browser = createBrowser('')
    expect(await browserTool(browser).execute({ command: 'run', code: 'return 1' }, {})).toEqual({
      error: 'The run command needs url and code.',
    })
    expect(browser.readPage).not.toHaveBeenCalled()
  })

  it('tells the model to read the page again after the script navigated', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      url: 'https://example.com/next',
      title: 'Next',
      content: '',
      scriptResult: { value: 'Next', truncated: false, navigated: true },
    })
    expect(await browserTool(browser).execute(input, {})).toEqual({
      url: 'https://example.com/next',
      value: 'Next',
      truncated: false,
      navigated: true,
      note: expect.stringContaining('Read it without a url'),
    })
  })

  it('returns execution failures with a no-blind-retry warning', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockRejectedValue(new Error('timed out'))
    expect(await browserTool(browser).execute(input, {})).toEqual({
      error: expect.stringContaining('do not automatically retry side effects'),
    })
  })

  it('does not execute an already cancelled request', async () => {
    const browser = createBrowser('')
    await expect(browserTool(browser).execute(input, { abortSignal: AbortSignal.abort() })).rejects.toThrow()
    expect(browser.readPage).not.toHaveBeenCalled()
  })
})

describe('browser screenshot command', () => {
  it('captures the page, records the image under its final url and returns it as an image', async () => {
    const browser = createBrowser('Body')
    vi.mocked(browser.readPage).mockResolvedValue({
      url: 'https://example.com/final',
      title: 'Example',
      content: 'Body',
      screenshot: { base64Data: 'SlBFRw==', mediaType: 'image/jpeg', width: 800, height: 600 },
    })
    const imageResults = createImageResults()
    const tool = browserTool(browser, { imageResults })
    const controller = new AbortController()
    const input = { command: 'screenshot', url: 'https://example.com' }

    const result = await tool.execute(input, { abortSignal: controller.signal, toolCallId: 'call-1' })

    expect(browser.readPage).toHaveBeenCalledWith({
      url: 'https://example.com',
      screenshot: true,
      signal: controller.signal,
    })
    expect(imageResults.record).toHaveBeenCalledWith({
      toolCallId: 'call-1',
      label: 'https://example.com/final',
      dataUrl: 'data:image/jpeg;base64,SlBFRw==',
    })
    expect(result).toEqual({
      file_path: 'https://example.com/final',
      image_storage_key: 'picture:view-image:session:1',
      media_type: 'image/jpeg',
      url: 'https://example.com/final',
      title: 'Example',
      width: 800,
      height: 600,
    })
    await tool.toModelOutput({ toolCallId: 'call-1', input, output: result })
    expect(imageResults.toModelOutput).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'call-1' }))
  })

  it('reports a missing screenshot as text instead of recording an image', async () => {
    const imageResults = createImageResults()
    const tool = browserTool(createBrowser('Body'), { imageResults })
    const input = { command: 'screenshot' }
    const result = await tool.execute(input, { toolCallId: 'call-1' })

    expect(result.error).toContain('did not return a screenshot')
    expect(imageResults.record).not.toHaveBeenCalled()
    expect(tool.toModelOutput({ toolCallId: 'call-1', input, output: result })).toEqual({
      type: 'text',
      value: expect.stringContaining('did not return a screenshot'),
    })
  })

  it('refuses screenshots without image results', async () => {
    const browser = createBrowser('Body')
    expect(await browserTool(browser).execute({ command: 'screenshot' }, {})).toEqual({
      error: 'Screenshots are not available for this model.',
    })
    expect(browser.readPage).not.toHaveBeenCalled()
  })
})

describe('built-in-browser skill', () => {
  it('documents screenshots only when the screenshot command is offered', () => {
    expect(builtInBrowserSkillBody({ screenshot: true })).toContain('## Screenshots')
    expect(builtInBrowserSkillBody({ screenshot: false })).not.toContain('screenshot')
  })

  it('documents every page helper', () => {
    const body = builtInBrowserSkillBody({ screenshot: false })
    for (const helper of BUILT_IN_BROWSER_SCRIPT_HELPERS) expect(body).toContain(`browser.${helper}(`)
  })
})
