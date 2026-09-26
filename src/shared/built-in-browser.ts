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
  /** Also capture the visible viewport once the page has settled. */
  screenshot?: boolean
  /** Execute a script on this exact URL instead of extracting page text. */
  script?: { code: string; expectedUrl: string }
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

export interface BuiltInBrowserPage {
  /** Final URL after redirects. */
  url: string
  title: string
  content: string
  /** Present when the read requested a screenshot. */
  screenshot?: BuiltInBrowserScreenshot
  /** `navigated` is set when the main frame started loading another document while the script ran. */
  scriptResult?: { value: string; truncated: boolean; navigated?: boolean }
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
] as const
