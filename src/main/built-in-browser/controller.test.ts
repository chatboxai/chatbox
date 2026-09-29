import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BUILT_IN_BROWSER_CHANNELS,
  BUILT_IN_BROWSER_DEFAULT_VIEWPORT,
  EMPTY_BUILT_IN_BROWSER_STATE,
} from '@shared/built-in-browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadLocationOf, PageDownloads, routeDownload } from './page-downloads'

let nextContentsId = 1

/** Runs while an upload checks its files, before the page is touched. */
const uploadHooks = vi.hoisted(() => ({ duringFileCheck: null as (() => void) | null }))
vi.mock('./page-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./page-upload')>()
  return {
    ...actual,
    inspectUploadFiles: async (...args: Parameters<typeof actual.inspectUploadFiles>) => {
      uploadHooks.duringFileCheck?.()
      return await actual.inspectUploadFiles(...args)
    },
  }
})

class FakeContents extends EventEmitter {
  id = nextContentsId++
  url = 'about:blank'
  closed = false
  snapshots: Array<(value: unknown) => void> = []
  captures: Array<(image: unknown) => void> = []
  capturePage = vi.fn(
    () =>
      new Promise((resolve) => {
        this.captures.push(resolve)
      })
  )
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, clear: vi.fn() }
  /** A page debugger whose file input takes any files. */
  debugger = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached() {
      return this.attached
    },
    attach: vi.fn(function (this: { attached: boolean }) {
      this.attached = true
    }),
    detach: vi.fn(function (this: { attached: boolean }) {
      this.attached = false
    }),
    sendCommand: vi.fn(async (method: string, params?: { functionDeclaration?: string }) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'target' } }
      if (method === 'Runtime.callFunctionOn') {
        return String(params?.functionDeclaration).includes('isFileInput')
          ? { result: { objectId: 'input' } }
          : { result: { value: { disabled: false, multiple: true } } }
      }
      return {}
    }),
  })
  reload = vi.fn()
  setWindowOpenHandler = vi.fn()
  isDestroyed = () => this.closed
  isLoading = () => false
  getURL = () => this.url
  getTitle = () => 'Title'
  close = vi.fn(() => {
    this.closed = true
  })
  loadURL = vi.fn((url: string) => {
    this.url = url
    this.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url, initiator: null })
    this.emit('did-navigate')
    return Promise.resolve()
  })
  executeJavaScript = vi.fn(
    () =>
      new Promise((resolve) => {
        this.snapshots.push(resolve)
      })
  )
  /** Finishes the pending snapshot with a page containing `text`. */
  finishSnapshot(text: string) {
    this.snapshots.shift()?.({ url: this.url, title: 'Title', html: `<html><body><p>${text}</p></body></html>`, text })
  }
}

function fakeImage(width: number, height: number) {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: vi.fn(({ width: w, height: h }: { width: number; height: number }) => fakeImage(w, h)),
    toJPEG: () => Buffer.from(`jpeg-${width}x${height}`),
  }
}

const views: Array<{ webContents: FakeContents; visible: boolean; setBounds: ReturnType<typeof vi.fn> }> = []

const captureHosts: Array<{ destroyed: boolean; options: unknown }> = []
const profile = vi.hoisted(() => ({
  clearStorageData: vi.fn(),
  clearCache: vi.fn(),
  clearAuthCache: vi.fn(),
  closeAllConnections: vi.fn(),
}))
type RequestDetails = { webContentsId?: number; method: string; url: string; statusCode?: number; error?: string }
const webRequest = vi.hoisted(() => ({
  responseStarted: [] as Array<(details: RequestDetails) => void>,
  failed: [] as Array<(details: RequestDetails) => void>,
}))

const userData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  return mkdtempSync(path.join(tmpdir(), 'controller-user-data-'))
})

vi.mock('electron', () => {
  class BrowserWindow {
    destroyed = false
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    constructor(public options: unknown) {
      captureHosts.push(this)
    }
    isDestroyed = () => this.destroyed
    destroy = () => {
      this.destroyed = true
    }
  }
  class WebContentsView {
    webContents = new FakeContents()
    setBackgroundColor = vi.fn()
    visible = false
    setVisible = vi.fn((visible: boolean) => {
      this.visible = visible
    })
    getVisible = () => this.visible
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    setBounds = vi.fn((bounds: typeof this.bounds) => {
      this.bounds = bounds
    })
    getBounds = () => this.bounds
    constructor() {
      views.push(this)
    }
  }
  const fakeSession = {
    ...profile,
    getUserAgent: () => 'Mozilla/5.0 Chrome/140 Electron/38.0.0',
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn(),
    webRequest: {
      onResponseStarted: (listener: (details: RequestDetails) => void) => webRequest.responseStarted.push(listener),
      onErrorOccurred: (listener: (details: RequestDetails) => void) => webRequest.failed.push(listener),
    },
  }
  return {
    app: { getPath: () => userData },
    BrowserWindow,
    WebContentsView,
    session: { fromPartition: () => fakeSession },
  }
})

class FakeHost extends EventEmitter {
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  webContents = { send: vi.fn(), isDestroyed: () => false }
  isDestroyed = () => false
}

const { BuiltInBrowserController } = await import('./controller')
const { BUSY_WINDOW_MS } = await import('./page-tracker')

/** Navigation listeners every view keeps: its page tracker's. */
const VIEW_NAVIGATION_LISTENERS = 1
type Host = Parameters<InstanceType<typeof BuiltInBrowserController>['request']>[0]

/** The page reference a result hands out; a test that needs one fails when it is missing. */
function referenceOf(result: { page?: string }): string {
  if (!result.page) throw new Error('The result carries no page reference.')
  return result.page
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BuiltInBrowserController reads', () => {
  let controller: InstanceType<typeof BuiltInBrowserController>
  let host: FakeHost

  beforeEach(() => {
    views.length = 0
    controller = new BuiltInBrowserController('conversation')
    host = new FakeHost()
  })

  afterEach(() => {
    vi.useRealTimers()
    uploadHooks.duringFileCheck = null
  })

  it('clears website storage, HTTP authentication and pooled connections globally', async () => {
    await controller.clearData()
    for (const method of Object.values(profile)) expect(method).toHaveBeenCalledOnce()
    expect(profile.closeAllConnections.mock.invocationCallOrder[0]).toBeGreaterThan(
      profile.clearAuthCache.mock.invocationCallOrder[0]
    )
  })

  it('initializes hidden pages with a usable viewport and allows the sidebar to replace it', async () => {
    controller.navigate(host as unknown as Host, 'https://example.com/')
    expect(views[0].visible).toBe(false)
    expect(views[0].setBounds).toHaveBeenCalledWith({ x: 0, y: 0, ...BUILT_IN_BROWSER_DEFAULT_VIEWPORT })
    const bounds = { x: 700, y: 20, width: 400, height: 600 }
    await controller.setView(host as unknown as Host, { visible: true, bounds })
    expect(views[0].setBounds).toHaveBeenLastCalledWith(bounds)
  })

  it('reset cancels active scripts, destroys page history and publishes the empty state', async () => {
    controller = new BuiltInBrowserController('a', false)
    controller.navigate(host as unknown as Host, 'https://example.com/')
    const contents = views[0].webContents
    contents.emit('dom-ready')
    const opened = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'open' })
    await flush()
    contents.finishSnapshot('Loaded.')
    const page = referenceOf(await opened)
    const read = controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'pending-script',
      page,
      code: 'await new Promise(() => {})',
    })
    await flush()
    controller.resetPage()
    await expect(read).resolves.toMatchObject({ run: { status: 'unknown', code: 'cancelled' } })
    expect(contents.closed).toBe(true)
    expect(controller.getState()).toEqual(EMPTY_BUILT_IN_BROWSER_STATE)
    expect(host.webContents.send).toHaveBeenCalledWith(BUILT_IN_BROWSER_CHANNELS.state, {
      ...EMPTY_BUILT_IN_BROWSER_STATE,
      sessionId: 'a',
    })
    controller.navigate(host as unknown as Host, 'https://new.example/')
    expect(views).toHaveLength(2)
    expect(controller.getState().canGoBack).toBe(false)
  })

  it('refuses a request of an unknown kind without opening a page', async () => {
    const call = { kind: 'navigate', requestId: 'unknown' } as unknown as Parameters<typeof controller.request>[2]
    await expect(controller.request(host as unknown as Host, 1, call)).rejects.toThrow(
      'Unknown built-in browser request: navigate'
    )
    expect(views).toHaveLength(0)
  })

  it('disposes queued reads before they create a page', async () => {
    const read = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'queued',
      url: 'https://example.com/',
    })
    controller.dispose()
    await expect(read).rejects.toThrow('cancelled')
    expect(views).toHaveLength(0)
  })

  it('disposes its page without closing another conversation', () => {
    const other = new BuiltInBrowserController('other', false)
    controller.navigate(host as unknown as Host, 'https://first.example/')
    other.navigate(host as unknown as Host, 'https://other.example/')
    controller.dispose()
    expect(views[0].webContents.closed).toBe(true)
    expect(views[1].webContents.closed).toBe(false)
    expect(other.getState().url).toBe('https://other.example/')
    expect(host.contentView.removeChildView).toHaveBeenCalledWith(views[0])
    other.dispose()
  })

  let openCount = 0

  /** Opens `url` and reads it, returning the page reference a run needs. */
  async function openPage(url = 'https://example.com/') {
    controller.navigate(host as unknown as Host, url)
    const contents = views[views.length - 1].webContents
    contents.emit('dom-ready')
    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: `open-${++openCount}` })
    await flush()
    contents.finishSnapshot('Loaded.')
    const page = referenceOf(await read)
    contents.executeJavaScript.mockClear()
    return { contents, page }
  }

  function run(page: string, code = 'return 1', extra: { timeoutMs?: number; requestId?: string } = {}) {
    return controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: extra.requestId ?? `run-${++openCount}`,
      timeoutMs: extra.timeoutMs,
      code,
      page,
    })
  }

  it('runs scripts only on the page their reference names', async () => {
    const { contents, page } = await openPage()
    expect(page).toMatch(/^[0-9a-f]{6}-\d+$/)
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'data', truncated: false })
    const result = await run(page, 'return document.title')
    expect(result).toMatchObject({
      page,
      url: 'https://example.com/',
      run: { status: 'completed', value: 'data' },
    })
    expect(result.run?.operationId).toMatch(/^op_[0-9a-f]{8}$/)
    const source = String((contents.executeJavaScript.mock.calls[0] as unknown[])[0])
    expect(source).toContain('return document.title')
    expect(source).toContain(JSON.stringify('https://example.com/'))

    const refused = await run('other-1')
    expect(refused).not.toHaveProperty('page')
    expect(refused.run).toMatchObject({ status: 'not_started', code: 'page_changed' })
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('outlines the page in parts that fit and hands out its reference', async () => {
    const { contents, page } = await openPage()
    const lines = Array.from({ length: 400 }, (_, index) => `- button "Action ${index}" [e${index + 1}]`)
    const snapshot = (cursor?: string) => {
      const read = controller.request(host as unknown as Host, 1, {
        kind: 'snapshot',
        requestId: `snapshot-${++openCount}`,
        query: 'Action',
        ...(cursor ? { cursor } : {}),
        maxChars: 1000,
      })
      return flush().then(() => {
        const source = String((contents.executeJavaScript.mock.calls.at(-1) as unknown[] | undefined)?.[0])
        expect(source).toContain('"query":"Action"')
        contents.snapshots.shift()?.({ url: contents.url, title: 'Title', tree: { lines } })
        return read
      })
    }

    const first = await snapshot()
    expect(first).toMatchObject({ page, snapshot: { totalLines: 400, nextCursor: expect.stringMatching(/@\d+$/) } })
    expect(first.content.length).toBeLessThanOrEqual(1000)
    expect(first.content.startsWith('- button "Action 0" [e1]')).toBe(true)
    const next = await snapshot(first.snapshot?.nextCursor)
    expect(next.content).not.toContain('"Action 0"')
  })

  it('refuses uploads to a changed page or of unusable files before touching the page', async () => {
    const { contents, page } = await openPage()
    const upload = (request: { page: string; files: string[] }) =>
      controller.request(host as unknown as Host, 1, {
        kind: 'upload',
        requestId: `upload-${++openCount}`,
        target: 'input',
        ...request,
      })

    expect((await upload({ page: 'other-1', files: ['/tmp/a.png'] })).upload).toMatchObject({
      status: 'not_started',
      code: 'page_changed',
    })
    expect((await upload({ page, files: ['relative.png'] })).upload).toMatchObject({
      status: 'not_started',
      code: 'file_unavailable',
    })
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('reports an upload whose debugger another client takes after the page was touched as unknown', async () => {
    const { contents, page } = await openPage()
    const directory = mkdtempSync(path.join(tmpdir(), 'controller-upload-takeover-'))
    writeFileSync(path.join(directory, 'shot.png'), 'png')
    const answer = contents.debugger.sendCommand.getMockImplementation()
    if (!answer) throw new Error('The fake debugger has no answers.')
    contents.debugger.sendCommand.mockImplementation(async (method, params) => {
      const result = await answer(method, params)
      if (method === 'Runtime.callFunctionOn' && !String(params?.functionDeclaration).includes('isFileInput')) {
        // The developer tools take the page over once the input was checked.
        contents.debugger.emit('detach')
        contents.debugger.attached = true
      }
      return result
    })

    const result = await controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload-takeover',
      page,
      target: 'input',
      files: ['shot.png'],
      baseDirectory: directory,
      allowedRoots: [directory],
    })

    expect(result.upload).toMatchObject({ status: 'unknown', code: 'debugger_unavailable' })
  })

  it('reports an upload whose page navigated before it was touched as not started', async () => {
    const { contents, page } = await openPage()
    const directory = mkdtempSync(path.join(tmpdir(), 'controller-upload-navigated-'))
    writeFileSync(path.join(directory, 'shot.png'), 'png')
    contents.debugger.sendCommand.mockImplementationOnce(async () => {
      // A navigation commits while the target is looked up, destroying the context it ran in.
      contents.emit('did-navigate')
      throw new Error('Execution context was destroyed.')
    })

    const result = await controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload-navigated',
      page,
      target: 'input',
      files: ['shot.png'],
      baseDirectory: directory,
      allowedRoots: [directory],
    })

    expect(result.upload).toMatchObject({ status: 'not_started', code: 'page_unloaded' })
  })

  it('hands files to the page through its debugger and keeps the page reference', async () => {
    const { contents, page } = await openPage()
    const directory = mkdtempSync(path.join(tmpdir(), 'controller-upload-'))
    writeFileSync(path.join(directory, 'shot.png'), 'png')

    const result = await controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload',
      page,
      target: 'input[type=file]',
      files: ['shot.png'],
      baseDirectory: directory,
      allowedRoots: [directory],
    })

    const canonical = path.join(realpathSync(directory), 'shot.png')
    expect(result).toMatchObject({
      page,
      upload: {
        status: 'completed',
        files: [{ name: 'shot.png', size: 3, path: canonical }],
      },
    })
    expect(contents.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('DOM.setFileInputFiles', {
      objectId: 'input',
      files: [canonical],
    })
  })

  it('does not hand files to a document that replaced the page while the files were checked', async () => {
    const { contents, page } = await openPage()
    const directory = mkdtempSync(path.join(tmpdir(), 'controller-upload-'))
    writeFileSync(path.join(directory, 'shot.png'), 'png')
    uploadHooks.duringFileCheck = () => {
      contents.url = 'https://other.example/'
      contents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false,
        url: contents.url,
        initiator: {},
      })
      contents.emit('did-navigate')
      contents.emit('dom-ready')
    }

    const result = await controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload',
      page,
      target: 'input',
      files: [path.join(directory, 'shot.png')],
      allowedRoots: [directory],
    })

    expect(result.upload).toMatchObject({ status: 'not_started', code: 'page_changed' })
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('refuses a script when its page reloads while the download directory is prepared', async () => {
    const { contents, page } = await openPage()
    const start = PageDownloads.prototype.start
    vi.spyOn(PageDownloads.prototype, 'start').mockImplementationOnce(async function (
      this: PageDownloads,
      destination
    ) {
      const capture = await start.call(this, destination)
      contents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false,
        url: contents.url,
        initiator: {},
      })
      contents.emit('did-navigate')
      contents.emit('dom-ready')
      return capture
    })
    const release = vi.spyOn(PageDownloads.prototype, 'release')
    const result = await controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'download-reload',
      page,
      code: 'document.querySelector("button").click()',
      download: true,
    })
    expect(result.run).toMatchObject({ status: 'not_started', code: 'page_changed' })
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledOnce()
  })

  it('binds an approved upload to the files the user approved', async () => {
    const { contents, page } = await openPage()
    const work = mkdtempSync(path.join(tmpdir(), 'controller-upload-work-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'controller-upload-outside-'))
    const file = path.join(outside, 'report.txt')
    writeFileSync(file, 'v1')
    const upload = (approvedVersion?: string) =>
      controller.request(host as unknown as Host, 1, {
        kind: 'upload',
        requestId: `upload-${++openCount}`,
        page,
        target: 'input',
        files: [file],
        allowedRoots: [work],
        approvedVersion,
      })

    routeDownload(
      { preventDefault: vi.fn() } as unknown as Parameters<typeof routeDownload>[0],
      { getFilename: () => 'blocked.csv', getURL: () => 'https://example.com/blocked.csv' } as unknown as Parameters<
        typeof routeDownload
      >[1],
      contents as unknown as Parameters<typeof routeDownload>[2]
    )
    const waiting = await upload()
    expect(waiting.downloads).toBeUndefined()
    const pending = waiting.upload
    expect(pending).toMatchObject({
      status: 'not_started',
      code: 'approval_required',
      files: [{ name: 'report.txt', path: realpathSync(file) }],
    })
    writeFileSync(file, 'changed')
    expect((await upload(pending?.approvalVersion)).upload).toMatchObject({ code: 'approval_required' })
    expect(contents.debugger.sendCommand).not.toHaveBeenCalled()

    const current = (await upload()).upload?.approvalVersion
    const completed = await upload(current)
    expect(completed.upload).toMatchObject({ status: 'completed' })
    expect(completed.downloads).toEqual([
      { name: 'blocked.csv', status: 'blocked', url: 'https://example.com/blocked.csv' },
    ])
  })

  it('refuses an old reference after a reload of the same url or a same-document url change', async () => {
    const { contents, page } = await openPage()
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: contents.url,
      initiator: null,
    })
    contents.emit('did-navigate')
    contents.emit('dom-ready')
    const refused = await run(page)
    expect(refused).not.toHaveProperty('page')
    expect(refused).toMatchObject({
      url: 'https://example.com/',
      run: { status: 'not_started', code: 'page_changed' },
      lastNavigation: { source: 'unknown', url: 'https://example.com/' },
    })

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'reread' })
    await flush()
    contents.finishSnapshot('Reloaded.')
    const current = referenceOf(await read)
    expect(current).not.toBe(page)
    contents.executeJavaScript.mockClear()
    contents.url = 'https://example.com/#details'
    contents.emit('did-navigate-in-page', {}, contents.url, true)
    await expect(run(current)).resolves.toMatchObject({ run: { code: 'page_changed' } })
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('keeps the reference when the page replaces its history state without a new url', async () => {
    const { contents, page } = await openPage()
    contents.emit('did-navigate-in-page', {}, contents.url, true)
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: '1', truncated: false })
    await expect(run(page)).resolves.toMatchObject({ page, run: { status: 'completed' } })
  })

  it('refuses a run while the page is loading another document and reports who started it', async () => {
    const { contents, page } = await openPage()
    controller.reload()
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: contents.url,
      initiator: null,
    })
    const loading = await run(page)
    expect(loading).not.toHaveProperty('page')
    expect(loading).toMatchObject({
      run: { status: 'not_started', code: 'page_changed', message: expect.stringContaining('loading') },
      lastNavigation: { source: 'user' },
    })
    contents.emit('did-navigate')
    contents.emit('dom-ready')

    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/issues/new',
      initiator: {},
    })
    await expect(run(page)).resolves.toMatchObject({
      lastNavigation: { source: 'page', url: 'https://example.com/issues/new' },
    })
  })

  it('attributes navigations a running script starts to the agent', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => {
      contents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false,
        url: 'https://example.com/results',
        initiator: {},
      })
      contents.url = 'https://example.com/results'
      contents.emit('did-navigate')
      return Promise.resolve({ kind: 'value', value: 'Search', truncated: false })
    })
    const result = await run(page, "return browser.click('button')")
    const source = String((contents.executeJavaScript.mock.calls[0] as unknown[])[0])
    expect(source.indexOf('const browser =')).toBeGreaterThan(-1)
    expect(source.indexOf('const browser =')).toBeLessThan(source.indexOf("return browser.click('button')"))
    expect(result).toMatchObject({
      url: 'https://example.com/results',
      run: { status: 'completed', value: 'Search', navigated: true },
    })
    expect(result.page).not.toBe(page)
    contents.emit('dom-ready')
    await expect(run(page)).resolves.toMatchObject({ lastNavigation: { source: 'agent' } })
    expect(contents.listenerCount('did-start-navigation')).toBe(VIEW_NAVIGATION_LISTENERS)
  })

  it('reports syntax errors without running them, bounds values and separates script errors', async () => {
    const { contents, page } = await openPage()
    await expect(run(page, '}); (async () => {')).resolves.toMatchObject({
      run: { status: 'not_started', code: 'syntax_error', message: expect.stringContaining('syntax error') },
    })
    expect(contents.executeJavaScript).not.toHaveBeenCalled()

    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'x'.repeat(20_000), truncated: false })
    await expect(run(page)).resolves.toMatchObject({
      run: { status: 'completed', value: 'x'.repeat(12_000), truncated: true },
    })

    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 42 })
    await expect(run(page)).resolves.toMatchObject({ run: { status: 'unknown' } })

    contents.executeJavaScript.mockResolvedValueOnce({
      kind: 'error',
      message: 'Failed to fetch',
      violations: [
        { directive: 'connect-src', blocked: 'http://127.0.0.1:9000/shot.png?token=secret' },
        { directive: 'script-src', blocked: 'inline' },
      ],
    })
    await expect(run(page)).resolves.toMatchObject({
      run: {
        status: 'failed',
        message: 'Failed to fetch',
        diagnostics: {
          cspViolations: [
            { directive: 'connect-src', blocked: 'http://127.0.0.1:9000/shot.png' },
            { directive: 'script-src', blocked: 'inline' },
          ],
        },
      },
    })

    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'page_changed' })
    await expect(run(page)).resolves.toMatchObject({ run: { status: 'not_started', code: 'page_changed' } })
  })

  it('reports failed requests of the page during a run without query strings', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => {
      for (const listener of webRequest.responseStarted) {
        listener({
          webContentsId: contents.id,
          method: 'POST',
          url: 'https://api.example/upload?sig=abc',
          statusCode: 403,
        })
        listener({ webContentsId: contents.id, method: 'GET', url: 'https://api.example/ok', statusCode: 200 })
        listener({ webContentsId: contents.id + 1000, method: 'GET', url: 'https://other.example/', statusCode: 500 })
      }
      for (const listener of webRequest.failed) {
        listener({
          webContentsId: contents.id,
          method: 'GET',
          url: 'https://down.example/a',
          error: 'net::ERR_NAME_NOT_RESOLVED',
        })
      }
      return Promise.resolve({ kind: 'value', value: 'done', truncated: false })
    })
    const result = await run(page)
    expect(result.run?.diagnostics).toEqual({
      failedRequests: [
        { method: 'POST', url: 'https://api.example/upload', status: 403 },
        { method: 'GET', url: 'https://down.example/a', error: 'net::ERR_NAME_NOT_RESOLVED' },
      ],
    })
    for (const listener of webRequest.responseStarted) {
      listener({ webContentsId: contents.id, method: 'GET', url: 'https://late.example/', statusCode: 500 })
    }
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'quiet', truncated: false })
    expect((await run(page)).run?.diagnostics).toBeUndefined()
  })

  it('reports a timed out run as unknown, asks it to stop and delivers its final outcome later', async () => {
    const { contents, page } = await openPage()
    let finish: (value: unknown) => void = () => undefined
    contents.executeJavaScript
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValueOnce([{ directive: 'connect-src', blocked: 'https://blocked.example/x?y=1' }])
    vi.useFakeTimers()
    const pending = run(page, 'await submit()', { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1001)
    const timedOut = await pending
    expect(timedOut.run).toMatchObject({
      status: 'unknown',
      code: 'timeout',
      diagnostics: { cspViolations: [{ directive: 'connect-src', blocked: 'https://blocked.example/x' }] },
    })
    const operationId = timedOut.run?.operationId
    const cancelSource = String((contents.executeJavaScript.mock.calls[1] as unknown[])[0])
    expect(cancelSource).toContain(`__chatboxRun_${operationId}`)
    expect(cancelSource).toContain('cancelled = true')

    await expect(run(page)).resolves.toMatchObject({
      run: { status: 'not_started', code: 'busy', message: expect.stringContaining(String(operationId)) },
    })
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(2)

    webRequest.responseStarted[0]({
      webContentsId: contents.id,
      method: 'POST',
      url: 'https://example.com/api?t=1',
      statusCode: 403,
    })
    finish({ kind: 'value', value: 'submitted', truncated: false })
    await vi.advanceTimersByTimeAsync(0)
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'next', truncated: false })
    const next = await run(page)
    expect(next).toMatchObject({
      run: { status: 'completed', value: 'next' },
      settledOperations: [
        {
          operationId,
          status: 'completed',
          value: 'submitted',
          diagnostics: { failedRequests: [{ method: 'POST', url: 'https://example.com/api', status: 403 }] },
        },
      ],
    })
    expect(next.settledOperations?.[0]).not.toHaveProperty('truncated')
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'again', truncated: false })
    expect((await run(page)).settledOperations).toBeUndefined()
  })

  it('lets runs proceed once a stuck run has been busy for the whole window', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ kind: 'value', value: 'after', truncated: false })
    vi.useFakeTimers()
    const pending = run(page, 'await new Promise(() => {})', { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1001)
    await pending
    expect((await run(page)).run?.code).toBe('busy')
    await vi.advanceTimersByTimeAsync(BUSY_WINDOW_MS)
    expect((await run(page)).run).toMatchObject({ status: 'completed', value: 'after' })
  })

  it('keeps collecting failed requests for a run that outlived its busy window', async () => {
    const { contents, page } = await openPage()
    let finishFirst: (value: unknown) => void = () => undefined
    let finishSecond: (value: unknown) => void = () => undefined
    contents.executeJavaScript
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          })
      )
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve
          })
      )
    vi.useFakeTimers()
    const first = run(page, 'await slowUpload()', { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1001)
    const operationId = (await first).run?.operationId
    await vi.advanceTimersByTimeAsync(BUSY_WINDOW_MS)
    const second = run(page, 'return 2', { timeoutMs: 30_000 })
    await vi.advanceTimersByTimeAsync(0)
    finishSecond({ kind: 'value', value: '2', truncated: false })
    await second

    for (const listener of webRequest.failed) {
      listener({
        webContentsId: contents.id,
        method: 'PUT',
        url: 'https://example.com/upload?sig=1',
        error: 'net::ERR_FAILED',
      })
    }
    finishFirst({ kind: 'error', message: 'Upload failed', violations: [] })
    await vi.advanceTimersByTimeAsync(0)
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: '3', truncated: false })
    await expect(run(page)).resolves.toMatchObject({
      settledOperations: [
        {
          operationId,
          status: 'failed',
          diagnostics: {
            failedRequests: [{ method: 'PUT', url: 'https://example.com/upload', error: 'net::ERR_FAILED' }],
          },
        },
      ],
    })
  })

  it('saves a download that begins after a completed run returned and reports it with the next result', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'clicked', truncated: false })
    const pending = controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'slow-export-run',
      timeoutMs: 20_000,
      page,
      code: 'browser.click("#export"); return "clicked"',
      download: true,
    })
    await vi.waitFor(() => expect(contents.executeJavaScript).toHaveBeenCalled())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await vi.advanceTimersByTimeAsync(5_001)
    vi.useRealTimers()
    const returned = await pending
    expect(returned.run).toMatchObject({ status: 'completed' })
    expect(returned.run).not.toHaveProperty('downloads')

    // The server finishes the export a moment later.
    const event = { preventDefault: vi.fn() }
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'export.csv',
      getURL: () => 'https://example.com/export.csv',
      getTotalBytes: () => 3,
      getReceivedBytes: () => 3,
      setSavePath: vi.fn(),
      cancel: vi.fn(),
    })
    routeDownload(
      event as unknown as Parameters<typeof routeDownload>[0],
      item as unknown as Parameters<typeof routeDownload>[1],
      contents as unknown as Parameters<typeof routeDownload>[2]
    )
    expect(event.preventDefault).not.toHaveBeenCalled()
    // Downloads land in the conversation's folder in Chatbox's own data.
    const folder = downloadLocationOf('conversation').directory
    expect(path.dirname(folder)).toBe(path.join(userData, 'browser-downloads'))
    expect(item.setSavePath).toHaveBeenCalledWith(path.join(folder, 'export.csv'))
    item.emit('done', {}, 'completed')

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'after-slow-export' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await expect(read).resolves.toMatchObject({ downloads: [{ name: 'export.csv', status: 'saved' }] })
  })

  it('keeps page events for the next result when an upload is cancelled while its files are checked', async () => {
    const { contents, page } = await openPage()
    contents.emit('input-event', {}, { type: 'mouseDown' })
    const pending = controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload-missing-file',
      page,
      target: 'input',
      files: ['/nowhere/missing.png'],
      allowedRoots: [],
    })
    // Microtasks let the queue start the upload; its file checks need I/O, which comes after them.
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    controller.cancel(1, 'upload-missing-file')
    await expect(pending).resolves.toMatchObject({ upload: { status: 'not_started', code: 'cancelled' } })
    await flush()

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'after-cancelled-upload' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await expect(read).resolves.toMatchObject({ userInteracted: true })
  })

  it('leaves page events for the next result once a timed out upload was answered before its file checks ended', async () => {
    const { contents, page } = await openPage()
    contents.emit('input-event', {}, { type: 'mouseDown' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    uploadHooks.duringFileCheck = () => {
      // The wait runs out while the files are checked, and the user acts on the page after that answer.
      vi.advanceTimersByTime(1_000)
      contents.emit('input-event', {}, { type: 'keyDown' })
    }
    const answer = await controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload-slow-check',
      timeoutMs: 1000,
      page,
      target: 'input',
      files: ['/nowhere/missing.png'],
      allowedRoots: [],
    })
    vi.useRealTimers()
    expect(answer).toMatchObject({ upload: { status: 'not_started', code: 'timeout' }, userInteracted: true })
    await flush()

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'after-slow-check' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await expect(read).resolves.toMatchObject({ userInteracted: true })
  })

  it("uploads the conversation's downloads without approval only while their folder is its own", async () => {
    const { page } = await openPage()
    const { directory } = downloadLocationOf('conversation')
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'report.csv'), 'data')
    const work = mkdtempSync(path.join(tmpdir(), 'controller-own-downloads-work-'))
    const upload = (requestId: string) =>
      controller.request(host as unknown as Host, 1, {
        kind: 'upload',
        requestId,
        page,
        target: 'input',
        files: [path.join(directory, 'report.csv')],
        allowedRoots: [work],
      })

    expect((await upload('own-downloads')).upload.code).not.toBe('approval_required')

    const outside = mkdtempSync(path.join(tmpdir(), 'controller-own-downloads-outside-'))
    writeFileSync(path.join(outside, 'report.csv'), 'secret')
    rmSync(directory, { recursive: true })
    symlinkSync(outside, directory, 'dir')
    expect((await upload('linked-downloads')).upload).toMatchObject({ code: 'approval_required' })
    rmSync(directory)
  })

  it('reports an upload that timed out before touching the page as a timeout', async () => {
    const { contents, page } = await openPage()
    const directory = mkdtempSync(path.join(tmpdir(), 'controller-upload-timeout-'))
    writeFileSync(path.join(directory, 'shot.png'), 'png')
    // A busy page does not answer the lookup of the target.
    contents.debugger.sendCommand.mockImplementationOnce(() => new Promise(() => undefined))

    const result = await controller.request(host as unknown as Host, 1, {
      kind: 'upload',
      requestId: 'upload-busy-page',
      timeoutMs: 1000,
      page,
      target: 'input',
      files: ['shot.png'],
      baseDirectory: directory,
      allowedRoots: [directory],
    })

    expect(result.upload).toMatchObject({ status: 'not_started', code: 'timeout' })
  })

  it('reports a run cancelled while queued as not started', async () => {
    const { contents, page } = await openPage()
    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'slow-read' })
    const queued = run(page, 'return 1', { requestId: 'queued-run' })
    controller.cancel(1, 'queued-run')
    await expect(queued).resolves.toMatchObject({ run: { status: 'not_started', code: 'cancelled' } })
    await flush()
    contents.finishSnapshot('Loaded.')
    await read
    await flush()
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('reports once that the user interacted with the page', async () => {
    const { contents, page } = await openPage()
    contents.emit('input-event', {}, { type: 'mouseMove' })
    contents.executeJavaScript.mockResolvedValue({ kind: 'value', value: '1', truncated: false })
    expect((await run(page)).userInteracted).toBeUndefined()
    contents.emit('input-event', {}, { type: 'mouseDown' })
    expect((await run(page)).userInteracted).toBe(true)
    expect((await run(page)).userInteracted).toBeUndefined()
  })

  it('saves the downloads a timed out run starts before its script ends and reports them later', async () => {
    const { contents, page } = await openPage()
    let finish: (value: unknown) => void = () => undefined
    contents.executeJavaScript
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValueOnce([])
    const pending = controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'slow-export',
      timeoutMs: 1000,
      page,
      code: 'await browser.waitFor(".ready", 8000); document.querySelector("a").click()',
      download: true,
    })
    // The shortest run timeout passes in real time; the grace period after the script is faked.
    expect((await pending).run).toMatchObject({ status: 'unknown', code: 'timeout' })
    vi.useFakeTimers()

    // The script goes on and clicks the export link after the result was returned.
    const setSavePath = vi.fn()
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'export.csv',
      getURL: () => 'https://example.com/export.csv',
      getTotalBytes: () => 3,
      getReceivedBytes: () => 3,
      setSavePath,
      cancel: vi.fn(),
    })
    const event = { preventDefault: vi.fn() }
    routeDownload(
      event as unknown as Parameters<typeof routeDownload>[0],
      item as unknown as Parameters<typeof routeDownload>[1],
      contents as unknown as Parameters<typeof routeDownload>[2]
    )
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(setSavePath).toHaveBeenCalled()
    item.emit('done', {}, 'completed')
    finish({ kind: 'value', value: 'exported', truncated: false })
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'after-export' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await expect(read).resolves.toMatchObject({ downloads: [{ name: 'export.csv', status: 'saved' }] })
  })

  it('leaves a download the user starts after a timed out run to the user', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce([])
    const timedOut = await controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'stuck-export',
      timeoutMs: 1000,
      page,
      code: 'await work()',
      download: true,
    })
    expect(timedOut.run).toMatchObject({ status: 'unknown', code: 'timeout' })

    // The user clicks a download link in the sidebar page.
    contents.emit('input-event', {}, { type: 'mouseDown' })
    const event = { preventDefault: vi.fn() }
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'mine.pdf',
      getURL: () => 'https://example.com/mine.pdf',
      getTotalBytes: () => 3,
      getReceivedBytes: () => 0,
      setSavePath: vi.fn(),
      cancel: vi.fn(),
    })
    routeDownload(
      event as unknown as Parameters<typeof routeDownload>[0],
      item as unknown as Parameters<typeof routeDownload>[1],
      contents as unknown as Parameters<typeof routeDownload>[2]
    )
    expect(event.preventDefault).toHaveBeenCalled()
    expect(item.setSavePath).not.toHaveBeenCalled()
  })

  it('blocks a download that a later read opens while a timed out run still captures', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce([])
    const timedOut = await controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'stuck-download-run',
      timeoutMs: 1000,
      page,
      code: 'await work()',
      download: true,
    })
    expect(timedOut.run).toMatchObject({ status: 'unknown', code: 'timeout' })

    const read = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'read-attachment',
      url: 'https://example.com/attachment',
    })
    await flush()
    const event = { preventDefault: vi.fn() }
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'attachment.pdf',
      getURL: () => 'https://example.com/attachment',
      getTotalBytes: () => 3,
      getReceivedBytes: () => 0,
      setSavePath: vi.fn(),
      cancel: vi.fn(),
    })
    routeDownload(
      event as unknown as Parameters<typeof routeDownload>[0],
      item as unknown as Parameters<typeof routeDownload>[1],
      contents as unknown as Parameters<typeof routeDownload>[2]
    )
    expect(event.preventDefault).toHaveBeenCalled()
    expect(item.setSavePath).not.toHaveBeenCalled()
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Attachment.')
    await read
  })

  it('blocks downloads of a later run that did not ask for them while a timed out run still captures', async () => {
    const { contents, page } = await openPage()
    let finish: (value: unknown) => void = () => undefined
    contents.executeJavaScript
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValueOnce([])
    const timedOut = await controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'slow-download-run',
      timeoutMs: 1000,
      page,
      code: 'await work()',
      download: true,
    })
    expect(timedOut.run).toMatchObject({ status: 'unknown', code: 'timeout' })
    // The script ends, so the page is free again while the capture still waits for late downloads.
    finish({ kind: 'value', value: 'done', truncated: false })
    await flush()

    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'clicked', truncated: false })
    await controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'plain-run',
      page,
      code: 'document.querySelector("a").click()',
    })
    const event = { preventDefault: vi.fn() }
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'other.csv',
      getURL: () => 'https://example.com/other.csv',
      getTotalBytes: () => 3,
      getReceivedBytes: () => 0,
      setSavePath: vi.fn(),
      cancel: vi.fn(),
    })
    routeDownload(
      event as unknown as Parameters<typeof routeDownload>[0],
      item as unknown as Parameters<typeof routeDownload>[1],
      contents as unknown as Parameters<typeof routeDownload>[2]
    )
    expect(event.preventDefault).toHaveBeenCalled()
    expect(item.setSavePath).not.toHaveBeenCalled()
  })

  it('reports a download of a run cancelled while it waits for downloads with the next result', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: 'clicked', truncated: false })
    const pending = controller.request(host as unknown as Host, 1, {
      kind: 'run',
      requestId: 'download-then-cancel',
      timeoutMs: 20_000,
      page,
      code: 'return "clicked"',
      download: true,
    })
    // The script starts once the download folder is ready, so the capture is armed from then on.
    await vi.waitFor(() => expect(contents.executeJavaScript).toHaveBeenCalled())
    // The download finishes, and the user stops the call while the run waits for more.
    const item = Object.assign(new EventEmitter(), {
      getFilename: () => 'report.csv',
      getURL: () => 'https://example.com/report.csv',
      getTotalBytes: () => 3,
      getReceivedBytes: () => 3,
      setSavePath: vi.fn(),
      cancel: vi.fn(),
    })
    routeDownload(
      { preventDefault: vi.fn() } as unknown as Electron.Event,
      item as unknown as Electron.DownloadItem,
      contents as unknown as Electron.WebContents
    )
    item.emit('done', {}, 'completed')
    controller.cancel(1, 'download-then-cancel')
    const cancelled = await pending
    expect(cancelled.downloads).toBeUndefined()

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'after-cancelled-download' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await expect(read).resolves.toMatchObject({ downloads: [{ name: 'report.csv', status: 'saved' }] })
  })

  it('keeps page events for the next result when a run is cancelled', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(null)
    contents.emit('input-event', {}, { type: 'mouseDown' })
    const pending = run(page, 'await new Promise(() => {})', { requestId: 'cancelled-run' })
    await flush()
    controller.cancel(1, 'cancelled-run')
    const cancelled = await pending
    expect(cancelled.run).toMatchObject({ status: 'unknown', code: 'cancelled' })
    expect(cancelled.userInteracted).toBeUndefined()

    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'after-cancel' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await expect(read).resolves.toMatchObject({ userInteracted: true })
  })

  it('settles a run whose document is replaced before it answers and stops observing the page', async () => {
    const { contents, page } = await openPage()
    const listeners = contents.listenerCount('did-navigate')
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined))
    const pending = run(page, "browser.click('a.next'); await browser.waitFor('#result')", { timeoutMs: 30_000 })
    await flush()
    contents.url = 'https://example.com/next'
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: contents.url,
      initiator: {},
    })
    contents.emit('did-navigate')

    const unloaded = await pending
    expect(unloaded).not.toHaveProperty('page')
    expect(unloaded).toMatchObject({ run: { status: 'unknown', code: 'page_unloaded', navigated: true } })
    expect(contents.listenerCount('did-navigate')).toBe(listeners)
    expect(contents.listenerCount('did-start-navigation')).toBe(VIEW_NAVIGATION_LISTENERS)
  })

  it('reports a result the page replaced with nothing as unknown and frees the page', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockResolvedValueOnce(undefined)
    await expect(run(page)).resolves.toMatchObject({ run: { status: 'unknown' } })
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: '1', truncated: false })
    await expect(run(page)).resolves.toMatchObject({ run: { status: 'completed' } })
  })

  it('refuses runs on a page that failed to load', async () => {
    const { contents, page } = await openPage()
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', contents.url, true)
    await expect(run(page)).resolves.toMatchObject({
      run: {
        status: 'not_started',
        code: 'no_page',
        message: expect.stringContaining('Failed to load https://example.com/: ERR_NAME_NOT_RESOLVED'),
      },
    })
    expect(contents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('attributes a popup a running script opens to the agent', async () => {
    const { contents, page } = await openPage()
    const openWindow = contents.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => unknown
    contents.executeJavaScript.mockImplementationOnce(() => {
      openWindow({ url: 'https://example.com/popup' })
      return Promise.resolve({ kind: 'value', value: 'opened', truncated: false })
    })
    await run(page, "browser.click('a[target=_blank]')")
    await expect(run(page)).resolves.toMatchObject({
      run: { code: 'page_changed' },
      lastNavigation: { source: 'agent', url: 'https://example.com/popup' },
    })
  })

  it('keeps the page usable after a navigation that ends without a new document', async () => {
    const { contents, page } = await openPage()
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/export.csv',
      initiator: {},
    })
    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'during-download' })
    await flush()
    contents.emit('did-stop-loading')
    await flush()
    contents.finishSnapshot('Still here.')
    await expect(read).resolves.toMatchObject({ page, content: 'Still here.' })

    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: '1', truncated: false })
    await expect(run(page)).resolves.toMatchObject({ page, run: { status: 'completed' } })
  })

  it('hands out the reference after a run whose navigation ended without a new document', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => {
      contents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false,
        url: 'https://example.com/ping',
        initiator: {},
      })
      contents.emit('did-stop-loading')
      return Promise.resolve({ kind: 'value', value: 'sent', truncated: false })
    })
    await expect(run(page, "await fetch('/ping', { method: 'POST' })")).resolves.toMatchObject({
      page,
      run: { status: 'completed', navigated: true },
    })
  })

  it('keeps the source of a reload when the new document replaces its history state', async () => {
    const { contents, page } = await openPage()
    controller.reload()
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: contents.url,
      initiator: null,
    })
    contents.emit('did-navigate')
    contents.emit('dom-ready')
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: contents.url, initiator: {} })
    contents.emit('did-navigate-in-page', {}, contents.url, true)
    await expect(run(page)).resolves.toMatchObject({
      run: { code: 'page_changed' },
      lastNavigation: { source: 'user' },
    })
  })

  it('settles a run whose document turns into an error page', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined))
    const pending = run(page, "browser.click('a')", { timeoutMs: 30_000 })
    await flush()
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'http://localhost:9/',
      initiator: {},
    })
    contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:9/', true)
    await expect(pending).resolves.toMatchObject({ run: { status: 'unknown', code: 'page_unloaded' } })
  })

  it('settles a run when the page crashes and refuses runs until another page loads', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined))
    const pending = run(page, 'await work()', { timeoutMs: 30_000 })
    await flush()
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    await expect(pending).resolves.toMatchObject({ run: { status: 'unknown', code: 'page_unloaded' } })
    await expect(run(page)).resolves.toMatchObject({ run: { status: 'not_started', code: 'no_page' } })

    contents.loadURL.mockClear()
    const reread = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'after-crash',
      url: contents.url,
    })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledWith(contents.url)
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Recovered.')
    const recovered = referenceOf(await reread)
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: '1', truncated: false })
    await expect(run(recovered)).resolves.toMatchObject({ run: { status: 'completed' } })
  })

  it('attributes a navigation to the page when the user touched it during a run', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => {
      contents.emit('input-event', {}, { type: 'mouseDown' })
      contents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false,
        url: 'https://example.com/clicked',
        initiator: {},
      })
      return Promise.resolve({ kind: 'value', value: 'waited', truncated: false })
    })
    await run(page, 'await browser.sleep(1000)')
    await expect(run(page)).resolves.toMatchObject({ lastNavigation: { source: 'page' } })
  })

  it('does not report aborted requests as failures', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => {
      for (const listener of webRequest.failed) {
        listener({
          webContentsId: contents.id,
          method: 'GET',
          url: 'https://example.com/a.js',
          error: 'net::ERR_ABORTED',
        })
      }
      return Promise.resolve({ kind: 'value', value: '1', truncated: false })
    })
    expect((await run(page)).run?.diagnostics).toBeUndefined()
  })

  it('reads the page still shown when a read of a url is cancelled before its navigation starts', async () => {
    const { contents, page } = await openPage()
    contents.loadURL.mockImplementationOnce(() => Promise.reject(new Error('ERR_ABORTED')))
    const read = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'blocked-by-beforeunload',
      url: 'https://example.com/other',
    })
    await flush()
    contents.finishSnapshot('Unsaved form.')
    await expect(read).resolves.toMatchObject({ page, url: 'https://example.com/', content: 'Unsaved form.' })
    contents.executeJavaScript.mockResolvedValueOnce({ kind: 'value', value: '1', truncated: false })
    await expect(run(page)).resolves.toMatchObject({ page, run: { status: 'completed' } })
  })

  it('keeps a failed page failed through a navigation that ends without a document', async () => {
    const { contents, page } = await openPage()
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/export.csv',
      initiator: null,
    })
    contents.emit('did-stop-loading')
    await expect(run(page)).resolves.toMatchObject({
      run: { code: 'no_page', message: expect.stringContaining('crashed') },
    })

    contents.loadURL.mockClear()
    const reread = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'reload',
      url: contents.url,
    })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledWith(contents.url)
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Reloaded.')
    await expect(reread).resolves.toMatchObject({ page: expect.stringMatching(/.+/), content: 'Reloaded.' })
  })

  it('refuses a run with no page open as no_page', async () => {
    const result = await run('any-page')
    expect(result.run).toMatchObject({ status: 'not_started', code: 'no_page' })
  })

  it('attributes navigations of a timed out script that is still running to the agent', async () => {
    const { contents, page } = await openPage()
    contents.executeJavaScript.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(null)
    vi.useFakeTimers()
    const pending = run(page, 'await new Promise(() => {})', { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1001)
    expect((await pending).run?.status).toBe('unknown')

    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/next',
      initiator: {},
    })
    await expect(run(page)).resolves.toMatchObject({
      run: { code: 'page_changed' },
      lastNavigation: { source: 'agent', url: 'https://example.com/next' },
    })

    await vi.advanceTimersByTimeAsync(BUSY_WINDOW_MS)
    contents.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false,
      url: 'https://example.com/later',
      initiator: {},
    })
    await expect(run(page)).resolves.toMatchObject({ lastNavigation: { source: 'page' } })
  })

  async function startLoadedRead(requestId: string, url: string) {
    const read = controller.request(host as unknown as Host, 1, { kind: 'read', requestId, url })
    await flush()
    const contents = views[0].webContents
    contents.emit('dom-ready')
    await flush()
    return { read, contents }
  }

  it('reads a page once its document is ready and leaves no page listeners behind', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')
    const baseline = contents.listenerCount('dom-ready') + contents.listenerCount('did-fail-load')
    contents.finishSnapshot('Hello from the page.')

    await expect(read).resolves.toMatchObject({ url: 'https://example.com/', content: 'Hello from the page.' })
    expect(contents.listenerCount('dom-ready') + contents.listenerCount('did-fail-load')).toBe(baseline)
    expect(contents.listenerCount('did-start-navigation')).toBe(VIEW_NAVIGATION_LISTENERS)
  })

  it('reads the page already open without waiting for another DOM ready', async () => {
    const first = await startLoadedRead('a', 'https://example.com/')
    first.contents.finishSnapshot('First read.')
    await first.read

    const current = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'b' })
    await flush()
    first.contents.finishSnapshot('Current page.')

    await expect(current).resolves.toMatchObject({ content: 'Current page.' })
  })

  it('reads the page already open at the requested url without reloading it', async () => {
    const first = await startLoadedRead('a', 'https://example.com/app')
    first.contents.finishSnapshot('Edited state.')
    await first.read

    const again = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'b',
      url: 'https://example.com/app',
    })
    await flush()
    first.contents.finishSnapshot('Edited state.')

    await expect(again).resolves.toMatchObject({ content: 'Edited state.' })
    expect(first.contents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('loads the requested url again after it failed or while another navigation is pending', async () => {
    const first = await startLoadedRead('a', 'https://example.com/app')
    first.contents.finishSnapshot('Loaded.')
    await first.read
    const { contents } = first

    contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'https://example.com/app', true)
    const retry = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'b',
      url: 'https://example.com/app',
    })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledTimes(2)
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Server is up.')
    await expect(retry).resolves.toMatchObject({ content: 'Server is up.' })

    // A link the page followed is still loading while the old URL is requested.
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    const back = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'c',
      url: 'https://example.com/app',
    })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledTimes(3)
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Back on the app.')
    await expect(back).resolves.toMatchObject({ content: 'Back on the app.' })
  })

  it('releases the queue when a screenshot that never finishes is cancelled', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')
    contents.finishSnapshot('Loaded.')
    await read

    const shot = controller.request(host as unknown as Host, 1, { kind: 'screenshot', requestId: 'shot' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await flush()
    expect(contents.capturePage).toHaveBeenCalled()
    controller.cancel(1, 'shot')
    await expect(shot).rejects.toThrow('cancelled')
    await flush()
    expect(captureHosts.at(-1)?.destroyed).toBe(true)
    expect(views[0].visible).toBe(false)

    const next = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'next' })
    await flush()
    contents.finishSnapshot('Still responsive.')
    await expect(next).resolves.toMatchObject({ content: 'Still responsive.' })
  })

  it('restores a background capture before showing the page and does not hide the new placement on completion', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')
    contents.finishSnapshot('Loaded.')
    await read
    const shot = controller.request(host as unknown as Host, 1, { kind: 'screenshot', requestId: 'shot' })
    await flush()
    contents.finishSnapshot('Loaded.')
    await flush()
    await controller.setView(host as unknown as Host, { visible: false })
    expect(captureHosts.at(-1)?.destroyed).toBe(false)
    await controller.setView(host as unknown as Host, {
      visible: true,
      bounds: { x: 700, y: 0, width: 400, height: 600 },
    })
    expect(captureHosts.at(-1)?.destroyed).toBe(true)
    contents.captures.shift()?.(fakeImage(400, 600))
    await shot
    expect(views[0].visible).toBe(true)
    expect(views[0].setBounds).toHaveBeenLastCalledWith({ x: 700, y: 0, width: 400, height: 600 })
  })

  it('settles a cancelled queued read at once and skips it', async () => {
    const { read: slow, contents } = await startLoadedRead('a', 'https://example.com/slow')
    const queued = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'b',
      url: 'https://example.com/b',
    })

    controller.cancel(1, 'b')
    await expect(queued).rejects.toThrow('cancelled')

    contents.finishSnapshot('Slow page.')
    await expect(slow).resolves.toMatchObject({ content: 'Slow page.' })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('times out, stops waiting for the document and frees the queue', async () => {
    vi.useFakeTimers()
    const read = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'a',
      url: 'https://example.com/never',
      timeoutMs: 1_000,
    })
    const settled = expect(read).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1_000)
    await settled
    const contents = views[0].webContents
    expect(contents.listenerCount('dom-ready')).toBe(1)
    // Only the view's own load-failure listener remains.
    expect(contents.listenerCount('did-fail-load')).toBe(1)
    vi.useRealTimers()

    const next = controller.request(host as unknown as Host, 1, {
      kind: 'read',
      requestId: 'b',
      url: 'https://example.com/next',
    })
    await flush()
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Next page.')
    await expect(next).resolves.toMatchObject({ content: 'Next page.' })
  })

  it('captures a downscaled viewport after the page settles when asked', async () => {
    const read = controller.request(host as unknown as Host, 1, {
      kind: 'screenshot',
      requestId: 'a',
      url: 'https://example.com/',
    })
    await flush()
    const contents = views[0].webContents
    contents.emit('dom-ready')
    await flush()
    expect(contents.capturePage).not.toHaveBeenCalled()
    contents.capturePage.mockResolvedValueOnce(fakeImage(3136, 1600))
    contents.finishSnapshot('Visible page.')

    await expect(read).resolves.toMatchObject({
      url: 'https://example.com/',
      screenshot: {
        base64Data: Buffer.from('jpeg-1568x800').toString('base64'),
        mediaType: 'image/jpeg',
        width: 1568,
        height: 800,
      },
    })
    expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
    expect(captureHosts.at(-1)?.options).toMatchObject({ show: false, focusable: false })
    expect(captureHosts.at(-1)?.destroyed).toBe(true)
    expect(views[0].visible).toBe(false)
  })

  it('leaves the page reference and page events of a screenshot for the next read', async () => {
    const read = controller.request(host as unknown as Host, 1, {
      kind: 'screenshot',
      requestId: 'a',
      url: 'https://example.com/',
    })
    await flush()
    const contents = views[0].webContents
    contents.emit('dom-ready')
    await flush()
    contents.emit('input-event', {}, { type: 'mouseDown' })
    contents.finishSnapshot('Visible page.')
    await flush()
    contents.captures.shift()?.(fakeImage(800, 600))
    const shot = await read
    expect(shot).not.toHaveProperty('page')
    expect(shot).not.toHaveProperty('userInteracted')

    const next = controller.request(host as unknown as Host, 1, { kind: 'read', requestId: 'b' })
    await flush()
    contents.finishSnapshot('Visible page.')
    await expect(next).resolves.toMatchObject({ page: expect.any(String), userInteracted: true })
  })

  it('fails a screenshot read when the page has nothing to capture', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')
    await flush()
    contents.finishSnapshot('Text only.')
    await expect(read).resolves.not.toHaveProperty('screenshot')

    contents.capturePage.mockResolvedValueOnce(fakeImage(0, 0))
    const blank = controller.request(host as unknown as Host, 1, { kind: 'screenshot', requestId: 'b' })
    await flush()
    contents.finishSnapshot('Hidden page.')
    await expect(blank).rejects.toThrow('cannot be captured')
  })

  it('closes the page and cancels its reads when the window closes', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')

    host.emit('closed')

    await expect(read).rejects.toThrow('cancelled')
    expect(contents.close).toHaveBeenCalled()
    expect(controller.getState().url).toBe('')
  })
})

describe('BuiltInBrowserController view', () => {
  let controller: InstanceType<typeof BuiltInBrowserController>
  let host: FakeHost
  const bounds = { x: 0, y: 0, width: 400, height: 600 }
  const image = { isEmpty: () => false, toJPEG: () => Buffer.from('jpeg') }

  beforeEach(() => {
    views.length = 0
    controller = new BuiltInBrowserController('conversation')
    host = new FakeHost()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function show() {
    return controller.setView(host as unknown as Host, { visible: true, bounds })
  }

  it('hides the page after taking a still of it', async () => {
    await show()
    const hide = controller.setView(host as unknown as Host, { visible: false, snapshot: true })
    await flush()
    expect(views[0].visible).toBe(true)
    views[0].webContents.captures.shift()?.(image)

    await expect(hide).resolves.toBe(`data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`)
    expect(views[0].visible).toBe(false)
  })

  it('keeps the page shown when it is placed again while the still is taken', async () => {
    await show()
    const hide = controller.setView(host as unknown as Host, { visible: false, snapshot: true })
    await flush()
    await show()
    views[0].webContents.captures.shift()?.(image)

    await expect(hide).resolves.toBeNull()
    expect(views[0].visible).toBe(true)
  })

  it('hides the page without a still when the capture is slow', async () => {
    await show()
    vi.useFakeTimers()
    const hide = controller.setView(host as unknown as Host, { visible: false, snapshot: true })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(hide).resolves.toBeNull()
    expect(views[0].visible).toBe(false)
  })
})
