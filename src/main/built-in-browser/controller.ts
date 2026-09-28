import { randomBytes } from 'node:crypto'
import {
  BUILT_IN_BROWSER_CHANNELS,
  BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS,
  BUILT_IN_BROWSER_DEFAULT_VIEWPORT,
  BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS,
  BUILT_IN_BROWSER_SCREENSHOT_MAX_DIMENSION,
  type BuiltInBrowserPage,
  type BuiltInBrowserReadRequest,
  type BuiltInBrowserRunErrorCode,
  type BuiltInBrowserRunResult,
  type BuiltInBrowserScreenshot,
  type BuiltInBrowserState,
  type BuiltInBrowserUploadRequest,
  type BuiltInBrowserUploadResult,
  type BuiltInBrowserViewRequest,
  EMPTY_BUILT_IN_BROWSER_STATE,
} from '@shared/built-in-browser'
import { BrowserWindow, type NativeImage, type Session, session, type WebContents, WebContentsView } from 'electron'
import { extractReadableContent } from './extract'
import { DebuggerUnavailableError, PageDebugger } from './page-debugger'
import { routeDownload } from './page-downloads'
import { PageRun, reportFailedRequest } from './page-run'
import { BUSY_WINDOW_MS, type PageRef, PageTracker } from './page-tracker'
import { handFilesToPage, inspectUploadFiles } from './page-upload'
import { scriptSyntaxError } from './script-run'
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
/** The reason a read is aborted when it runs out of time, as opposed to a cancellation. */
class ReadTimeoutError extends Error {}

/** The caller cancelled the call, so its result never reaches the model. A timeout is still delivered. */
function wasCancelled(signal: AbortSignal | undefined): boolean {
  return !!signal?.aborted && !(signal.reason instanceof ReadTimeoutError)
}

function newOperationId(): string {
  return `op_${randomBytes(4).toString('hex')}`
}

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
  private static configuredSession: Session | null = null
  private view: WebContentsView | null = null
  /** State of the page `view` shows; created and dropped together with it. */
  private page: PageTracker | null = null
  private host: BrowserWindow | null = null
  private readonly activeReads = new Map<string, { ownerId: number; cancel: () => void }>()
  private readQueue: Promise<unknown> = Promise.resolve()
  /** Orders view requests, so a hide that waits on a snapshot never undoes a later placement. */
  private viewGeneration = 0
  private restoreCapture: (() => void) | null = null
  private readonly debuggers = new WeakMap<WebContents, PageDebugger>()

  constructor(
    private readonly sessionId?: string,
    private readonly manageHostLifecycle = true
  ) {}

  dispose(): void {
    this.restoreCapture?.()
    ++this.viewGeneration
    for (const active of this.activeReads.values()) active.cancel()
    this.activeReads.clear()
    if (this.host) {
      if (this.view && !this.host.isDestroyed()) this.host.contentView.removeChildView(this.view)
      this.releaseHost(this.host)
    }
  }

  getSession(): Session {
    if (BuiltInBrowserController.configuredSession) return BuiltInBrowserController.configuredSession
    const ses = session.fromPartition(BUILT_IN_BROWSER_PARTITION)
    ses.setUserAgent(browserUserAgent(ses.getUserAgent()))
    // Camera, microphone, location, notifications and similar prompts are not needed to read or sign in.
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (event, item, contents) => routeDownload(event, item, contents))
    // A response's status is known once its headers arrive; a script can act on it before the body ends.
    ses.webRequest.onResponseStarted((details) => {
      if (details.statusCode < 400) return
      reportFailedRequest(details.webContentsId, {
        method: details.method,
        url: details.url,
        status: details.statusCode,
      })
    })
    ses.webRequest.onErrorOccurred((details) => {
      // Aborted requests are cancellations, by the page or by a navigation, not failures.
      if (details.error === 'net::ERR_ABORTED') return
      reportFailedRequest(details.webContentsId, { method: details.method, url: details.url, error: details.error })
    })
    BuiltInBrowserController.configuredSession = ses
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
    if (this.restoreCapture && !request.visible) return null
    this.restoreCapture?.()
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
    const { view } = this.ensureView(host)
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
    const { view, page } = this.ensureView(host)
    page.downloads.endEarlierCapture()
    page.expectNavigation('user')
    const contents = view.webContents
    contents.loadURL(normalizeBrowserUrl(url)).catch(() => undefined)
  }

  goBack(): void {
    const contents = this.view?.webContents
    if (!contents?.navigationHistory.canGoBack()) return
    this.page?.downloads.endEarlierCapture()
    this.page?.expectNavigation('user')
    contents.navigationHistory.goBack()
  }

  goForward(): void {
    const contents = this.view?.webContents
    if (!contents?.navigationHistory.canGoForward()) return
    this.page?.downloads.endEarlierCapture()
    this.page?.expectNavigation('user')
    contents.navigationHistory.goForward()
  }

  reload(): void {
    if (!this.view) return
    this.page?.downloads.endEarlierCapture()
    this.page?.expectNavigation('user')
    this.view.webContents.reload()
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
    /** Set once an operation touches the page; from then on only the operation itself reports how it ended. */
    let operationStarted = false
    const markStarted = () => {
      operationStarted = true
    }
    this.activeReads.set(request.requestId, {
      ownerId,
      cancel: () => abort.abort(new Error('Built-in browser read was cancelled')),
    })
    this.pushState()

    const run = async (): Promise<BuiltInBrowserPage> => {
      signal.throwIfAborted()
      const { view, page } = this.ensureView(host)
      const contents = view.webContents
      // Downloads are saved only for the run that asked for them, so every operation ends what an
      // earlier timed out run left capturing.
      page.downloads.endEarlierCapture()
      // The host may have changed since the read was queued; tell it a read is running.
      this.pushState()
      const url = request.url ? normalizeBrowserUrl(request.url) : undefined
      const timeoutMs = Math.min(
        Math.max(request.timeoutMs ?? BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS, 1_000),
        BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS
      )
      const timer = setTimeout(
        () =>
          abort.abort(
            new ReadTimeoutError(`Built-in browser timed out after ${timeoutMs}ms: ${url ?? contents.getURL()}`)
          ),
        timeoutMs
      )
      try {
        if (request.upload) {
          if (url || request.screenshot || request.script) {
            throw new Error('An upload cannot navigate, capture a screenshot or run a script.')
          }
          return await this.uploadFiles(contents, page, request.upload, signal, markStarted)
        }
        if (request.script) {
          if (url || request.screenshot) throw new Error('Script execution cannot navigate or capture a screenshot.')
          return await this.runScript(contents, page, request.script, signal, timeoutMs, markStarted)
        }
        if (!url && !this.getState().url) throw new Error('The built-in browser has no page open; pass a url.')
        // The page already open and loaded is read as it is; reloading it would discard what was done
        // on it. A pending navigation, a failed load or a crashed page is loaded again.
        if (url && !(url === contents.getURL() && page.readable)) {
          page.expectLoad('agent')
          contents.loadURL(url).catch(() => {
            if (!contents.isDestroyed() && !contents.isLoading()) page.loadEnded()
          })
        }
        const snapshot = await snapshotSettled(contents, signal, page)
        const extracted = extractReadableContent({ html: snapshot.html, url: snapshot.url, visibleText: snapshot.text })
        const fields = { url: snapshot.url, title: snapshot.title || extracted.title || '', content: extracted.content }
        if (request.screenshot) {
          // A screenshot reaches the model as exactly its image, so it hands out neither the page
          // reference nor page events; both stay for the next read or run.
          return { ...fields, screenshot: await this.captureScreenshot(contents, signal) }
        }
        return { ...(page.ref ? { page: page.ref.id } : {}), ...fields, ...page.takeEvents() }
      } finally {
        clearTimeout(timer)
      }
    }

    const queued = this.readQueue.then(run, run)
    this.readQueue = queued.catch(() => undefined)
    const stopped = new Promise<BuiltInBrowserPage>((resolve, reject) => {
      const stop = () => {
        if (!request.script && !request.upload) {
          reject(signal.reason)
          return
        }
        // An operation that never reached the page did not happen; a started one reports its own outcome.
        if (operationStarted) return
        // Waiting behind a busy page can use up the time before the operation starts.
        const timedOut = signal.reason instanceof ReadTimeoutError
        const stoppedEarly = {
          operationId: newOperationId(),
          status: 'not_started' as const,
          code: timedOut ? ('timeout' as const) : ('cancelled' as const),
        }
        const why = timedOut ? 'timed out' : 'was cancelled'
        resolve(
          request.upload
            ? this.uploadResultPage({ ...stoppedEarly, message: `The upload ${why} before the page was touched.` })
            : this.scriptResultPage({ ...stoppedEarly, message: `The run ${why} before the page received it.` })
        )
      }
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
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

  resetPage(): void {
    const host = this.host
    this.dispose()
    if (host && !host.isDestroyed() && !host.webContents.isDestroyed()) {
      host.webContents.send(BUILT_IN_BROWSER_CHANNELS.state, {
        ...EMPTY_BUILT_IN_BROWSER_STATE,
        sessionId: this.sessionId,
      })
    }
  }

  async clearData(): Promise<void> {
    const ses = this.getSession()
    await ses.clearStorageData()
    await ses.clearCache()
    await ses.clearAuthCache()
    await ses.closeAllConnections()
  }

  /**
   * Runs a script on the page `script.page` names. Refusals before the page receives the script
   * report `not_started`; once it is handed over, a timeout or cancellation asks it to stop at its
   * next helper call and reports `unknown`, and its final outcome is delivered with a later result.
   */
  private async runScript(
    contents: WebContents,
    page: PageTracker,
    script: { code: string; page: string; downloadDirectory?: string },
    signal: AbortSignal,
    timeoutMs: number,
    onStart: () => void
  ): Promise<BuiltInBrowserPage> {
    const operationId = newOperationId()
    const ref = pageToActOn(page, script.page, 'running a script')
    if ('code' in ref) {
      const { lastNavigation, ...refusal } = ref
      return this.scriptResultPage(
        { operationId, status: 'not_started', ...refusal },
        lastNavigation ? { lastNavigation } : {},
        false,
        signal
      )
    }
    const refuse = (code: BuiltInBrowserRunErrorCode, message: string) =>
      this.scriptResultPage({ operationId, status: 'not_started', code, message }, {}, false, signal)
    const syntaxError = scriptSyntaxError(script.code)
    if (syntaxError) return refuse('syntax_error', syntaxError)
    const capture = script.downloadDirectory ? await page.downloads.start(script.downloadDirectory) : null
    const withDownloads = async (result: BuiltInBrowserRunResult): Promise<BuiltInBrowserRunResult> => {
      if (!capture) return result
      if (result.status === 'completed') await page.downloads.settle(capture, signal)
      // A cancelled call's result never reaches the model, so its downloads go out with the next result.
      if (wasCancelled(signal)) {
        page.downloads.releaseToEvents(capture)
        return result
      }
      // A download may begin later than the grace period, such as a slow export; while none has, the
      // capture goes on like a timed out run's, until the next operation, user input or the deadline.
      if (result.status === 'completed' && capture.tracked.length === 0) {
        page.downloads.report(capture)
        const deadline = AbortSignal.timeout(BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS)
        deadline.addEventListener('abort', () => page.downloads.releaseToEvents(capture), { once: true })
        return result
      }
      const downloads = page.downloads.release(capture)
      return downloads.length ? { ...result, downloads } : result
    }
    if (signal.aborted) {
      if (capture) page.downloads.release(capture)
      signal.throwIfAborted()
    }
    if (capture) {
      const current = pageToActOn(page, script.page, 'running a script')
      if ('code' in current) {
        page.downloads.release(capture)
        const { lastNavigation, ...refusal } = current
        return this.scriptResultPage(
          { operationId, status: 'not_started', ...refusal },
          lastNavigation ? { lastNavigation } : {},
          false,
          signal
        )
      }
    }

    const document = page.document
    // Registered before the page receives the script, so navigations it starts count as the agent's.
    const running = page.startScript(operationId)
    onStart()
    const pageRun = new PageRun(contents, operationId, script.code, ref.url)
    void pageRun.outcome.then((result) => page.finishScript(running, result))

    const aborted = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null)
      else signal.addEventListener('abort', () => resolve(null), { once: true })
    })
    const finished = await Promise.race([pageRun.outcome, aborted])
    if (finished) {
      return this.scriptResultPage(await withDownloads(finished), {}, page.document === document, signal)
    }

    page.reportUnknown(running)
    const stopped = await pageRun.stopWaiting(signal.reason instanceof ReadTimeoutError ? { timeoutMs } : 'cancelled')
    if (capture && !wasCancelled(signal)) {
      // The script may still start the downloads it was run for; they are saved until it ends and
      // reported with later results. One deadline bounds it all, for a script that never ends, and
      // the next operation on the page ends it sooner.
      const downloads = page.downloads.report(capture)
      const deadline = AbortSignal.timeout(BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS)
      const scriptEnded = new Promise<unknown>((resolve) => {
        void pageRun.outcome.then(resolve)
        deadline.addEventListener('abort', resolve, { once: true })
      })
      void scriptEnded
        .then(() => page.downloads.settle(capture, deadline))
        .then(() => page.downloads.releaseToEvents(capture))
      return this.scriptResultPage(downloads.length ? { ...stopped, downloads } : stopped, {}, false, signal)
    }
    return this.scriptResultPage(await withDownloads(stopped), {}, false, signal)
  }

  /**
   * Hands local files to a file input of the page `upload.page` names. Refusals and file checks come
   * before the page is touched and report `not_started`; the files are handed over through the
   * browser, so the site receives and uploads them with its own code.
   */
  private async uploadFiles(
    contents: WebContents,
    page: PageTracker,
    upload: BuiltInBrowserUploadRequest,
    signal: AbortSignal,
    onStart: () => void
  ): Promise<BuiltInBrowserPage> {
    const operationId = newOperationId()
    const refuseFor = () => {
      const ref = pageToActOn(page, upload.page, 'uploading')
      if (!('code' in ref)) return null
      const { lastNavigation, ...refusal } = ref
      return this.uploadResultPage(
        { operationId, status: 'not_started', ...refusal },
        lastNavigation ? { lastNavigation } : {},
        false,
        signal
      )
    }
    const refused = refuseFor()
    if (refused) return refused
    const inspected = await inspectUploadFiles(upload)
    if ('code' in inspected) {
      return this.uploadResultPage({ operationId, status: 'not_started', ...inspected }, {}, false, signal)
    }
    signal.throwIfAborted()
    // The page may have moved on while the files were checked; they go only to the page that was read.
    const changed = refuseFor()
    if (changed) return changed

    const files = inspected.files
    const document = page.document
    const running = page.startScript(operationId)
    let touched = false
    const result = await handFilesToPage(
      this.debuggerOf(contents),
      upload.target,
      files.map((file) => file.path),
      signal,
      {
        isCurrent: () => page.document === document && !page.loading && page.ref?.id === upload.page,
        isSameDocument: () => page.document === document && !page.loading,
        onTouch: () => {
          touched = true
          onStart()
        },
      }
    ).then(
      (outcome): BuiltInBrowserUploadResult => {
        if (outcome.kind === 'handed') {
          return {
            operationId,
            status: 'completed',
            message:
              "The files were handed to the page's file input. Check the page to confirm the site accepted them.",
            files,
          }
        }
        const { code, message } = outcome
        return { operationId, status: outcome.kind === 'refused' ? 'not_started' : 'failed', code, message }
      },
      (error: unknown): BuiltInBrowserUploadResult => {
        if (signal.aborted) {
          const timedOut = signal.reason instanceof ReadTimeoutError
          return {
            operationId,
            status: touched ? 'unknown' : 'not_started',
            code: timedOut ? 'timeout' : 'cancelled',
            message: touched
              ? 'The wait for the upload ended after the page was touched. Check the page before uploading again.'
              : 'The upload stopped before the page was touched.',
          }
        }
        if (error instanceof DebuggerUnavailableError) {
          return {
            operationId,
            status: touched ? 'unknown' : 'not_started',
            code: 'debugger_unavailable',
            message: touched
              ? `${error.message} The page was already touched; check it before uploading again.`
              : `${error.message} Close the page's developer tools and try again.`,
          }
        }
        if (page.document !== document) {
          return {
            operationId,
            status: touched ? 'unknown' : 'not_started',
            code: 'page_unloaded',
            message: touched
              ? 'The page left its document during the upload. Read it to see what happened.'
              : 'The page left its document before the upload touched it. Read it again.',
          }
        }
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
        return { operationId, status: touched ? 'failed' : 'not_started', message }
      }
    )
    page.finishScript(running, { operationId, status: result.status })
    return this.uploadResultPage(result, {}, page.document === document, signal)
  }

  private debuggerOf(contents: WebContents): PageDebugger {
    let pageDebugger = this.debuggers.get(contents)
    if (!pageDebugger) {
      pageDebugger = new PageDebugger(contents)
      this.debuggers.set(contents, pageDebugger)
    }
    return pageDebugger
  }

  /**
   * A run result with the page shown now. Only a run that returned on the document it started on
   * observed that page, so only then does the result hand out its reference; any other result
   * sends the caller back to read it. Page events are handed out only with a result the caller
   * receives, so a cancelled run leaves them for the next one.
   */
  private scriptResultPage(
    scriptResult: BuiltInBrowserRunResult,
    extra: Pick<BuiltInBrowserPage, 'lastNavigation'> = {},
    sameDocument = false,
    signal?: AbortSignal
  ): BuiltInBrowserPage {
    return this.operationResultPage({ scriptResult }, scriptResult, extra, sameDocument, signal)
  }

  /** An upload result with the page shown now, handed out like a {@link scriptResultPage}. */
  private uploadResultPage(
    uploadResult: BuiltInBrowserUploadResult,
    extra: Pick<BuiltInBrowserPage, 'lastNavigation'> = {},
    sameDocument = false,
    signal?: AbortSignal
  ): BuiltInBrowserPage {
    return this.operationResultPage({ uploadResult }, uploadResult, extra, sameDocument, signal)
  }

  private operationResultPage(
    result: Pick<BuiltInBrowserPage, 'scriptResult' | 'uploadResult'>,
    outcome: { status: BuiltInBrowserRunResult['status']; code?: string },
    extra: Pick<BuiltInBrowserPage, 'lastNavigation'>,
    sameDocument: boolean,
    signal?: AbortSignal
  ): BuiltInBrowserPage {
    const contents = this.view?.webContents
    const live = contents && !contents.isDestroyed() ? contents : null
    const page = this.page
    const observed = sameDocument && (outcome.status === 'completed' || outcome.status === 'failed')
    return {
      ...(observed && page?.ref ? { page: page.ref.id } : {}),
      url: live?.getURL() ?? '',
      title: live?.getTitle() ?? '',
      content: '',
      ...result,
      ...extra,
      ...(page && outcome.code !== 'cancelled' && outcome.code !== 'approval_required' && !wasCancelled(signal)
        ? page.takeEvents()
        : {}),
    }
  }

  private async captureScreenshot(contents: WebContents, signal: AbortSignal): Promise<BuiltInBrowserScreenshot> {
    const view = this.view
    const host = this.host
    if (!view || !host || view.getVisible()) return captureViewport(contents, signal)
    signal.throwIfAborted()
    const bounds = view.getBounds()
    // Hidden native views have no capture surface. A never-shown window lets Chromium
    // render this same page without exposing it over the conversation the user is viewing.
    const captureHost = new BrowserWindow({
      show: false,
      focusable: false,
      skipTaskbar: true,
      width: bounds.width,
      height: bounds.height,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    const restore = () => {
      if (this.restoreCapture !== restore) return
      this.restoreCapture = null
      if (!captureHost.isDestroyed()) captureHost.contentView.removeChildView(view)
      if (!contents.isDestroyed()) {
        view.setVisible(false)
        view.setBounds(bounds)
        if (!host.isDestroyed()) host.contentView.addChildView(view)
      }
      if (!captureHost.isDestroyed()) captureHost.destroy()
    }
    this.restoreCapture = restore
    try {
      host.contentView.removeChildView(view)
      captureHost.contentView.addChildView(view)
      view.setBounds({ ...bounds, x: 0, y: 0 })
      view.setVisible(true)
      return await captureViewport(contents, signal)
    } finally {
      restore()
    }
  }

  private isReading(): boolean {
    return this.activeReads.size > 0
  }

  private ensureView(host: BrowserWindow): { view: WebContentsView; page: PageTracker } {
    if (!this.view || !this.page || this.view.webContents.isDestroyed()) {
      const created = this.createView()
      this.view = created.view
      this.page = created.page
    }
    if (this.host !== host) {
      if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(this.view)
      this.host = host
      this.view.setVisible(false)
      host.contentView.addChildView(this.view)
      if (this.manageHostLifecycle) host.once('closed', () => this.releaseHost(host))
    }
    return { view: this.view, page: this.page }
  }

  /** A closed window takes the page with it; reads waiting on that page are cancelled. */
  private releaseHost(host: BrowserWindow): void {
    if (this.host !== host) return
    this.restoreCapture?.()
    this.host = null
    for (const active of this.activeReads.values()) active.cancel()
    const view = this.view
    this.view = null
    this.page = null
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
  }

  private createView(): { view: WebContentsView; page: PageTracker } {
    const view = new WebContentsView({
      webPreferences: {
        session: this.getSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    view.setBounds({ x: 0, y: 0, ...BUILT_IN_BROWSER_DEFAULT_VIEWPORT })
    view.setBackgroundColor('#ffffff')
    const contents = view.webContents
    // Sign-in flows often open a popup; keep them in the sidebar so they share the profile.
    const page = new PageTracker(contents)
    contents.setWindowOpenHandler(({ url }) => {
      page.expectPageNavigation()
      contents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    const push = () => this.pushState()
    contents.on('did-start-loading', push)
    contents.on('did-stop-loading', push)
    contents.on('did-navigate', push)
    contents.on('did-navigate-in-page', push)
    contents.on('page-title-updated', push)
    return { view, page }
  }

  private pushState(): void {
    const host = this.host
    if (!host || host.isDestroyed()) return
    host.webContents.send(BUILT_IN_BROWSER_CHANNELS.state, { ...this.getState(), sessionId: this.sessionId })
  }
}

/**
 * The page `requested` names, when an operation may act on it now; otherwise why not: the page
 * failed, changed since it was read, is loading, or is still busy with an earlier run.
 */
function pageToActOn(
  page: PageTracker,
  requested: string,
  action: string
):
  | PageRef
  | {
      code: 'no_page' | 'page_changed' | 'busy'
      message: string
      lastNavigation?: BuiltInBrowserPage['lastNavigation']
    } {
  const failure = page.failed
  if (failure) return { code: 'no_page', message: `${failure}. Read its url again to reload it.` }
  const ref = page.ref
  if (!ref) return { code: 'no_page', message: 'The built-in browser has no page open; read a url first.' }
  if (requested !== ref.id || page.loading) {
    const navigation = page.lastNavigation
    return {
      code: 'page_changed',
      message:
        requested === ref.id
          ? `The page is loading another document. Read it again before ${action}.`
          : `The page changed since it was read. Read it again before ${action}.`,
      ...(navigation ? { lastNavigation: navigation } : {}),
    }
  }
  const earlier = page.busyWith()
  if (earlier) {
    return {
      code: 'busy',
      message: `Run ${earlier} on this page has not finished. Check the page for its effects, then retry; runs are allowed again once it finishes, the page reloads, or ${BUSY_WINDOW_MS / 1000} seconds after it was reported.`,
    }
  }
  return ref
}

const MAX_SNAPSHOT_ATTEMPTS = 4
const SCREENSHOT_JPEG_QUALITY = 80

/** Captures the visible viewport, downscaled so its longest side fits a model image. */
async function captureViewport(contents: WebContents, signal: AbortSignal): Promise<BuiltInBrowserScreenshot> {
  // A capture that never settles must not hold the read queue after the read is cancelled.
  const captured = await new Promise<NativeImage>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    contents
      .capturePage(undefined, { stayHidden: true })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
  if (captured.isEmpty()) {
    throw new Error('The built-in browser page is not visible, so it cannot be captured. Open the sidebar browser.')
  }
  const size = captured.getSize()
  const scale = Math.min(1, BUILT_IN_BROWSER_SCREENSHOT_MAX_DIMENSION / Math.max(size.width, size.height))
  const image =
    scale < 1
      ? captured.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good',
        })
      : captured
  const output = image.getSize()
  return {
    base64Data: image.toJPEG(SCREENSHOT_JPEG_QUALITY).toString('base64'),
    mediaType: 'image/jpeg',
    width: output.width,
    height: output.height,
  }
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
async function snapshotSettled(contents: WebContents, signal: AbortSignal, page: PageTracker): Promise<PageSnapshot> {
  for (let attempt = 1; ; attempt += 1) {
    await page.whenReadable(signal)
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
