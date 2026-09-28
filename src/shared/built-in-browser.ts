/**
 * Contract between the renderer and the desktop built-in browser.
 *
 * Each conversation owns a page view embedded in the app window's right sidebar. The model
 * reads its conversation's page and the user can take it over to sign in or click through it.
 * Page URLs and navigation history are conversation-local. Views share a dedicated persistent
 * website profile so sign-ins survive restarts; sign-in state is never shared with the app
 * window or sent to a model.
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
  dispose: 'built-in-browser:dispose',
  /** Main → renderer push whenever {@link BuiltInBrowserState} changes. */
  state: 'built-in-browser:state',
} as const

/** Page clears this conversation's view/history; all also clears the shared website profile. */
export type BuiltInBrowserClearScope = 'page' | 'all'

/** Initial layout for pages opened by background tools before a sidebar has placed them. */
export const BUILT_IN_BROWSER_DEFAULT_VIEWPORT = { width: 1024, height: 768 } as const

export const BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS = 25_000
export const BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS = 60_000

export interface BuiltInBrowserReadRequest {
  requestId: string
  /** Page to open. Without it the page currently shown in the browser is read. */
  url?: string
  timeoutMs?: number
  /** Also capture the visible viewport once the page has settled. */
  screenshot?: boolean
  /** Execute a script on the page `page` refers to instead of extracting page text. */
  script?: { code: string; page: string }
}

/** Longest side, in pixels, of a viewport screenshot sent to a model. */
export const BUILT_IN_BROWSER_SCREENSHOT_MAX_DIMENSION = 1568

export interface BuiltInBrowserScreenshot {
  /** Base64 image data without a data URL prefix. */
  base64Data: string
  mediaType: 'image/jpeg'
  width: number
  height: number
}

/**
 * Who started a main-frame navigation. `agent` is a read that opened a url or a script run by the
 * model, `user` is the sidebar's address bar and buttons, `page` is the page itself (a link the
 * user clicked, a form or the site's own script), and `unknown` is anything else.
 */
export type BuiltInBrowserNavigationSource = 'agent' | 'user' | 'page' | 'unknown'

export interface BuiltInBrowserNavigation {
  source: BuiltInBrowserNavigationSource
  url: string
}

/**
 * `not_started`: the script did not run, so it is safe to retry after reading the page again.
 * `completed` / `failed`: it ran and returned or threw. `unknown`: it started, but the wait ended
 * before it finished, so its effects must be checked on the page before anything is repeated.
 */
export type BuiltInBrowserRunStatus = 'not_started' | 'completed' | 'failed' | 'unknown'

export type BuiltInBrowserRunErrorCode =
  /** The page reference no longer names the page shown: it navigated, reloaded or is loading. */
  | 'page_changed'
  | 'no_page'
  | 'syntax_error'
  /** An earlier script on this page has not finished yet. */
  | 'busy'
  | 'timeout'
  | 'cancelled'
  | 'script_error'
  /** The page's document went away before the script returned. */
  | 'page_unloaded'

/** Bounded, redacted evidence about one script run; URLs keep only their origin and path. */
export interface BuiltInBrowserDiagnostics {
  /** Content Security Policy violations the page reported while the script ran. */
  cspViolations?: Array<{ directive: string; blocked: string }>
  /** Requests of the page that failed or returned an HTTP error status while the script ran. */
  failedRequests?: Array<{ method: string; url: string; status?: number; error?: string }>
}

export interface BuiltInBrowserRunResult {
  operationId: string
  status: BuiltInBrowserRunStatus
  code?: BuiltInBrowserRunErrorCode
  message?: string
  /** The script's serialized return value, when it completed. */
  value?: string
  truncated?: boolean
  /** The main frame started loading another document while the script ran. */
  navigated?: boolean
  diagnostics?: BuiltInBrowserDiagnostics
}

/** Final outcome of a run that was reported as `unknown` and finished afterwards. */
export interface BuiltInBrowserSettledOperation {
  operationId: string
  status: Exclude<BuiltInBrowserRunStatus, 'not_started'>
  code?: BuiltInBrowserRunErrorCode
  message?: string
  value?: string
  truncated?: boolean
  diagnostics?: BuiltInBrowserDiagnostics
}

export interface BuiltInBrowserPage {
  /**
   * Opaque reference to the page this result describes. It changes whenever the main frame loads
   * a document or changes its URL, including a reload of the same URL, and scripts only run on
   * the page it names. Empty when the result did not observe the page, such as a refused run.
   */
  page: string
  /** Final URL after redirects. */
  url: string
  title: string
  content: string
  /** Present when the read requested a screenshot. */
  screenshot?: BuiltInBrowserScreenshot
  scriptResult?: BuiltInBrowserRunResult
  /** Latest main-frame navigation, when a script was refused because the page changed. */
  lastNavigation?: BuiltInBrowserNavigation
  /** The user clicked, typed or scrolled in the page since the previous result. */
  userInteracted?: boolean
  /** Runs reported as `unknown` that finished since the previous result. */
  settledOperations?: BuiltInBrowserSettledOperation[]
}

export interface BuiltInBrowserState {
  /** Conversation owning this page; included in main-process state notifications. */
  sessionId?: string
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

export type BuiltInBrowserViewRequest =
  /** With `snapshot`, a still of the page is taken before it is hidden and returned as a data URL. */
  { visible: false; snapshot?: boolean } | { visible: true; bounds: BuiltInBrowserViewBounds }

/** The one model tool of the built-in browser; `command` selects what it does. */
export const BUILT_IN_BROWSER_TOOL_NAME = 'browser'

/** `read` opens or reads a page, `run` executes a script on it, `screenshot` captures its viewport. */
export const BUILT_IN_BROWSER_COMMANDS = ['read', 'run', 'screenshot'] as const
export type BuiltInBrowserCommand = (typeof BUILT_IN_BROWSER_COMMANDS)[number]

/** The command of a `browser` tool call, when its input names a known one. */
export function builtInBrowserCommandOf(input: unknown): BuiltInBrowserCommand | undefined {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return BUILT_IN_BROWSER_COMMANDS.find((known) => known === command)
}

export const BUILT_IN_BROWSER_SCRIPT_MAX_CHARS = 12_000

/**
 * Methods of the `browser` object predefined in run scripts. The desktop controller implements them
 * and the built-in-browser skill documents them; tests on both sides check against this list.
 */
export const BUILT_IN_BROWSER_SCRIPT_HELPERS = [
  'elements',
  'click',
  'fill',
  'press',
  'scroll',
  'waitFor',
  'selector',
  'sleep',
  'cancelled',
] as const
