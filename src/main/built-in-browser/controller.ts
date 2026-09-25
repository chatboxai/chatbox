import {
  BUILT_IN_BROWSER_CHANNELS,
  BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS,
  BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS,
  type BuiltInBrowserPage,
  type BuiltInBrowserReadRequest,
  type BuiltInBrowserState,
  type BuiltInBrowserViewRequest,
  EMPTY_BUILT_IN_BROWSER_STATE,
} from '@shared/built-in-browser'
import {
  type BrowserWindow,
  type NativeImage,
  type Session,
  session,
  type WebContents,
  WebContentsView,
} from 'electron'
import { extractReadableContent } from './extract'
import { normalizeBrowserUrl } from './url'

/** Persistent profile of the built-in browser; sign-ins made in the sidebar are kept here. */
export const BUILT_IN_BROWSER_PARTITION = 'persist:chatbox-built-in-browser'

const MAX_HTML_CHARS = 3_000_000
const RENDER_SETTLE_MAX_MS = 8_000

// Resolves once the page's visible text stops growing, so client-rendered pages are read
// after their content arrives instead of at the first paint.
const SNAPSHOT_SCRIPT = `new Promise((resolve) => {
  const started = Date.now();
  let lastLength = -1;
  let stableTicks = 0;
  const snapshot = () => resolve({
    url: location.href,
    title: document.title || '',
    html: document.documentElement ? document.documentElement.outerHTML.slice(0, ${MAX_HTML_CHARS}) : '',
    text: document.body ? document.body.innerText : '',
  });
  const tick = () => {
    const length = document.body ? document.body.innerText.length : 0;
    stableTicks = length > 0 && length === lastLength ? stableTicks + 1 : 0;
    lastLength = length;
    if (stableTicks >= 2 || Date.now() - started > ${RENDER_SETTLE_MAX_MS}) snapshot();
    else setTimeout(tick, 400);
  };
  tick();
})`

interface PageSnapshot {
  url: string
  title: string
  html: string
  text: string
}

const SNAPSHOT_TIMEOUT_MS = 200

function captureWithin(contents: WebContents, timeoutMs: number): Promise<NativeImage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    contents
      .capturePage()
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(timer))
  })
}

function browserUserAgent(defaultUserAgent: string): string {
  // Many sites refuse or degrade pages for embedded Electron clients.
  return defaultUserAgent
    .replace(/\s(Electron|xyz\.chatboxapp\.app|chatbox|Chatbox)\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Owns the single page view of the built-in browser. The view lives in the app window that last
 * showed the sidebar; it keeps its page while the sidebar is closed so the model and the user
 * continue from the same page.
 */
export class BuiltInBrowserController {
  private configuredSession: Session | null = null
  private view: WebContentsView | null = null
  private host: BrowserWindow | null = null
  private readonly activeReads = new Map<string, { ownerId: number; cancel: () => void }>()
  private readQueue: Promise<unknown> = Promise.resolve()
  /** Whether the view's current main-frame document has reached DOM ready. */
  private documentReady = false
  /** Orders view requests, so a hide that waits on a snapshot never undoes a later placement. */
  private viewGeneration = 0

  getSession(): Session {
    if (this.configuredSession) return this.configuredSession
    const ses = session.fromPartition(BUILT_IN_BROWSER_PARTITION)
    ses.setUserAgent(browserUserAgent(ses.getUserAgent()))
    // Camera, microphone, location, notifications and similar prompts are not needed to read or sign in.
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (event) => event.preventDefault())
    this.configuredSession = ses
    return ses
  }

  async setProxy(proxy: string | undefined): Promise<void> {
    await this.getSession().setProxy(proxy ? { proxyRules: proxy } : {})
  }

  getState(): BuiltInBrowserState {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) return { ...EMPTY_BUILT_IN_BROWSER_STATE, reading: this.isReading() }
    const url = contents.getURL()
    return {
      url: url === 'about:blank' ? '' : url,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      reading: this.isReading(),
    }
  }

  /**
   * Attaches the view to `host` and places it, or hides it. A hide request with `snapshot`
   * resolves to a still of the page taken just before it is hidden.
   */
  async setView(host: BrowserWindow, request: BuiltInBrowserViewRequest): Promise<string | null> {
    const generation = ++this.viewGeneration
    if (!request.visible) {
      const view = this.host === host ? this.view : null
      if (!view || !view.getVisible()) return null
      let image: string | null = null
      if (request.snapshot) {
        // The page keeps covering the overlay until it is hidden, so a slow capture is abandoned.
        const captured = await captureWithin(view.webContents, SNAPSHOT_TIMEOUT_MS)
        // A newer request placed or hid the view while the still was taken.
        if (generation !== this.viewGeneration) return null
        if (captured && !captured.isEmpty()) {
          image = `data:image/jpeg;base64,${captured.toJPEG(85).toString('base64')}`
        }
      }
      view.setVisible(false)
      return image
    }
    const view = this.ensureView(host)
    const { x, y, width, height } = request.bounds
    view.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
    })
    view.setVisible(true)
    return null
  }

  navigate(host: BrowserWindow, url: string): void {
    const contents = this.ensureView(host).webContents
    contents.loadURL(normalizeBrowserUrl(url)).catch(() => undefined)
  }

  goBack(): void {
    const contents = this.view?.webContents
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
  }

  goForward(): void {
    const contents = this.view?.webContents
    if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
  }

  reload(): void {
    this.view?.webContents.reload()
  }

  stop(): void {
    this.view?.webContents.stop()
  }

  /**
   * Reads one page at a time; the page stays open in the sidebar for the user afterwards.
   * Cancelling or timing out settles the caller at once and stops the read's waits.
   */
  readPage(host: BrowserWindow, ownerId: number, request: BuiltInBrowserReadRequest): Promise<BuiltInBrowserPage> {
    if (this.activeReads.has(request.requestId)) {
      return Promise.reject(new Error(`Built-in browser read already exists: ${request.requestId}`))
    }
    const abort = new AbortController()
    const { signal } = abort
    this.activeReads.set(request.requestId, {
      ownerId,
      cancel: () => abort.abort(new Error('Built-in browser read was cancelled')),
    })
    this.pushState()

    const run = async (): Promise<BuiltInBrowserPage> => {
      signal.throwIfAborted()
      const contents = this.ensureView(host).webContents
      // The host may have changed since the read was queued; tell it a read is running.
      this.pushState()
      const url = request.url ? normalizeBrowserUrl(request.url) : undefined
      if (!url && !this.getState().url) throw new Error('The built-in browser has no page open; pass a url.')
      const timeoutMs = Math.min(
        Math.max(request.timeoutMs ?? BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS, 1_000),
        BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS
      )
      const timer = setTimeout(
        () => abort.abort(new Error(`Built-in browser timed out after ${timeoutMs}ms: ${url ?? contents.getURL()}`)),
        timeoutMs
      )
      try {
        if (url) {
          this.documentReady = false
          contents.loadURL(url).catch(() => undefined)
        }
        const snapshot = await snapshotSettled(contents, signal, () => this.documentReady)
        const extracted = extractReadableContent({ html: snapshot.html, url: snapshot.url, visibleText: snapshot.text })
        return {
          url: snapshot.url,
          title: snapshot.title || extracted.title || '',
          content: extracted.content,
        }
      } finally {
        clearTimeout(timer)
      }
    }

    const queued = this.readQueue.then(run, run)
    this.readQueue = queued.catch(() => undefined)
    const stopped = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    return Promise.race([queued, stopped]).finally(() => {
      this.activeReads.delete(request.requestId)
      this.pushState()
    })
  }

  cancelRead(ownerId: number, requestId: string): void {
    const active = this.activeReads.get(requestId)
    if (active && active.ownerId === ownerId) active.cancel()
  }

  cancelReadsOwnedBy(ownerId: number): void {
    for (const active of this.activeReads.values()) {
      if (active.ownerId === ownerId) active.cancel()
    }
  }

  async clearData(): Promise<void> {
    const contents = this.view?.webContents
    if (contents && !contents.isDestroyed()) {
      contents.navigationHistory.clear()
      await contents.loadURL('about:blank').catch(() => undefined)
    }
    const ses = this.getSession()
    await ses.clearStorageData()
    await ses.clearCache()
    this.pushState()
  }

  private isReading(): boolean {
    return this.activeReads.size > 0
  }

  private ensureView(host: BrowserWindow): WebContentsView {
    if (!this.view || this.view.webContents.isDestroyed()) {
      this.view = this.createView()
    }
    if (this.host !== host) {
      if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(this.view)
      this.host = host
      this.view.setVisible(false)
      host.contentView.addChildView(this.view)
      host.once('closed', () => this.releaseHost(host))
    }
    return this.view
  }

  /** A closed window takes the page with it; reads waiting on that page are cancelled. */
  private releaseHost(host: BrowserWindow): void {
    if (this.host !== host) return
    this.host = null
    for (const active of this.activeReads.values()) active.cancel()
    const view = this.view
    this.view = null
    this.documentReady = false
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.getSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    view.setBackgroundColor('#ffffff')
    const contents = view.webContents
    // Sign-in flows often open a popup; keep them in the sidebar so they share the profile.
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    this.documentReady = false
    contents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) this.documentReady = false
    })
    contents.on('dom-ready', () => {
      this.documentReady = true
    })
    const push = () => this.pushState()
    contents.on('did-start-loading', push)
    contents.on('did-stop-loading', push)
    contents.on('did-navigate', push)
    contents.on('did-navigate-in-page', push)
    contents.on('page-title-updated', push)
    return view
  }

  private pushState(): void {
    const host = this.host
    if (!host || host.isDestroyed()) return
    host.webContents.send(BUILT_IN_BROWSER_CHANNELS.state, this.getState())
  }
}

const MAX_SNAPSHOT_ATTEMPTS = 4

/** Resolves on the next main-frame DOM ready; rejects when the main frame fails to load or on abort. */
function waitForDocument(contents: WebContents, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const cleanup = () => {
      contents.off('dom-ready', onReady)
      contents.off('did-fail-load', onFail)
      signal.removeEventListener('abort', onAbort)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean
    ) => {
      // ERR_ABORTED (-3) is a navigation replaced by a redirect; the next document still arrives.
      if (!isMainFrame || errorCode === -3) return
      cleanup()
      reject(new Error(`Failed to load ${validatedUrl}: ${errorDescription} (${errorCode})`))
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    contents.on('dom-ready', onReady)
    contents.on('did-fail-load', onFail)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Resolves when the main frame starts loading a new document; stops listening on abort. */
function waitForNavigation(contents: WebContents, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      contents.off('did-start-navigation', onNavigation)
      signal.removeEventListener('abort', cleanup)
    }
    const onNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!event.isMainFrame || event.isSameDocument) return
      cleanup()
      resolve()
    }
    contents.on('did-start-navigation', onNavigation)
    signal.addEventListener('abort', cleanup, { once: true })
  })
}

/**
 * Snapshots the current document once it is ready and its text settles. A client-side redirect
 * or a navigation by the user replaces the document while the snapshot is running, so it
 * restarts on the new one. Pages may never finish loading, so DOM ready is enough to start.
 */
async function snapshotSettled(
  contents: WebContents,
  signal: AbortSignal,
  isDocumentReady: () => boolean
): Promise<PageSnapshot> {
  for (let attempt = 1; ; attempt += 1) {
    if (!isDocumentReady()) await waitForDocument(contents, signal)
    const attemptDone = new AbortController()
    const stopAttempt = () => attemptDone.abort()
    signal.addEventListener('abort', stopAttempt, { once: true })
    try {
      const outcome = await Promise.race([
        contents.executeJavaScript(SNAPSHOT_SCRIPT, true).then((snapshot: PageSnapshot) => ({ snapshot })),
        waitForNavigation(contents, attemptDone.signal).then(() => ({ snapshot: null })),
      ])
      signal.throwIfAborted()
      if (outcome.snapshot) {
        const { snapshot } = outcome
        return {
          url: String(snapshot.url ?? contents.getURL()),
          title: String(snapshot.title ?? ''),
          html: String(snapshot.html ?? ''),
          text: String(snapshot.text ?? ''),
        }
      }
    } catch (error) {
      signal.throwIfAborted()
      if (attempt >= MAX_SNAPSHOT_ATTEMPTS || contents.isDestroyed()) throw error
      continue
    } finally {
      signal.removeEventListener('abort', stopAttempt)
      attemptDone.abort()
    }
    if (attempt >= MAX_SNAPSHOT_ATTEMPTS) throw new Error(`Page kept navigating: ${contents.getURL()}`)
  }
}
