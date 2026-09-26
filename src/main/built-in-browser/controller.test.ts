import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeContents extends EventEmitter {
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
    this.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
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

const views: Array<{ webContents: FakeContents; visible: boolean }> = []

vi.mock('electron', () => {
  class WebContentsView {
    webContents = new FakeContents()
    setBackgroundColor = vi.fn()
    visible = false
    setVisible = vi.fn((visible: boolean) => {
      this.visible = visible
    })
    getVisible = () => this.visible
    setBounds = vi.fn()
    constructor() {
      views.push(this)
    }
  }
  const fakeSession = {
    getUserAgent: () => 'Mozilla/5.0 Chrome/140 Electron/38.0.0',
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn(),
  }
  return { WebContentsView, session: { fromPartition: () => fakeSession } }
})

class FakeHost extends EventEmitter {
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  webContents = { send: vi.fn() }
  isDestroyed = () => false
}

const { BuiltInBrowserController } = await import('./controller')
type Host = Parameters<InstanceType<typeof BuiltInBrowserController>['readPage']>[0]

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BuiltInBrowserController reads', () => {
  let controller: InstanceType<typeof BuiltInBrowserController>
  let host: FakeHost

  beforeEach(() => {
    views.length = 0
    controller = new BuiltInBrowserController()
    host = new FakeHost()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes scripts only on the expected ready page', async () => {
    controller.navigate(host as unknown as Host, 'https://example.com/')
    const contents = views[0].webContents
    contents.emit('dom-ready')
    contents.executeJavaScript.mockResolvedValueOnce({ value: 'data', truncated: false })
    const result = await controller.readPage(host as unknown as Host, 1, {
      requestId: 'script',
      script: { code: 'return document.title', expectedUrl: contents.url },
    })
    expect(result.scriptResult).toEqual({ value: 'data', truncated: false })
    expect(contents.executeJavaScript.mock.calls[0]).toEqual([expect.stringContaining('return document.title')])
    await expect(
      controller.readPage(host as unknown as Host, 1, {
        requestId: 'wrong',
        script: { code: 'return 1', expectedUrl: 'https://other.example/' },
      })
    ).rejects.toThrow('page changed')
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('reports script syntax errors without running them and bounds what the page returns', async () => {
    controller.navigate(host as unknown as Host, 'https://example.com/')
    const contents = views[0].webContents
    contents.emit('dom-ready')
    await expect(
      controller.readPage(host as unknown as Host, 1, {
        requestId: 'syntax',
        script: { code: '}); (async () => {', expectedUrl: contents.url },
      })
    ).rejects.toThrow('syntax error')
    expect(contents.executeJavaScript).not.toHaveBeenCalled()

    contents.executeJavaScript.mockResolvedValueOnce({ value: 'x'.repeat(20_000), truncated: false })
    const bounded = await controller.readPage(host as unknown as Host, 1, {
      requestId: 'bounded',
      script: { code: 'return 1', expectedUrl: contents.url },
    })
    expect(bounded.scriptResult).toEqual({ value: 'x'.repeat(12_000), truncated: true })

    contents.executeJavaScript.mockResolvedValueOnce({ value: 42 })
    await expect(
      controller.readPage(host as unknown as Host, 1, {
        requestId: 'malformed',
        script: { code: 'return 1', expectedUrl: contents.url },
      })
    ).rejects.toThrow('unexpected script result')
  })

  it('gives scripts the page helpers and reports where the page went', async () => {
    controller.navigate(host as unknown as Host, 'https://example.com/')
    const contents = views[0].webContents
    contents.emit('dom-ready')
    contents.executeJavaScript.mockImplementationOnce(() => {
      contents.url = 'https://example.com/results'
      contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      return Promise.resolve({ value: 'Search', truncated: false })
    })
    const result = await controller.readPage(host as unknown as Host, 1, {
      requestId: 'click',
      script: { code: "return browser.click('button')", expectedUrl: contents.url },
    })

    const source = String((contents.executeJavaScript.mock.calls[0] as unknown[])[0])
    expect(source.indexOf('const browser =')).toBeGreaterThan(-1)
    expect(source.indexOf('const browser =')).toBeLessThan(source.indexOf("return browser.click('button')"))
    expect(result).toMatchObject({
      url: 'https://example.com/results',
      scriptResult: { value: 'Search', truncated: false, navigated: true },
    })
    expect(contents.listenerCount('did-start-navigation')).toBe(1)

    contents.emit('dom-ready')
    contents.executeJavaScript.mockResolvedValueOnce({ value: 'same page', truncated: false })
    const quiet = await controller.readPage(host as unknown as Host, 1, {
      requestId: 'read',
      script: { code: 'return 1', expectedUrl: contents.url },
    })
    expect(quiet.scriptResult).toEqual({ value: 'same page', truncated: false })
  })

  it('releases the queue after a script times out without replaying it', async () => {
    vi.useFakeTimers()
    controller.navigate(host as unknown as Host, 'https://example.com/')
    const contents = views[0].webContents
    contents.emit('dom-ready')
    const pending = controller.readPage(host as unknown as Host, 1, {
      requestId: 'timeout',
      timeoutMs: 1000,
      script: { code: 'await new Promise(() => {})', expectedUrl: contents.url },
    })
    const failed = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1001)
    await failed
    contents.executeJavaScript.mockResolvedValueOnce({ value: 'next', truncated: false })
    const next = await controller.readPage(host as unknown as Host, 1, {
      requestId: 'next',
      script: { code: 'return 2', expectedUrl: contents.url },
    })
    expect(next.scriptResult?.value).toBe('next')
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  async function startLoadedRead(requestId: string, url: string) {
    const read = controller.readPage(host as unknown as Host, 1, { requestId, url })
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
    expect(contents.listenerCount('did-start-navigation')).toBe(1)
  })

  it('reads the page already open without waiting for another DOM ready', async () => {
    const first = await startLoadedRead('a', 'https://example.com/')
    first.contents.finishSnapshot('First read.')
    await first.read

    const current = controller.readPage(host as unknown as Host, 1, { requestId: 'b' })
    await flush()
    first.contents.finishSnapshot('Current page.')

    await expect(current).resolves.toMatchObject({ content: 'Current page.' })
  })

  it('reads the page already open at the requested url without reloading it', async () => {
    const first = await startLoadedRead('a', 'https://example.com/app')
    first.contents.finishSnapshot('Edited state.')
    await first.read

    const again = controller.readPage(host as unknown as Host, 1, { requestId: 'b', url: 'https://example.com/app' })
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
    const retry = controller.readPage(host as unknown as Host, 1, { requestId: 'b', url: 'https://example.com/app' })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledTimes(2)
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Server is up.')
    await expect(retry).resolves.toMatchObject({ content: 'Server is up.' })

    // A link the page followed is still loading while the old URL is requested.
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    const back = controller.readPage(host as unknown as Host, 1, { requestId: 'c', url: 'https://example.com/app' })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledTimes(3)
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Back on the app.')
    await expect(back).resolves.toMatchObject({ content: 'Back on the app.' })
  })

  it('runs a script when the expected url differs from the page only in normalization', async () => {
    controller.navigate(host as unknown as Host, 'https://example.com/')
    const contents = views[0].webContents
    contents.emit('dom-ready')
    contents.executeJavaScript.mockResolvedValueOnce({ value: 'ok', truncated: false })

    const result = await controller.readPage(host as unknown as Host, 1, {
      requestId: 'script',
      script: { code: 'return 1', expectedUrl: 'https://example.com' },
    })

    expect(result.scriptResult?.value).toBe('ok')
  })

  it('releases the queue when a screenshot that never finishes is cancelled', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')
    contents.finishSnapshot('Loaded.')
    await read

    const shot = controller.readPage(host as unknown as Host, 1, { requestId: 'shot', screenshot: true })
    await flush()
    contents.finishSnapshot('Loaded.')
    await flush()
    expect(contents.capturePage).toHaveBeenCalled()
    controller.cancelRead(1, 'shot')
    await expect(shot).rejects.toThrow('cancelled')

    const next = controller.readPage(host as unknown as Host, 1, { requestId: 'next' })
    await flush()
    contents.finishSnapshot('Still responsive.')
    await expect(next).resolves.toMatchObject({ content: 'Still responsive.' })
  })

  it('settles a cancelled queued read at once and skips it', async () => {
    const { read: slow, contents } = await startLoadedRead('a', 'https://example.com/slow')
    const queued = controller.readPage(host as unknown as Host, 1, { requestId: 'b', url: 'https://example.com/b' })

    controller.cancelRead(1, 'b')
    await expect(queued).rejects.toThrow('cancelled')

    contents.finishSnapshot('Slow page.')
    await expect(slow).resolves.toMatchObject({ content: 'Slow page.' })
    await flush()
    expect(contents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('times out, stops waiting for the document and frees the queue', async () => {
    vi.useFakeTimers()
    const read = controller.readPage(host as unknown as Host, 1, {
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

    const next = controller.readPage(host as unknown as Host, 1, { requestId: 'b', url: 'https://example.com/next' })
    await flush()
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Next page.')
    await expect(next).resolves.toMatchObject({ content: 'Next page.' })
  })

  it('captures a downscaled viewport after the page settles when asked', async () => {
    const read = controller.readPage(host as unknown as Host, 1, {
      requestId: 'a',
      url: 'https://example.com/',
      screenshot: true,
    })
    await flush()
    const contents = views[0].webContents
    contents.emit('dom-ready')
    await flush()
    expect(contents.capturePage).not.toHaveBeenCalled()
    contents.capturePage.mockResolvedValueOnce(fakeImage(3136, 1600))
    contents.finishSnapshot('Visible page.')

    await expect(read).resolves.toMatchObject({
      content: 'Visible page.',
      screenshot: {
        base64Data: Buffer.from('jpeg-1568x800').toString('base64'),
        mediaType: 'image/jpeg',
        width: 1568,
        height: 800,
      },
    })
    expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
  })

  it('fails a screenshot read when the page has nothing to capture', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')
    await flush()
    contents.finishSnapshot('Text only.')
    await expect(read).resolves.not.toHaveProperty('screenshot')

    contents.capturePage.mockResolvedValueOnce(fakeImage(0, 0))
    const blank = controller.readPage(host as unknown as Host, 1, { requestId: 'b', screenshot: true })
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
    controller = new BuiltInBrowserController()
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
