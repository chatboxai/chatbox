import { BUILT_IN_BROWSER_SCRIPT_HELPERS, type BuiltInBrowserDownload } from '@shared/built-in-browser'
import type { SandboxProvider } from '@shared/sandbox-provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackAgentModeFullAccessBypass } from '@/analytics/agent-mode'
import { AppActionApprovalPausedError } from '@/packages/app-action-approval'
import type { BuiltInBrowser } from '@/platform/interfaces'
import { type BrowserFileAccess, getBuiltInBrowserToolSet } from './built-in-browser'
import { builtInBrowserSkillBody } from './built-in-browser-skill'
import type { ImageToolResults } from './view-image'

vi.mock('@/analytics/agent-mode', () => ({ trackAgentModeFullAccessBypass: vi.fn() }))

type BrowserTool = {
  description: string
  inputSchema: { jsonSchema: { properties: { command: { enum: string[] } } } }
  execute: (
    input: unknown,
    options: {
      abortSignal?: AbortSignal
      toolCallId?: string
      approved?: boolean
      approvalDetails?: { type: 'browser_upload'; version: string }
    }
  ) => Promise<Record<string, unknown>>
  toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => unknown
}

function createBrowser(content: string): BuiltInBrowser {
  return {
    readPage: vi.fn().mockResolvedValue({ page: 'p-1', url: 'https://example.com/final', title: 'Example', content }),
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
  options: { hasParseLink?: boolean; imageResults?: ImageToolResults; fileAccess?: BrowserFileAccess } = {}
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
    expect(browserTool(browser).inputSchema.jsonSchema.properties.command.enum).toEqual([
      'read',
      'snapshot',
      'run',
      'upload',
    ])
    expect(browserTool(browser).description).not.toContain('screenshot')
    expect(vision.inputSchema.jsonSchema.properties.command.enum).toEqual([
      'read',
      'snapshot',
      'run',
      'upload',
      'screenshot',
    ])
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
      page: 'p-1',
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
    expect(output.value).toContain('Page: p-1')
    expect(output.value).toContain('[Content truncated. Showing 500 of 2000 characters.]')
  })

  it('tells the model once the user acted on the page and which earlier runs finished', async () => {
    const browser = createBrowser('Body')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-2',
      url: 'https://example.com/',
      title: 'Example',
      content: 'Body',
      userInteracted: true,
      settledOperations: [{ operationId: 'op_1', status: 'completed', value: 'ok' }],
    })
    const tool = browserTool(browser)
    const input = { command: 'read' }
    const result = await tool.execute(input, {})
    const output = tool.toModelOutput({ toolCallId: 'call', input, output: result }) as { value: string }

    expect(output.value).toContain('Note: The user clicked, typed or scrolled in this page')
    expect(output.value).toContain('Earlier runs finished: [{"operationId":"op_1","status":"completed"')
  })

  it('reads the page left open in the sidebar when no url is given', async () => {
    const browser = createBrowser('Signed-in page.')

    await browserTool(browser).execute({ command: 'read' }, {})

    expect(browser.readPage).toHaveBeenCalledWith({ url: undefined, signal: undefined })
  })
})

describe('browser run command', () => {
  const input = { command: 'run', page: 'p-1', code: 'return document.title' }

  it('runs code on the referenced page with a bounded wait and returns its status', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://example.com/final',
      title: 'Example',
      content: '',
      scriptResult: { operationId: 'op_1', status: 'completed', value: 'Example' },
    })
    const tool = browserTool(browser)
    const result = await tool.execute(input, { toolCallId: 'script' })

    expect(result).toEqual({
      status: 'completed',
      value: 'Example',
      page: 'p-1',
      url: 'https://example.com/final',
    })
    expect(browser.readPage).toHaveBeenCalledWith({
      script: { code: input.code, page: 'p-1' },
      timeoutMs: 5000,
      signal: undefined,
    })
    expect(tool.toModelOutput({ toolCallId: 'script', input, output: result })).toEqual({
      type: 'text',
      value: JSON.stringify(result),
    })
  })

  it('keeps the operation id only for an outcome reported again later', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      url: 'https://example.com/',
      title: 'Example',
      content: '',
      scriptResult: { operationId: 'op_9', status: 'unknown', code: 'timeout', message: 'Still running.' },
    })
    expect(await browserTool(browser).execute(input, {})).toEqual({
      status: 'unknown',
      code: 'timeout',
      message: 'Still running.',
      operationId: 'op_9',
      url: 'https://example.com/',
    })
  })

  it('needs both page and code', async () => {
    const browser = createBrowser('')
    expect(await browserTool(browser).execute({ command: 'run', code: 'return 1' }, {})).toEqual({
      status: 'not_started',
      error: expect.stringContaining('needs page'),
    })
    expect(browser.readPage).not.toHaveBeenCalled()
  })

  it('tells the model to read the page again after the script navigated', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: '',
      url: 'https://example.com/next',
      title: 'Next',
      content: '',
      scriptResult: { operationId: 'op_2', status: 'completed', value: 'Next', navigated: true },
    })
    const output = await browserTool(browser).execute(input, {})
    expect(output).toMatchObject({
      status: 'completed',
      navigated: true,
      next: expect.stringContaining('Read it without a url'),
    })
    expect(output).not.toHaveProperty('page')
  })

  it('passes on a refused run with the navigation that changed the page', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      url: 'https://github.com/o/r/issues/new',
      title: 'New issue',
      content: '',
      scriptResult: { operationId: 'op_3', status: 'not_started', code: 'page_changed', message: 'Read it again.' },
      lastNavigation: { source: 'user', url: 'https://github.com/o/r/issues/new' },
      userInteracted: true,
    })
    expect(await browserTool(browser).execute(input, {})).toEqual({
      status: 'not_started',
      code: 'page_changed',
      message: 'Read it again.',
      url: 'https://github.com/o/r/issues/new',
      lastNavigation: { source: 'user', url: 'https://github.com/o/r/issues/new' },
      note: expect.stringContaining('take priority'),
    })
  })

  it('reports a request the browser rejected as not started', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockRejectedValue(new Error('Browser data is being cleared.'))
    expect(await browserTool(browser).execute(input, {})).toEqual({
      status: 'not_started',
      error: 'Browser data is being cleared.',
    })
  })

  it('does not execute an already cancelled request', async () => {
    const browser = createBrowser('')
    await expect(browserTool(browser).execute(input, { abortSignal: AbortSignal.abort() })).rejects.toThrow()
    expect(browser.readPage).not.toHaveBeenCalled()
  })
})

function localSandbox(workingDirectory: string | null = '/work/session'): SandboxProvider {
  return {
    type: 'local',
    init: vi.fn(async () => ({ success: true })),
    resolveWorkingDirectory: vi.fn(async () => workingDirectory),
    getAcceptedExtraWritableDirs: () => ['/Users/me/project'],
  } as unknown as SandboxProvider
}

describe('browser download events', () => {
  const events: BuiltInBrowserDownload[] = [
    { name: 'blocked.csv', url: 'https://example.com/blocked', status: 'blocked' },
    {
      name: 'slow.csv',
      url: 'https://example.com/slow',
      status: 'saved',
      path: '/work/session/downloads/slow.csv',
      size: 12,
    },
  ]

  it.each(['read', 'run', 'upload'] as const)('exposes queued download events in %s model output', async (command) => {
    const browser = createBrowser('Body')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://example.com/',
      title: 'Example',
      content: 'Body',
      downloads: events,
      scriptResult: { operationId: 'op_run', status: 'completed' },
      uploadResult: { operationId: 'op_upload', status: 'completed' },
    })
    const tool = browserTool(browser)
    const input = { command, page: 'p-1', code: 'return 1', target: 'input[type=file]', files: ['shot.png'] }

    const result = await tool.execute(input, {})
    const output = tool.toModelOutput({ toolCallId: 'events', input, output: result }) as { value: string }

    expect(result.downloads).toEqual(events)
    expect(output.value).toContain(JSON.stringify(events))
    if (command === 'read') expect(output.value).toContain('Downloads: ')
  })

  it('merges queued events with the downloads captured by the current run', async () => {
    const browser = createBrowser('')
    const current: BuiltInBrowserDownload = {
      name: 'current.csv',
      url: 'https://example.com/current',
      status: 'saved',
      path: '/work/session/downloads/current.csv',
    }
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://example.com/',
      title: 'Example',
      content: '',
      downloads: events,
      scriptResult: { operationId: 'op_run', status: 'completed', downloads: [current] },
    })
    const tool = browserTool(browser, { fileAccess: { sessionId: 's1', provider: localSandbox() } })
    const input = { command: 'run', page: 'p-1', code: 'return 1', download: true }

    const result = await tool.execute(input, {})
    const output = tool.toModelOutput({ toolCallId: 'events', input, output: result }) as { value: string }

    expect(result.downloads).toEqual([...events, current])
    expect(JSON.parse(output.value).downloads).toEqual([...events, current])
  })
})

describe('browser snapshot command', () => {
  it('outlines the page with its filters and tells the model how to continue', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://github.com/o/r/pulls',
      title: 'Pull requests',
      content: '- link "Fix login" [e2] url=/o/r/pull/12',
      snapshot: { totalLines: 40, nextCursor: 'p-1@1' },
    })
    const tool = browserTool(browser)
    const input = { command: 'snapshot', query: 'login', scope: 'e1', cursor: 'p-1@0', maxLength: 2000 }

    const result = await tool.execute(input, {})
    const output = tool.toModelOutput({ toolCallId: 'call', input, output: result }) as { value: string }

    expect(browser.readPage).toHaveBeenCalledWith({
      url: undefined,
      snapshot: { scope: 'e1', query: 'login', cursor: 'p-1@0', maxChars: 2000 },
      signal: undefined,
    })
    expect(output.value).toBe(
      [
        'Title: Pull requests',
        'URL: https://github.com/o/r/pulls',
        'Page: p-1',
        'Snapshot:',
        '- link "Fix login" [e2] url=/o/r/pull/12',
        '[Showing 1 of 40 lines. Pass cursor "p-1@1" with the same query and scope to continue.]',
      ].join('\n')
    )
  })

  it('says when only a modal dialog is shown and reports a scope that is gone', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage)
      .mockResolvedValueOnce({
        page: 'p-1',
        url: 'https://example.com/',
        title: 'Example',
        content: '- dialog "Confirm"',
        snapshot: { totalLines: 1, modal: true },
      })
      .mockResolvedValueOnce({
        page: 'p-1',
        url: 'https://example.com/',
        title: 'Example',
        content: '',
        snapshot: { totalLines: 0, error: 'Reference e9 is not on the page anymore.' },
      })
    const tool = browserTool(browser)
    const input = { command: 'snapshot' }
    const modal = await tool.execute(input, {})
    const gone = await tool.execute({ ...input, scope: 'e9' }, {})

    expect((tool.toModelOutput({ toolCallId: 'a', input, output: modal }) as { value: string }).value).toContain(
      'Snapshot of the open modal dialog'
    )
    expect(gone).toMatchObject({ error: 'Reference e9 is not on the page anymore.', page: 'p-1' })
  })

  it('says when a cursor did not match and the outline started over', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://example.com/',
      title: 'Example',
      content: '- button "A" [e1]',
      snapshot: { totalLines: 1, restarted: true },
    })
    const tool = browserTool(browser)
    const input = { command: 'snapshot', cursor: 'p-0~x@4' }
    const output = tool.toModelOutput({ toolCallId: 'a', input, output: await tool.execute(input, {}) }) as {
      value: string
    }
    expect(output.value).toContain('starts from the first line')
  })

  it('points reads of pages without an article to the snapshot command', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://example.com/',
      title: 'Dashboard',
      content: 'Settings',
      readMode: 'text',
    })
    const tool = browserTool(browser)
    const input = { command: 'read' }
    const output = tool.toModelOutput({ toolCallId: 'a', input, output: await tool.execute(input, {}) }) as {
      value: string
    }
    expect(output.value).toContain('Hint: This page was read as its visible text')
  })
})

describe('browser run downloads', () => {
  const input = { command: 'run', page: 'p-1', code: 'document.querySelector("a").click()', download: true }

  it('saves the downloads of a run into the working directory', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
      url: 'https://example.com/',
      title: 'Example',
      content: '',
      scriptResult: {
        operationId: 'op_1',
        status: 'completed',
        downloads: [
          {
            name: 'report.csv',
            status: 'saved',
            path: '/work/session/downloads/report.csv',
            size: 12,
            url: 'https://example.com/report',
          },
        ],
      },
    })
    const tool = browserTool(browser, { fileAccess: { sessionId: 's1', provider: localSandbox() } })

    const result = await tool.execute(input, {})

    expect(browser.readPage).toHaveBeenCalledWith({
      script: { code: input.code, page: 'p-1', downloadDirectory: '/work/session/downloads' },
      timeoutMs: 5000,
      signal: undefined,
    })
    expect(result).toMatchObject({ downloads: [{ name: 'report.csv', status: 'saved' }] })
  })

  it('refuses downloads without a local working directory', async () => {
    const browser = createBrowser('')
    const tool = browserTool(browser, { fileAccess: { sessionId: 's1', provider: localSandbox(null) } })
    expect(await tool.execute(input, {})).toEqual({
      status: 'not_started',
      error: expect.stringContaining('working directory'),
    })
    expect(browser.readPage).not.toHaveBeenCalled()
  })
})

describe('browser upload command', () => {
  const input = { command: 'upload', page: 'p-1', target: 'input[type=file]', files: ['shot.png'] }
  const handed = {
    page: 'p-1',
    url: 'https://github.com/o/r/pull/1',
    title: 'PR',
    content: '',
    uploadResult: {
      operationId: 'op_1',
      status: 'completed' as const,
      message: 'Handed over.',
      files: [{ name: 'shot.png', size: 2048, path: '/work/session/shot.png' }],
    },
  }
  const needsApproval = {
    ...handed,
    page: undefined,
    uploadResult: {
      operationId: 'op_0',
      status: 'not_started' as const,
      code: 'approval_required' as const,
      message: 'Approve.',
      files: [{ name: 'secret.txt', size: 1024, path: '/Users/me/secret.txt' }],
      approvalVersion: 'v1',
    },
  }

  beforeEach(() => vi.mocked(trackAgentModeFullAccessBypass).mockClear())

  it('hands files from the working directories to the page and names the site and files', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue(handed)
    const tool = browserTool(browser, { fileAccess: { sessionId: 's1', provider: localSandbox() } })

    const result = await tool.execute(input, { toolCallId: 'up' })

    expect(browser.readPage).toHaveBeenCalledWith({
      upload: {
        page: 'p-1',
        target: 'input[type=file]',
        files: ['shot.png'],
        baseDirectory: '/work/session',
        allowedRoots: ['/work/session', '/Users/me/project', '/tmp'],
      },
      timeoutMs: 20000,
      signal: undefined,
    })
    expect(result).toEqual({
      status: 'completed',
      message: 'Handed over.',
      files: [{ name: 'shot.png', size: 2048, path: '/work/session/shot.png' }],
      site: 'github.com',
      page: 'p-1',
      url: 'https://github.com/o/r/pull/1',
    })
  })

  it('asks the user before uploading files outside the working directories, showing their canonical paths', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue(needsApproval)
    const tool = browserTool(browser, { fileAccess: { sessionId: 's1', provider: localSandbox() } })

    const paused = tool.execute({ ...input, files: ['notes.txt'] }, { toolCallId: 'up' })

    await expect(paused).rejects.toBeInstanceOf(AppActionApprovalPausedError)
    await expect(paused).rejects.toMatchObject({
      action: 'browser.upload',
      title: 'Upload to github.com',
      preview: 'Page: https://github.com/o/r/pull/1\n/Users/me/secret.txt (1 KB, requested as notes.txt)',
      details: { type: 'browser_upload', version: 'v1' },
    })
    expect(browser.readPage).toHaveBeenCalledTimes(1)
  })

  it('hands over approved files only while they are the files the user approved', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValue(handed)
    const tool = browserTool(browser, { fileAccess: { sessionId: 's1', provider: localSandbox() } })
    const approval = {
      toolCallId: 'up',
      approved: true,
      approvalDetails: { type: 'browser_upload' as const, version: 'v1' },
    }

    await tool.execute(input, approval)
    expect(vi.mocked(browser.readPage).mock.calls[0]?.[0].upload).toMatchObject({
      allowedRoots: ['/work/session', '/Users/me/project', '/tmp'],
      approvedVersion: 'v1',
    })

    // The files changed after the approval: the user is asked again about them as they are now.
    vi.mocked(browser.readPage).mockResolvedValue({
      ...needsApproval,
      uploadResult: { ...needsApproval.uploadResult, approvalVersion: 'v2' },
    })
    await expect(tool.execute(input, approval)).rejects.toMatchObject({
      details: { type: 'browser_upload', version: 'v2' },
    })
  })

  it('lets Full Access skip the approval and records the bypass', async () => {
    const browser = createBrowser('')
    vi.mocked(browser.readPage).mockResolvedValueOnce(needsApproval).mockResolvedValueOnce(handed)
    const tool = browserTool(browser, {
      fileAccess: { sessionId: 's1', provider: localSandbox(), fullAccess: true },
    })

    expect(await tool.execute(input, { toolCallId: 'up' })).toMatchObject({ status: 'completed' })
    expect(vi.mocked(browser.readPage).mock.calls[1]?.[0].upload).toMatchObject({ approvedVersion: 'v1' })
    expect(trackAgentModeFullAccessBypass).toHaveBeenCalledWith({ tool: 'browser_upload' })
  })

  it('preserves download events from both upload attempts when Full Access grants approval', async () => {
    const browser = createBrowser('')
    const blocked: BuiltInBrowserDownload = { name: 'blocked.csv', url: 'https://example.com/file', status: 'blocked' }
    const saved: BuiltInBrowserDownload = {
      name: 'slow.csv',
      url: 'https://example.com/slow',
      status: 'saved',
      path: '/work/session/downloads/slow.csv',
    }
    vi.mocked(browser.readPage)
      .mockResolvedValueOnce({ ...needsApproval, downloads: [blocked] })
      .mockResolvedValueOnce({ ...handed, downloads: [saved] })
    const tool = browserTool(browser, {
      fileAccess: { sessionId: 's1', provider: localSandbox(), fullAccess: true },
    })

    expect(await tool.execute(input, { toolCallId: 'up' })).toMatchObject({ downloads: [blocked, saved] })
  })

  it('needs page, target and files', async () => {
    const browser = createBrowser('')
    expect(await browserTool(browser).execute({ command: 'upload', page: 'p-1', files: ['a'] }, {})).toEqual({
      status: 'not_started',
      error: expect.stringContaining('needs page'),
    })
    expect(browser.readPage).not.toHaveBeenCalled()
  })
})

describe('browser screenshot command', () => {
  it('captures the page, records the image under its final url and returns it as an image', async () => {
    const browser = createBrowser('Body')
    vi.mocked(browser.readPage).mockResolvedValue({
      page: 'p-1',
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
