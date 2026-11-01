import {
  BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS,
  BUILT_IN_BROWSER_DEFAULT_VIEWPORT,
  BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS,
  BUILT_IN_BROWSER_SCREENSHOT_MAX_DIMENSION,
  type BuiltInBrowserCall,
  type BuiltInBrowserNavigation,
  type BuiltInBrowserPageEvents,
  type BuiltInBrowserPageView,
  type BuiltInBrowserReadResult,
  type BuiltInBrowserRequestKind,
  type BuiltInBrowserResults,
  type BuiltInBrowserRunErrorCode,
  type BuiltInBrowserRunPage,
  type BuiltInBrowserRunResult,
  type BuiltInBrowserScreenshot,
  type BuiltInBrowserScreenshotResult,
  type BuiltInBrowserSnapshotRequest,
  type BuiltInBrowserSnapshotResult,
  type BuiltInBrowserState,
  type BuiltInBrowserUploadPage,
  type BuiltInBrowserUploadResult,
  type BuiltInBrowserViewRequest,
  EMPTY_BUILT_IN_BROWSER_STATE,
} from '@shared/built-in-browser'
import { BrowserWindow, type NativeImage, type Session, session, type WebContents, WebContentsView } from 'electron'
import { extractReadableContent } from './extract'
import { DebuggerUnavailableError, PageDebugger } from './page-debugger'
import { type DownloadLocation, downloadLocationOf, isOwnDirectory, routeDownload } from './page-downloads'
import { PageOperation, type PageRefusal, pageToActOn, ReadTimeoutError } from './page-operation'
import { type PageOutcomeTarget, PendingOutcomes } from './page-outcomes'
import { PageRun, reportFailedRequest } from './page-run'
import { type PageSnapshotOutcome, pageOfLines, pageSnapshotSource } from './page-snapshot'
import { PageTracker } from './page-tracker'
import { handFilesToPage, inspectUploadFiles } from './page-upload'
import { scriptSyntaxError } from './script-run'
import { normalizeBrowserUrl } from './url'

/** Persistent profile of the built-in browser; sign-ins made in the sidebar are kept here. */
export const BUILT_IN_BROWSER_PARTITION = 'persist:chatbox-built-in-browser'

const MAX_HTML_CHARS = 3_000_000
const SNAPSHOT_DEFAULT_CHARS = 12_000
const SNAPSHOT_MAX_CHARS = 50_000
const RENDER_SETTLE_MAX_MS = 8_000

/**
 * Resolves to `collect`, evaluated once the page's visible text stops growing, so client-rendered
 * pages are observed after their content arrives instead of at the first paint.
 */
function settledSource(collect: string): string {
  return `new Promise((resolve) => {
  const started = Date.now();
  let lastLength = -1;
  let stableTicks = 0;
  const snapshot = () => resolve(${collect});
  const tick = () => {
    const length = document.body ? document.body.innerText.length : 0;
    stableTicks = length > 0 && length === lastLength ? stableTicks + 1 : 0;
    lastLength = length;
    if (stableTicks >= 2 || Date.now() - started > ${RENDER_SETTLE_MAX_MS}) snapshot();
    else setTimeout(tick, 400);
  };
  tick();
})`
}

const READ_SOURCE = settledSource(`({
    url: location.href,
    title: document.title || '',
    html: document.documentElement ? document.documentElement.outerHTML.slice(0, ${MAX_HTML_CHARS}) : '',
    text: document.body ? document.body.innerText : '',
  })`)

interface PageSnapshot {
  url: string
  title: string
  html: string
  text: string
}

const SNAPSHOT_TIMEOUT_MS = 200

/** Hands `result` to the caller in place of the operation's own, which then reaches no one. */
function answered<Result>(operation: PageOperation, result: Result): Result {
  operation.answer()
  return result
}

/** What a queued request works with once it starts. */
interface RequestContext {
  contents: WebContents
  page: PageTracker
  signal: AbortSignal
  /** The normalized url an observing request opens. */
  url?: string
  timeoutMs: number
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
 * Owns one page view of the built-in browser, the page of one tab. The view lives in the app
 * window that last showed it; it keeps its page while the panel is closed so the model and the
 * user continue from the same page.
 */
export class BuiltInBrowserController {
  private static configuredSession: Session | null = null
  private view: WebContentsView | null = null
  /** State of the page `view` shows; created and dropped together with it. */
  private page: PageTracker | null = null
  private host: BrowserWindow | null = null
  private readonly activeRequests = new Map<string, { ownerId: number; cancel: () => void }>()
  private requestQueue: Promise<unknown> = Promise.resolve()
  /** Orders view requests, so a hide that waits on a snapshot never undoes a later placement. */
  private viewGeneration = 0
  private restoreCapture: (() => void) | null = null
  private readonly debuggers = new WeakMap<WebContents, PageDebugger>()

  constructor(
    private readonly sessionId?: string,
    private readonly manageHostLifecycle = true,
    /** Called whenever {@link getState} may have changed. */
    private readonly onStateChange?: () => void,
    /** Where the pages report what ends after their results; a queue of this page's own by default. */
    private readonly outcomeTarget: PageOutcomeTarget = { outcomes: new PendingOutcomes() }
  ) {}

  dispose(): void {
    this.restoreCapture?.()
    ++this.viewGeneration
    for (const active of this.activeRequests.values()) active.cancel()
    this.activeRequests.clear()
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

  /** Stops saving downloads for a run of this page that already returned; a run still going keeps its own. */
  endLingeringCapture(): void {
    this.page?.downloads.endLingeringCapture()
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
   * Attaches the view to `host` and places it, or hides it. Snapshot requests resolve to a still
   * of the page; visible captures let the renderer prepare its replacement before hiding the view.
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
    if (!request.snapshot) return null
    const captured = await captureWithin(view.webContents, SNAPSHOT_TIMEOUT_MS)
    if (generation !== this.viewGeneration || !captured || captured.isEmpty()) return null
    return `data:image/jpeg;base64,${captured.toJPEG(85).toString('base64')}`
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
   * Handles one request at a time; the page stays open in the sidebar for the user afterwards.
   * Cancelling or timing out settles the caller at once and stops the request's waits.
   */
  request<Call extends BuiltInBrowserCall>(
    host: BrowserWindow,
    ownerId: number,
    call: Call
  ): Promise<BuiltInBrowserResults[Call['kind']]> {
    // Each branch resolves to its kind's result, which the switch cannot relate to `Call`.
    return this.perform(host, ownerId, call) as Promise<BuiltInBrowserResults[Call['kind']]>
  }

  cancel(ownerId: number, requestId: string): void {
    const active = this.activeRequests.get(requestId)
    if (active && active.ownerId === ownerId) active.cancel()
  }

  private perform(
    host: BrowserWindow,
    ownerId: number,
    call: BuiltInBrowserCall
  ): Promise<BuiltInBrowserResults[BuiltInBrowserRequestKind]> {
    const abort = new AbortController()
    switch (call.kind) {
      case 'run': {
        const operation = new PageOperation(abort.signal, 'run')
        return this.enqueue(host, ownerId, call, abort, (context) => this.runScript(context, operation, call), {
          onStop: () =>
            operation.touched ? null : answered(operation, this.runPage(operation, operation.stoppedBeforeTouch())),
        })
      }
      case 'upload': {
        const operation = new PageOperation(abort.signal, 'upload')
        return this.enqueue(host, ownerId, call, abort, (context) => this.uploadFiles(context, operation, call), {
          onStop: () =>
            operation.touched ? null : answered(operation, this.uploadPage(operation, operation.stoppedBeforeTouch())),
        })
      }
      case 'read':
      case 'screenshot':
      case 'snapshot':
        return this.enqueue(host, ownerId, call, abort, (context) => this.observe(context, call))
      default: {
        // Requests arrive over IPC, so their kind is checked at run time too.
        const unknown: never = call
        const { kind } = unknown as { kind?: unknown }
        return Promise.reject(new Error(`Unknown built-in browser request: ${String(kind)}`))
      }
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
   * Queues `perform` behind earlier requests and bounds it by the call's timeout. When the call is
   * cancelled or times out, `onStop` settles the caller at once with its result, or returns null
   * to let an operation that touched the page report its own outcome. Without `onStop` the caller
   * receives the abort reason.
   */
  private enqueue<Result>(
    host: BrowserWindow,
    ownerId: number,
    call: BuiltInBrowserCall,
    abort: AbortController,
    perform: (context: RequestContext) => Promise<Result>,
    options: { onStop?: () => Result | null } = {}
  ): Promise<Result> {
    if (this.activeRequests.has(call.requestId)) {
      return Promise.reject(new Error(`Built-in browser request already exists: ${call.requestId}`))
    }
    const { signal } = abort
    this.activeRequests.set(call.requestId, {
      ownerId,
      cancel: () => abort.abort(new Error('Built-in browser request was cancelled')),
    })
    this.pushState()

    const run = async (): Promise<Result> => {
      signal.throwIfAborted()
      const { view, page } = this.ensureView(host)
      const contents = view.webContents
      // Downloads are saved only for the run that asked for them, so every request ends what an
      // earlier timed out run left capturing.
      page.downloads.endEarlierCapture()
      // The host may have changed since the request was queued; tell it a request is running.
      this.pushState()
      const url = 'url' in call && call.url ? normalizeBrowserUrl(call.url) : undefined
      const timeoutMs = Math.min(
        Math.max(call.timeoutMs ?? BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS, 1_000),
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
        return await perform({ contents, page, signal, url, timeoutMs })
      } finally {
        clearTimeout(timer)
      }
    }

    const queued = this.requestQueue.then(run, run)
    this.requestQueue = queued.catch(() => undefined)
    const stopped = new Promise<Result>((resolve, reject) => {
      const stop = () => {
        if (!options.onStop) {
          reject(signal.reason)
          return
        }
        const result = options.onStop()
        if (result) resolve(result)
      }
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    })
    return Promise.race([queued, stopped]).finally(() => {
      this.activeRequests.delete(call.requestId)
      this.pushState()
    })
  }

  /** Reads, outlines or captures `url`, or the page shown when it is omitted, once it settles. */
  private async observe(
    context: RequestContext,
    call: Extract<BuiltInBrowserCall, { kind: 'read' | 'screenshot' | 'snapshot' }>
  ): Promise<BuiltInBrowserReadResult | BuiltInBrowserScreenshotResult | BuiltInBrowserSnapshotResult> {
    const { contents, page, signal, url } = context
    if (!url && !this.getState().url) throw new Error('The built-in browser has no page open; pass a url.')
    // The page already open and loaded is observed as it is; reloading it would discard what was
    // done on it. A pending navigation, a failed load or a crashed page is loaded again.
    if (url && !(url === contents.getURL() && page.readable)) {
      page.expectLoad('agent')
      contents.loadURL(url).catch(() => {
        if (!contents.isDestroyed() && !contents.isLoading()) page.loadEnded()
      })
    }
    if (call.kind === 'snapshot') return this.snapshotPage(contents, page, call, signal)
    const snapshot = await snapshotSettled(contents, signal, page)
    const extracted = extractReadableContent({ html: snapshot.html, url: snapshot.url, visibleText: snapshot.text })
    const fields = { url: snapshot.url, title: snapshot.title || extracted.title || '' }
    if (call.kind === 'screenshot') {
      // A screenshot reaches the model as exactly its image, so it hands out neither the page
      // reference nor page events; both stay for the next result.
      return { ...fields, screenshot: await this.captureScreenshot(contents, signal) }
    }
    return {
      ...(page.ref ? { page: page.ref.id } : {}),
      ...fields,
      content: extracted.content,
      readMode: extracted.mode,
      ...page.takeEvents(),
    }
  }

  /** The conversation's download folder in Chatbox data. */
  private downloadLocation(): DownloadLocation {
    if (!this.sessionId) throw new Error('Downloads are saved only for a conversation.')
    return downloadLocationOf(this.sessionId)
  }

  /**
   * Runs a script on the page `call.page` names. Refusals before the page receives the script
   * report `not_started`; once it is handed over, a timeout or cancellation asks it to stop at its
   * next helper call and reports `unknown`, and its final outcome is delivered with a later result.
   *
   * With `download`, files the run downloads are saved to the conversation's download folder. The
   * run waits a moment for them after its script returns; downloads that begin later, while the
   * script goes on after a timeout or a slow server prepares a file, are saved until the next
   * request, user input or a deadline, and reported with a later result.
   */
  private async runScript(
    context: RequestContext,
    operation: PageOperation,
    call: Extract<BuiltInBrowserCall, { kind: 'run' }>
  ): Promise<BuiltInBrowserRunPage> {
    const { contents, page, signal, timeoutMs } = context
    const refuse = (refusal: { code: BuiltInBrowserRunErrorCode; message: string } | PageRefusal) => {
      const { lastNavigation, ...rest } = refusal as PageRefusal
      return this.runPage(
        operation,
        { operationId: operation.id, status: 'not_started', ...rest },
        lastNavigation ? { lastNavigation } : {}
      )
    }
    const ref = pageToActOn(page, call.page, 'running a script')
    if ('code' in ref) return refuse(ref)
    const syntaxError = scriptSyntaxError(call.code)
    if (syntaxError) return refuse({ code: 'syntax_error', message: syntaxError })
    const capture = call.download ? await page.downloads.start(this.downloadLocation()) : null
    const withDownloads = async (result: BuiltInBrowserRunResult): Promise<BuiltInBrowserRunResult> => {
      if (!capture) return result
      if (result.status === 'completed') await page.downloads.settle(capture, signal)
      // A cancelled call's result never reaches the model, so its downloads go out with the next result.
      if (operation.cancelled) {
        page.downloads.releaseToEvents(capture)
        return result
      }
      // A download may begin later than the grace period, such as a slow export; while none has, the
      // capture goes on like a timed out run's, until the next request, user input or the deadline.
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
      // The page may have moved on while the download folder was prepared.
      const current = pageToActOn(page, call.page, 'running a script')
      if ('code' in current) {
        page.downloads.release(capture)
        return refuse(current)
      }
    }

    const document = page.document
    // Registered before the page receives the script, so navigations it starts count as the agent's.
    const running = page.startScript(operation.id)
    operation.touch()
    const pageRun = new PageRun(contents, operation.id, call.code, ref.url)
    void pageRun.outcome.then((result) => page.finishScript(running, result))

    const aborted = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null)
      else signal.addEventListener('abort', () => resolve(null), { once: true })
    })
    const finished = await Promise.race([pageRun.outcome, aborted])
    if (finished) return this.runPage(operation, await withDownloads(finished), {}, page.document === document)

    page.reportUnknown(running)
    const stopped = await pageRun.stopWaiting(operation.timedOut ? { timeoutMs } : 'cancelled')
    if (capture && !operation.cancelled) {
      // The script may still start the downloads it was run for; they are saved until it ends and
      // reported with later results. One deadline bounds it all, for a script that never ends, and
      // the next request on the page ends it sooner.
      const downloads = page.downloads.report(capture)
      const deadline = AbortSignal.timeout(BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS)
      const scriptEnded = new Promise<unknown>((resolve) => {
        void pageRun.outcome.then(resolve)
        deadline.addEventListener('abort', resolve, { once: true })
      })
      void scriptEnded
        .then(() => page.downloads.settle(capture, deadline))
        .then(() => page.downloads.releaseToEvents(capture))
      return this.runPage(operation, downloads.length ? { ...stopped, downloads } : stopped)
    }
    return this.runPage(operation, await withDownloads(stopped))
  }

  /**
   * Hands local files to a file input of the page `call.page` names. Refusals and file checks come
   * before the page is touched and report `not_started`; the files are handed over through the
   * browser, so the site receives and uploads them with its own code.
   */
  private async uploadFiles(
    context: RequestContext,
    operation: PageOperation,
    call: Extract<BuiltInBrowserCall, { kind: 'upload' }>
  ): Promise<BuiltInBrowserUploadPage> {
    const { contents, page, signal } = context
    const refuseFor = () => {
      const ref = pageToActOn(page, call.page, 'uploading')
      if (!('code' in ref)) return null
      const { lastNavigation, ...refusal } = ref
      return this.uploadPage(
        operation,
        { operationId: operation.id, status: 'not_started', ...refusal },
        lastNavigation ? { lastNavigation } : {}
      )
    }
    const refused = refuseFor()
    if (refused) return refused
    // Files the conversation's runs downloaded are its own, like those of its working directory,
    // while their folder is the real one in Chatbox data.
    const { allowedRoots } = call
    const downloads = allowedRoots && this.sessionId ? this.downloadLocation() : null
    const inspected = await inspectUploadFiles(
      allowedRoots && downloads && (await isOwnDirectory(downloads))
        ? { ...call, allowedRoots: [...allowedRoots, downloads.directory] }
        : call
    )
    if ('code' in inspected) {
      return this.uploadPage(operation, { operationId: operation.id, status: 'not_started', ...inspected })
    }
    signal.throwIfAborted()
    // The page may have moved on while the files were checked; they go only to the page that was read.
    const changed = refuseFor()
    if (changed) return changed

    const files = inspected.files
    const document = page.document
    const running = page.startScript(operation.id)
    const result = await handFilesToPage(
      this.debuggerOf(contents),
      call.target,
      files.map((file) => file.path),
      signal,
      {
        isCurrent: () => page.document === document && !page.loading && page.ref?.id === call.page,
        isSameDocument: () => page.document === document && !page.loading,
        onTouch: () => operation.touch(),
      }
    ).then(
      (outcome): BuiltInBrowserUploadResult => {
        if (outcome.kind === 'handed') {
          return {
            operationId: operation.id,
            status: 'completed',
            message:
              "The files were handed to the page's file input. Check the page to confirm the site accepted them.",
            files,
          }
        }
        const { code, message } = outcome
        return {
          operationId: operation.id,
          status: outcome.kind === 'refused' ? 'not_started' : 'failed',
          code,
          message,
        }
      },
      (error: unknown): BuiltInBrowserUploadResult => {
        const { touched } = operation
        const status = touched ? 'unknown' : 'not_started'
        if (signal.aborted) {
          return {
            operationId: operation.id,
            status,
            code: operation.timedOut ? 'timeout' : 'cancelled',
            message: touched
              ? 'The wait for the upload ended after the page was touched. Check the page before uploading again.'
              : 'The upload stopped before the page was touched.',
          }
        }
        if (error instanceof DebuggerUnavailableError) {
          return {
            operationId: operation.id,
            status,
            code: 'debugger_unavailable',
            message: touched
              ? `${error.message} The page was already touched; check it before uploading again.`
              : `${error.message} Close the page's developer tools and try again.`,
          }
        }
        if (page.document !== document) {
          return {
            operationId: operation.id,
            status,
            code: 'page_unloaded',
            message: touched
              ? 'The page left its document during the upload. Read it to see what happened.'
              : 'The page left its document before the upload touched it. Read it again.',
          }
        }
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
        return { operationId: operation.id, status: touched ? 'failed' : 'not_started', message }
      }
    )
    page.finishScript(running, { operationId: operation.id, status: result.status })
    return this.uploadPage(operation, result, {}, page.document === document)
  }

  /**
   * Outlines the current document once it settles, like a read. References in it name elements of
   * this document and stay the same in later snapshots of it.
   */
  private async snapshotPage(
    contents: WebContents,
    page: PageTracker,
    request: BuiltInBrowserSnapshotRequest,
    signal: AbortSignal
  ): Promise<BuiltInBrowserSnapshotResult> {
    const { scope, query, cursor } = request
    const observed = await observeSettled(
      contents,
      signal,
      page,
      settledSource(`({
    url: location.href,
    title: document.title || '',
    tree: ${pageSnapshotSource({ ...(scope ? { scope } : {}), ...(query ? { query } : {}) })},
  })`)
    )
    const tree = (observed.tree ?? {}) as Partial<PageSnapshotOutcome>
    const reference = page.ref?.id
    const fields = {
      ...(reference ? { page: reference } : {}),
      url: String(observed.url ?? contents.getURL()),
      title: String(observed.title ?? ''),
    }
    if (typeof tree.error === 'string' || !Array.isArray(tree.lines)) {
      const error = typeof tree.error === 'string' ? tree.error : 'The page returned no snapshot.'
      return { ...fields, content: '', snapshot: { totalLines: 0, error }, ...page.takeEvents() }
    }
    const maxChars = Math.min(Math.max(request.maxChars ?? SNAPSHOT_DEFAULT_CHARS, 1_000), SNAPSHOT_MAX_CHARS)
    const lines = tree.lines.map((line) => String(line))
    const shown = pageOfLines(lines, { page: reference ?? '', scope, query, cursor, maxChars })
    return {
      ...fields,
      content: shown.content,
      snapshot: {
        totalLines: shown.totalLines,
        ...(shown.nextCursor ? { nextCursor: shown.nextCursor } : {}),
        ...(shown.restarted ? { restarted: true as const } : {}),
        ...(tree.modal ? { modal: true as const } : {}),
        ...(tree.truncated ? { truncated: true as const } : {}),
      },
      ...page.takeEvents(),
    }
  }

  private debuggerOf(contents: WebContents): PageDebugger {
    let pageDebugger = this.debuggers.get(contents)
    if (!pageDebugger) {
      pageDebugger = new PageDebugger(contents)
      this.debuggers.set(contents, pageDebugger)
    }
    return pageDebugger
  }

  /** A run result with the page shown now; see {@link operationView}. */
  private runPage(
    operation: PageOperation,
    run: BuiltInBrowserRunResult,
    extra: { lastNavigation?: BuiltInBrowserNavigation } = {},
    sameDocument = false
  ): BuiltInBrowserRunPage {
    return { ...this.operationView(operation, run, sameDocument), run, ...extra }
  }

  /** An upload result with the page shown now; see {@link operationView}. */
  private uploadPage(
    operation: PageOperation,
    upload: BuiltInBrowserUploadResult,
    extra: { lastNavigation?: BuiltInBrowserNavigation } = {},
    sameDocument = false
  ): BuiltInBrowserUploadPage {
    return { ...this.operationView(operation, upload, sameDocument), upload, ...extra }
  }

  /**
   * The page shown after an operation. Only an operation that ended on the document it started on
   * observed that page, so only then does the result hand out its reference; any other result
   * sends the caller back to read it. Page events go out only with a result the model receives.
   */
  private operationView(
    operation: PageOperation,
    outcome: { status: BuiltInBrowserRunResult['status']; code?: string },
    sameDocument: boolean
  ): BuiltInBrowserPageView {
    const contents = this.view?.webContents
    const live = contents && !contents.isDestroyed() ? contents : null
    const page = this.page
    const observed = sameDocument && (outcome.status === 'completed' || outcome.status === 'failed')
    return {
      ...(observed && page?.ref ? { page: page.ref.id } : {}),
      url: live?.getURL() ?? '',
      title: live?.getTitle() ?? '',
      ...(page && operation.deliversEvents(outcome.code) ? page.takeEvents() : {}),
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
    return this.activeRequests.size > 0
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

  /** A closed window takes the page with it; requests waiting on that page are cancelled. */
  private releaseHost(host: BrowserWindow): void {
    if (this.host !== host) return
    this.restoreCapture?.()
    this.host = null
    for (const active of this.activeRequests.values()) active.cancel()
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
    const page = new PageTracker(contents, this.outcomeTarget)
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
    this.onStateChange?.()
  }
}

/** Reads the current document's text once it settles; see {@link observeSettled}. */
async function snapshotSettled(contents: WebContents, signal: AbortSignal, page: PageTracker): Promise<PageSnapshot> {
  const snapshot = await observeSettled(contents, signal, page, READ_SOURCE)
  return {
    url: String(snapshot.url ?? contents.getURL()),
    title: String(snapshot.title ?? ''),
    html: String(snapshot.html ?? ''),
    text: String(snapshot.text ?? ''),
  }
}

const MAX_SNAPSHOT_ATTEMPTS = 4
const SCREENSHOT_JPEG_QUALITY = 80

/** Captures the visible viewport, downscaled so its longest side fits a model image. */
async function captureViewport(contents: WebContents, signal: AbortSignal): Promise<BuiltInBrowserScreenshot> {
  // A capture that never settles must not hold the request queue after the request is cancelled.
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
 * Evaluates `source`, a {@link settledSource}, on the current document once it is ready. A
 * client-side redirect or a navigation by the user replaces the document while it runs, so it
 * restarts on the new one. Pages may never finish loading, so DOM ready is enough to start.
 */
async function observeSettled(
  contents: WebContents,
  signal: AbortSignal,
  page: PageTracker,
  source: string
): Promise<Record<string, unknown>> {
  for (let attempt = 1; ; attempt += 1) {
    await page.whenReadable(signal)
    const attemptDone = new AbortController()
    const stopAttempt = () => attemptDone.abort()
    signal.addEventListener('abort', stopAttempt, { once: true })
    try {
      const outcome = await Promise.race([
        contents.executeJavaScript(source, true).then((observed: unknown) => ({ observed })),
        waitForNavigation(contents, attemptDone.signal).then(() => ({ observed: null })),
      ])
      signal.throwIfAborted()
      if (outcome.observed && typeof outcome.observed === 'object') return outcome.observed as Record<string, unknown>
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
