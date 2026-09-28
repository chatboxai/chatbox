import { randomBytes } from 'node:crypto'
import type {
  BuiltInBrowserNavigation,
  BuiltInBrowserNavigationSource,
  BuiltInBrowserPage,
  BuiltInBrowserRunResult,
  BuiltInBrowserSettledOperation,
} from '@shared/built-in-browser'
import type { WebContents } from 'electron'

/** How long a run reported as unknown keeps other runs on its page waiting. */
export const BUSY_WINDOW_MS = 10_000

/** Input the user makes in the page; pointer moves and hovers do not count as taking over. */
const USER_INPUT_TYPES = new Set([
  'mouseDown',
  'rawKeyDown',
  'keyDown',
  'char',
  'mouseWheel',
  'gestureTap',
  'touchStart',
])

/** The page a reference names: one main-frame document at one URL. */
export interface PageRef {
  id: string
  url: string
}

export interface RunningScript {
  operationId: string
  startedAt: number
  /** Set once the caller was told the outcome is unknown; the final outcome is then kept for it. */
  reportedAt?: number
}

/**
 * State of the document a view shows. `loading` is committed but not DOM ready yet; `failed` is an
 * error page or a crashed renderer. A navigation in flight is tracked separately, because one that
 * ends without committing leaves this state as it was.
 */
type DocumentStatus = 'none' | 'loading' | 'ready' | 'failed'

/**
 * What the agent needs to know about the page one view shows: the state of its current document
 * and the reference naming it, who navigated it, the script running in it, and what happened on it
 * since the previous result. It lives exactly as long as the view, so a new view starts with none
 * of it.
 */
export class PageTracker {
  private status: DocumentStatus = 'none'
  /** Why the document shown failed, when it did. */
  private failure = ''
  /** A main-frame navigation to another document started and has not committed or ended. */
  private navigating = false
  /** Re-checks of reads waiting for a readable document, run after every change of state. */
  private readonly waiters = new Set<() => void>()
  private readonly refPrefix = randomBytes(3).toString('hex')
  private revision = 0
  /** Counts committed main-frame documents; same-document URL changes leave it as is. */
  private documents = 0
  private currentRef: PageRef | null = null
  private navigation: BuiltInBrowserNavigation | null = null
  /** Source of the next navigation started through the controller rather than by the page. */
  private pendingSource: BuiltInBrowserNavigationSource | null = null
  private userInteracted = false
  private lastInputAt = 0
  private running: RunningScript | null = null
  private settled: BuiltInBrowserSettledOperation[] = []

  constructor(contents: WebContents) {
    contents.on('did-start-navigation', (event) => {
      if (!event.isMainFrame) return
      if (!event.isSameDocument) this.navigating = true
      // A same-document update that keeps the URL, such as replaceState on load, moves nothing.
      if (event.isSameDocument && event.url === this.currentRef?.url) return
      // Navigations the page starts have an initiator frame; the others are started through the controller.
      let source: BuiltInBrowserNavigationSource
      if (event.initiator) {
        source = this.pageSource()
      } else {
        source = this.pendingSource ?? 'unknown'
        this.pendingSource = null
      }
      this.navigation = { source, url: event.url }
    })
    // Every committed main-frame document or URL gets a new reference, so a reload of the same URL
    // invalidates what was read before it.
    const renew = () => {
      this.currentRef = { id: `${this.refPrefix}-${++this.revision}`, url: contents.getURL() }
    }
    contents.on('did-navigate', () => {
      this.documents += 1
      this.navigating = false
      renew()
      // The previous document and any script still running in it are gone.
      this.running = null
      this.setStatus('loading')
    })
    contents.on('dom-ready', () => {
      if (this.status === 'loading') this.setStatus('ready')
    })
    // A navigation that ends without a document (a download, a 204 response, Stop) leaves the
    // document shown as it was; one committed but stopped before DOM ready is as ready as it gets.
    contents.on('did-stop-loading', () => {
      this.navigating = false
      this.setStatus(this.status === 'loading' ? 'ready' : this.status)
    })
    contents.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
      // ERR_ABORTED (-3) is a navigation replaced by another one, not a failed page.
      if (!isMainFrame || errorCode === -3) return
      this.fail(`Failed to load ${url}: ${description} (${errorCode})`)
    })
    // `replaceState` without a new URL also fires this; the page a reference names is unchanged then.
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame && contents.getURL() !== this.currentRef?.url) renew()
    })
    contents.on('input-event', (_event, input) => {
      if (!USER_INPUT_TYPES.has(input.type)) return
      this.userInteracted = true
      this.lastInputAt = Date.now()
    })
    contents.on('render-process-gone', (_event, details) => this.fail(`The page crashed (${details.reason})`))
  }

  /** The document shown is ready and no navigation is replacing it. */
  get readable(): boolean {
    return !this.navigating && this.status === 'ready'
  }

  /** The document is being replaced or has not reached DOM ready. */
  get loading(): boolean {
    return this.navigating || this.status === 'loading'
  }

  /** Why the document shown failed, or undefined while it has not. */
  get failed(): string | undefined {
    return this.status === 'failed' ? this.failure : undefined
  }

  /** Starts a controller load; it counts as in flight until a document commits or loading ends. */
  expectLoad(source: BuiltInBrowserNavigationSource): void {
    this.pendingSource = source
    this.navigating = true
  }

  /** A controller load that ended before loading started, such as one the page's beforeunload cancelled. */
  loadEnded(): void {
    this.navigating = false
    this.notify()
  }

  /** Resolves once the document can be read; rejects when it failed or on abort. */
  whenReadable(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        if (signal.aborted) reject(signal.reason)
        else if (this.readable) resolve()
        else if (!this.navigating && this.status === 'failed') reject(new Error(this.failure))
        else return false
        return true
      }
      if (check()) return
      const waiter = () => {
        if (!check()) return
        this.waiters.delete(waiter)
        signal.removeEventListener('abort', waiter)
      }
      this.waiters.add(waiter)
      signal.addEventListener('abort', waiter, { once: true })
    })
  }

  /** A failed document has nothing to run on or refer to until another one commits. */
  private fail(message: string): void {
    this.navigating = false
    this.currentRef = null
    this.running = null
    this.failure = message
    this.setStatus('failed')
  }

  private setStatus(status: DocumentStatus): void {
    this.status = status
    this.notify()
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter()
  }

  /** The reference of the committed document, or null before any document committed. */
  get ref(): PageRef | null {
    return this.currentRef
  }

  /** Identifies the committed document, so a caller can tell whether it was replaced meanwhile. */
  get document(): number {
    return this.documents
  }

  get lastNavigation(): BuiltInBrowserNavigation | null {
    return this.navigation
  }

  /** Attributes the next controller-started navigation, such as a sidebar reload or a read of a url. */
  expectNavigation(source: BuiltInBrowserNavigationSource): void {
    this.pendingSource = source
  }

  /** Attributes the next controller-started navigation to whatever made the page ask for it, such as a popup. */
  expectPageNavigation(): void {
    this.pendingSource = this.pageSource()
  }

  /**
   * A navigation the page asks for is the agent's while its script counts as running (awaited or
   * busy) and the user has not touched the page since it started; scripted clicks send no input.
   */
  private pageSource(): BuiltInBrowserNavigationSource {
    const running = this.running
    return this.busyWith() && running && this.lastInputAt < running.startedAt ? 'agent' : 'page'
  }

  /** The unfinished run that keeps new runs off this page, if any. */
  busyWith(now = Date.now()): string | undefined {
    const running = this.running
    if (!running) return undefined
    return running.reportedAt === undefined || now - running.reportedAt < BUSY_WINDOW_MS
      ? running.operationId
      : undefined
  }

  startScript(operationId: string): RunningScript {
    this.running = { operationId, startedAt: Date.now() }
    return this.running
  }

  /** Records that the caller stopped waiting for `running`; its final outcome is reported later. */
  reportUnknown(running: RunningScript): void {
    running.reportedAt = Date.now()
  }

  finishScript(running: RunningScript, result: BuiltInBrowserRunResult): void {
    if (this.running === running) this.running = null
    if (running.reportedAt === undefined) return
    const { operationId, status, code, message, value, truncated, diagnostics } = result
    // Only runs reported as unknown land here, and the busy window spaces them out, so the list stays short.
    this.settled.push({
      operationId,
      status: status === 'not_started' ? 'unknown' : status,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(truncated ? { truncated } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    })
  }

  /** What happened on the page since the previous result; each event is handed out once. */
  takeEvents(): Pick<BuiltInBrowserPage, 'userInteracted' | 'settledOperations'> {
    const { userInteracted, settled } = this
    this.userInteracted = false
    this.settled = []
    return {
      ...(userInteracted ? { userInteracted } : {}),
      ...(settled.length ? { settledOperations: settled } : {}),
    }
  }
}
