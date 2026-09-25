/**
 * Contract between the renderer and the desktop built-in browser.
 *
 * The built-in browser is a single page view embedded in the app window's right sidebar. The
 * model reads pages through it and the user can take it over to sign in or click through a
 * page. It renders in a dedicated persistent session, so sign-ins survive restarts; sign-in
 * state lives only in that session and is never shared with the app window or sent to a model.
 */

export const BUILT_IN_BROWSER_CHANNELS = {
  readPage: 'built-in-browser:read-page',
  cancelRead: 'built-in-browser:cancel-read',
  navigate: 'built-in-browser:navigate',
  goBack: 'built-in-browser:go-back',
  goForward: 'built-in-browser:go-forward',
  reload: 'built-in-browser:reload',
  stop: 'built-in-browser:stop',
  setView: 'built-in-browser:set-view',
  getState: 'built-in-browser:get-state',
  clearData: 'built-in-browser:clear-data',
  /** Main → renderer push whenever {@link BuiltInBrowserState} changes. */
  state: 'built-in-browser:state',
} as const

export const BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS = 25_000
export const BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS = 60_000

export interface BuiltInBrowserReadRequest {
  requestId: string
  /** Page to open. Without it the page currently shown in the browser is read. */
  url?: string
  timeoutMs?: number
}

export interface BuiltInBrowserPage {
  /** Final URL after redirects. */
  url: string
  title: string
  content: string
}

export interface BuiltInBrowserState {
  /** Empty until a page has been opened. */
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Whether the model is reading the page right now. */
  reading: boolean
}

export const EMPTY_BUILT_IN_BROWSER_STATE: BuiltInBrowserState = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  reading: false,
}

/** Where the page view is drawn, in CSS pixels relative to the app window's content area. */
export interface BuiltInBrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BuiltInBrowserViewRequest = { visible: false } | { visible: true; bounds: BuiltInBrowserViewBounds }

/** Model tool that reads a page in the built-in browser. */
export const BROWSE_PAGE_TOOL_NAME = 'browse_page'
