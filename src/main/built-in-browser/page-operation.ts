import { randomBytes } from 'node:crypto'
import type { BuiltInBrowserNavigation } from '@shared/built-in-browser'
import { BUSY_WINDOW_MS, type PageRef, type PageTracker } from './page-tracker'

/** The reason a request is aborted when it runs out of time, as opposed to a cancellation. */
export class ReadTimeoutError extends Error {}

/**
 * One run or upload on a page, from the request to the result its caller receives. Every result of
 * the operation carries its id and depends on two facts it records: whether the page was touched,
 * and how its wait ended. Before the page is touched nothing happened, so an operation that stops
 * then reports `not_started`; once it is touched, an interrupted operation reports `unknown`. A
 * result that never reaches the model, of a cancelled call or of an operation whose caller was
 * already answered, leaves the page's events for a later one.
 */
export class PageOperation {
  readonly id = `op_${randomBytes(4).toString('hex')}`
  private touchedPage = false
  private answered = false

  constructor(
    readonly signal: AbortSignal,
    readonly action: 'run' | 'upload'
  ) {}

  /** Records that the page is about to receive something from this operation. */
  touch(): void {
    this.touchedPage = true
  }

  get touched(): boolean {
    return this.touchedPage
  }

  /** The wait ran out of time; the result still reaches the model. */
  get timedOut(): boolean {
    return this.signal.aborted && this.signal.reason instanceof ReadTimeoutError
  }

  /** The caller cancelled, so the result never reaches the model. */
  get cancelled(): boolean {
    return this.signal.aborted && !this.timedOut
  }

  /** Records that the caller already received this operation's result, so later ones reach no one. */
  answer(): void {
    this.answered = true
  }

  /** Whether a result with `code` hands out the page's events. */
  deliversEvents(code: string | undefined): boolean {
    return !this.answered && !this.cancelled && code !== 'cancelled' && code !== 'approval_required'
  }

  /** The result of an operation whose wait ended before it touched the page. */
  stoppedBeforeTouch(): { operationId: string; status: 'not_started'; code: 'timeout' | 'cancelled'; message: string } {
    const why = this.timedOut ? 'timed out' : 'was cancelled'
    return {
      operationId: this.id,
      status: 'not_started',
      code: this.timedOut ? 'timeout' : 'cancelled',
      message:
        this.action === 'run'
          ? `The run ${why} before the page received it.`
          : `The upload ${why} before the page was touched.`,
    }
  }
}

export interface PageRefusal {
  code: 'no_page' | 'page_changed' | 'busy'
  message: string
  lastNavigation?: BuiltInBrowserNavigation
}

/**
 * The page `requested` names, when an operation may act on it now; otherwise why not: the page
 * failed, changed since it was read, is loading, or is still busy with an earlier run.
 */
export function pageToActOn(page: PageTracker, requested: string, action: string): PageRef | PageRefusal {
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
