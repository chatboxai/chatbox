import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeContents extends EventEmitter {
  url = 'about:blank'
  closed = false
  snapshots: Array<(value: unknown) => void> = []
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

const views: Array<{ webContents: FakeContents }> = []

vi.mock('electron', () => {
  class WebContentsView {
    webContents = new FakeContents()
    setBackgroundColor = vi.fn()
    setVisible = vi.fn()
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
    expect(contents.listenerCount('did-fail-load')).toBe(0)
    vi.useRealTimers()

    const next = controller.readPage(host as unknown as Host, 1, { requestId: 'b', url: 'https://example.com/next' })
    await flush()
    contents.emit('dom-ready')
    await flush()
    contents.finishSnapshot('Next page.')
    await expect(next).resolves.toMatchObject({ content: 'Next page.' })
  })

  it('closes the page and cancels its reads when the window closes', async () => {
    const { read, contents } = await startLoadedRead('a', 'https://example.com/')

    host.emit('closed')

    await expect(read).rejects.toThrow('cancelled')
    expect(contents.close).toHaveBeenCalled()
    expect(controller.getState().url).toBe('')
  })
})
