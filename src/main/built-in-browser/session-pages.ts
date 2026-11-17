import {
  BUILT_IN_BROWSER_CHANNELS,
  BUILT_IN_BROWSER_MAX_TABS,
  type BuiltInBrowserCall,
  type BuiltInBrowserRequestKind,
  type BuiltInBrowserResults,
  type BuiltInBrowserRunErrorCode,
  type BuiltInBrowserTabSummary,
  type BuiltInBrowserTabs,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import type { BrowserWindow, WebContents } from 'electron'
import { BuiltInBrowserController } from './controller'
import { PendingOutcomes } from './page-outcomes'

/** Separates the tab from the rest of a page reference or snapshot cursor, which its page issued. */
const TAB_SEPARATOR = '.'
const TAB_ID = /^t\d+$/
/** Refusals that a fresh read of the page resolves. */
const STALE_PAGE_CODES: ReadonlySet<string> = new Set(['page_changed', 'no_page', 'page_unloaded'])

type RefusableOutcome = { status?: string; code?: string; message?: string }

/**
 * The tabs of one conversation in one app window, each a page of its own.
 *
 * Which tab a request acts on is decided in {@link tabOf}: a page reference or snapshot cursor acts
 * on the tab that issued it, and `tab` or `newTab` on the tab they name. Otherwise the request works
 * in the model's own tab, the latest one opened for it; a url opens a new one when there is none,
 * so a page the user opened is navigated only when the model names its tab. Without a url and
 * without a tab of its own, the model reads the tab the user is looking at.
 *
 * The pages share one queue of runs and downloads that end after their results, so each is
 * reported with the model's next result whichever tab that comes from.
 */
export class SessionPages {
  private readonly tabs = new Map<string, BuiltInBrowserController>()
  private readonly outcomes = new PendingOutcomes()
  private nextTab = 1
  /** Latest tab opened for the model. */
  private ownTab: string | undefined
  /** Tab the panel shows, if the user is looking at one. */
  private shownTab: string | undefined

  constructor(
    private readonly sessionId: string,
    private readonly owner: WebContents
  ) {}

  list(): BuiltInBrowserTabs {
    return {
      sessionId: this.sessionId,
      tabs: [...this.tabs].map(([id, controller]) => ({ ...controller.getState(), id })),
    }
  }

  /** Opens an empty tab and returns its id. */
  openTab(): string {
    if (this.tabs.size >= BUILT_IN_BROWSER_MAX_TABS) {
      throw new Error(
        `This conversation already has ${BUILT_IN_BROWSER_MAX_TABS} tabs open. Pass tab to reuse one; the user can close tabs in the panel. ${this.openTabsText()}`
      )
    }
    const id = `t${this.nextTab++}`
    const controller = new BuiltInBrowserController(this.sessionId, false, () => this.push(), {
      outcomes: this.outcomes,
      tab: id,
    })
    this.tabs.set(id, controller)
    this.push()
    return id
  }

  closeTab(id: string): void {
    const controller = this.tabs.get(id)
    if (!controller) return
    controller.dispose()
    this.tabs.delete(id)
    if (this.ownTab === id) this.ownTab = undefined
    if (this.shownTab === id) this.shownTab = undefined
    this.push()
  }

  /** Closes every tab, such as when the conversation's browser data is cleared. */
  closeAll(): void {
    this.dispose()
    this.push()
  }

  dispose(): void {
    for (const controller of this.tabs.values()) controller.dispose()
    this.tabs.clear()
    this.ownTab = undefined
    this.shownTab = undefined
  }

  tab(id: string): BuiltInBrowserController {
    const controller = this.tabs.get(id)
    if (!controller) throw new Error(`No tab ${id} is open in this conversation. ${this.openTabsText()}`)
    return controller
  }

  private openTabsText(): string {
    if (!this.tabs.size) return 'No tab is open.'
    return `Open tabs: ${this.summaries()
      .map(({ tab, url }) => `${tab} ${url || '(empty)'}`)
      .join(', ')}.`
  }

  /** Shows `id` where the panel places it and hides the conversation's other tabs, or hides `id`. */
  setView(host: BrowserWindow, id: string, request: BuiltInBrowserViewRequest): Promise<string | null> {
    if (!request.visible) {
      // A page stepping aside for a menu or dialog, with a still in its place, is still in view.
      if (this.shownTab === id && !request.snapshot && !request.keepViewing) this.shownTab = undefined
      return this.tabs.get(id)?.setView(host, request) ?? Promise.resolve(null)
    }
    // A placement can arrive just after the tab closed, such as when browser data is cleared.
    const controller = this.tabs.get(id)
    if (!controller) return Promise.resolve(null)
    this.hideAll(host, id)
    const shown = controller.setView(host, request)
    this.shownTab = id
    return shown
  }

  hideAll(host: BrowserWindow, except?: string): void {
    if (this.shownTab !== except) this.shownTab = undefined
    for (const [id, controller] of this.tabs) {
      if (id !== except) void controller.setView(host, { visible: false })
    }
  }

  cancel(ownerId: number, requestId: string): void {
    for (const controller of this.tabs.values()) controller.cancel(ownerId, requestId)
  }

  async request<Call extends BuiltInBrowserCall>(
    host: BrowserWindow,
    ownerId: number,
    call: Call
  ): Promise<BuiltInBrowserResults[Call['kind']]> {
    // Each kind resolves to its own result, which the routing cannot relate to `Call`.
    return (await this.perform(host, ownerId, call)) as BuiltInBrowserResults[Call['kind']]
  }

  private async perform(
    host: BrowserWindow,
    ownerId: number,
    call: BuiltInBrowserCall
  ): Promise<BuiltInBrowserResults[BuiltInBrowserRequestKind]> {
    // A returned run's downloads are saved only until the model's next browser call, whichever tab it goes to.
    for (const controller of this.tabs.values()) controller.endLingeringCapture()
    const reference =
      call.kind === 'run' || call.kind === 'upload' ? call.page : 'cursor' in call ? call.cursor : undefined
    const refusal = reference === undefined ? undefined : this.refusal(reference)
    if (refusal) {
      // A refusal reaches the model, so it carries what waits in the queue too.
      const view = {
        url: '',
        title: '',
        ...(this.tabs.size ? { tabs: this.summaries() } : {}),
        ...this.outcomes.take(),
      }
      const outcome = { operationId: '', status: 'not_started' as const, ...refusal }
      if (call.kind === 'run') return { ...view, run: outcome }
      if (call.kind === 'upload') return { ...view, upload: outcome }
      return { ...view, content: '', snapshot: { totalLines: 0, error: refusal.message } }
    }
    const tab = this.tabOf(call)
    const result = await this.tab(tab).request(host, ownerId, this.forPage(call))
    return this.describe(tab, result)
  }

  private tabOf(call: BuiltInBrowserCall): string {
    if (call.kind === 'run' || call.kind === 'upload') return this.issuer(call.page)
    if (call.kind === 'snapshot' && call.cursor) return this.issuer(call.cursor)
    if (call.newTab) {
      if (!call.url) throw new Error('Pass the url to open in a new tab.')
      return this.openOwnTab()
    }
    if (call.tab) {
      this.tab(call.tab)
      return call.tab
    }
    if (this.ownTab && this.tabs.has(this.ownTab)) return this.ownTab
    if (call.url) return this.openOwnTab()
    const current = this.shownTab && this.tabs.has(this.shownTab) ? this.shownTab : this.tabs.keys().next().value
    if (!current) throw new Error('The built-in browser has no page open; pass a url.')
    return current
  }

  /** The request as the tab's page receives it; a cursor continues its own page, whatever url came with it. */
  private forPage(call: BuiltInBrowserCall): BuiltInBrowserCall {
    if (call.kind === 'run' || call.kind === 'upload') return call
    const { tab: _tab, newTab: _newTab, ...request } = call
    if (request.kind !== 'snapshot' || !request.cursor) return request
    const { url: _url, ...continuation } = request
    return continuation
  }

  /** Opens a tab for the model. It stays the model's own even when its first page fails to load. */
  private openOwnTab(): string {
    const tab = this.openTab()
    this.ownTab = tab
    return tab
  }

  private issuer(reference: string): string {
    const at = reference.indexOf(TAB_SEPARATOR)
    return at > 0 ? reference.slice(0, at) : ''
  }

  /**
   * Why a page reference or cursor names no open tab, or nothing when it does. The refusal leaves
   * every tab as it is.
   */
  private refusal(
    reference: string
  ): { code: Extract<BuiltInBrowserRunErrorCode, 'page_changed' | 'no_page'>; message: string } | undefined {
    if (!TAB_ID.test(this.issuer(reference))) {
      return { code: 'page_changed', message: 'This reference is not from a browser result. Read the page again.' }
    }
    const tab = this.issuer(reference)
    if (!this.tabs.has(tab)) return { code: 'no_page', message: `Tab ${tab} was closed. Read a page again first.` }
    return undefined
  }

  private summaries(): BuiltInBrowserTabSummary[] {
    return [...this.tabs].map(([id, controller]) => {
      const { url, title } = controller.getState()
      return { tab: id, url, title, ...(id === this.shownTab ? { viewing: true as const } : {}) }
    })
  }

  private describe<Result extends object>(tab: string, result: Result): Result {
    // A screenshot reaches the model as exactly its image, so it lists nothing else.
    if ('screenshot' in result) return { ...result, tab }
    return {
      ...result,
      ...this.refusalHints(tab, result),
      tab,
      ...(this.tabs.size > 1 ? { tabs: this.summaries() } : {}),
    }
  }

  /**
   * With several tabs open, a script or upload refused because its page is gone names the tab to
   * read the page from again.
   */
  private refusalHints(tab: string, result: object) {
    if (this.tabs.size < 2) return {}
    const hint = `Pass tab ${tab} to read this page again.`
    const refused = (outcome: RefusableOutcome | undefined) =>
      outcome?.status === 'not_started' && outcome.code && STALE_PAGE_CODES.has(outcome.code)
        ? { ...outcome, message: `${outcome.message ?? ''} ${hint}`.trim() }
        : undefined
    const run = refused((result as { run?: RefusableOutcome }).run)
    const upload = refused((result as { upload?: RefusableOutcome }).upload)
    return { ...(run ? { run } : {}), ...(upload ? { upload } : {}) }
  }

  private push(): void {
    if (this.owner.isDestroyed()) return
    this.owner.send(BUILT_IN_BROWSER_CHANNELS.tabs, this.list())
  }
}
