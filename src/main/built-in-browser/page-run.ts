import type { BuiltInBrowserRunResult } from '@shared/built-in-browser'
import type { WebContents } from 'electron'
import {
  cancelRunSource,
  diagnosticsOf,
  type FailedRequest,
  MAX_DIAGNOSTIC_ENTRIES,
  parseRunOutcome,
  type RunOutcome,
  redactRequest,
  redactViolations,
  runScriptSource,
} from './script-run'

const CANCEL_RUN_TIMEOUT_MS = 500

type RequestObserver = (request: FailedRequest) => void

/**
 * Failed-request listeners of unfinished runs, by page, so a run that outlived its busy window keeps
 * collecting its own. The browser profile has one webRequest listener per event, which reports here.
 */
const requestObservers = new Map<number, Set<RequestObserver>>()

export function reportFailedRequest(webContentsId: number | undefined, request: FailedRequest): void {
  if (webContentsId === undefined) return
  for (const observe of requestObservers.get(webContentsId) ?? []) observe(request)
}

function executeWithin(contents: WebContents, source: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    contents
      .executeJavaScript(source)
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(timer))
  })
}

/**
 * One script handed to a page. `outcome` settles exactly once: with the script's own answer, or as
 * `page_unloaded` when its document is replaced or destroyed first, since such a document never
 * answers. Everything the run attached to the page is removed when it settles.
 */
export class PageRun {
  readonly outcome: Promise<BuiltInBrowserRunResult>
  private readonly operationKey: string
  private readonly failedRequests: FailedRequest[] = []
  private navigated = false
  /** The document the script runs in went away: replaced, turned into an error page, or its renderer died. */
  private lost = false

  constructor(
    private readonly contents: WebContents,
    private readonly operationId: string,
    code: string,
    expectedUrl: string
  ) {
    this.operationKey = `__chatboxRun_${operationId}`
    const contentsId = contents.id
    const onNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame && !event.isSameDocument) this.navigated = true
    }
    const observeRequest: RequestObserver = (request) => {
      if (this.failedRequests.length < MAX_DIAGNOSTIC_ENTRIES) this.failedRequests.push(redactRequest(request))
    }
    let onUnload: () => void = () => undefined
    const unloaded = new Promise<void>((resolve) => {
      onUnload = () => {
        this.lost = true
        resolve()
      }
    })
    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      _description: string,
      _url: string,
      isMainFrame: boolean
    ) => {
      // ERR_ABORTED (-3) is a navigation replaced by another one; the document stays until that commits.
      if (isMainFrame && errorCode !== -3) onUnload()
    }

    contents.on('did-start-navigation', onNavigation)
    contents.on('did-navigate', onUnload)
    contents.on('did-fail-load', onFailLoad)
    contents.on('render-process-gone', onUnload)
    contents.once('destroyed', onUnload)
    const observers = requestObservers.get(contentsId) ?? new Set<RequestObserver>()
    observers.add(observeRequest)
    requestObservers.set(contentsId, observers)

    this.outcome = Promise.race([
      contents.executeJavaScript(runScriptSource(code, expectedUrl, this.operationKey)).then(
        (value) => this.resultOf(parseRunOutcome(value)),
        (error) => this.resultOf(undefined, error)
      ),
      unloaded.then(() => this.resultOf(undefined)),
    ]).finally(() => {
      contents.off('did-start-navigation', onNavigation)
      contents.off('did-navigate', onUnload)
      contents.off('did-fail-load', onFailLoad)
      contents.off('render-process-gone', onUnload)
      contents.off('destroyed', onUnload)
      observers.delete(observeRequest)
      if (observers.size === 0 && requestObservers.get(contentsId) === observers) requestObservers.delete(contentsId)
    })
  }

  /**
   * Reports that the caller stopped waiting: the script is asked to stop at its next helper call,
   * and the result says it may still be running. Its final outcome still arrives on `outcome`.
   */
  async stopWaiting(reason: { timeoutMs: number } | 'cancelled'): Promise<BuiltInBrowserRunResult> {
    const violations = this.contents.isDestroyed()
      ? []
      : redactViolations(await executeWithin(this.contents, cancelRunSource(this.operationKey), CANCEL_RUN_TIMEOUT_MS))
    const diagnostics = diagnosticsOf(violations, this.failedRequests)
    const timedOut = reason !== 'cancelled'
    return {
      operationId: this.operationId,
      status: 'unknown',
      code: timedOut ? 'timeout' : 'cancelled',
      message: `${
        timedOut ? `The script did not finish within ${reason.timeoutMs}ms.` : 'The wait for the script was cancelled.'
      } It was asked to stop at its next browser helper call, but it may still be running or may already have had side effects. Check the page before repeating anything; its final outcome is reported with a later browser result.`,
      ...(this.navigated ? { navigated: true } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    }
  }

  private resultOf(outcome: RunOutcome | undefined, error?: unknown): BuiltInBrowserRunResult {
    const { operationId } = this
    if (outcome?.kind === 'page_changed') {
      return {
        operationId,
        status: 'not_started',
        code: 'page_changed',
        message: 'The page changed since it was read. Read it again before running a script.',
      }
    }
    const diagnostics = diagnosticsOf(redactViolations(outcome?.violations), this.failedRequests)
    const extra = { ...(this.navigated ? { navigated: true as const } : {}), ...(diagnostics ? { diagnostics } : {}) }
    if (outcome?.kind === 'value') {
      const truncated = outcome.truncated ? { truncated: true as const } : {}
      return { operationId, status: 'completed', value: outcome.value, ...truncated, ...extra }
    }
    if (outcome?.kind === 'error') {
      return { operationId, status: 'failed', message: outcome.message, ...extra }
    }
    if (this.lost || this.navigated || this.contents.isDestroyed()) {
      return {
        operationId,
        status: 'unknown',
        code: 'page_unloaded',
        message: 'The page left its document before the script returned. Read it to see what happened.',
        ...extra,
      }
    }
    const reason = error instanceof Error ? error.message : 'The page returned an unexpected script result.'
    return { operationId, status: 'unknown', message: reason.slice(0, 500), ...extra }
  }
}
