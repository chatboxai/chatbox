/**
 * Contract between the renderer and the desktop built-in browser.
 *
 * Each conversation owns up to {@link BUILT_IN_BROWSER_MAX_TABS} pages, shown as tabs of the
 * conversation's side panel. The model reads them and the user can take any of them over to sign
 * in or click through it. Page URLs and navigation history are local to their tab. Views share a dedicated persistent
 * website profile so sign-ins survive restarts; sign-in state is never shared with the app
 * window or sent to a model.
 */

export const BUILT_IN_BROWSER_CHANNELS = {
  request: 'built-in-browser:request',
  cancel: 'built-in-browser:cancel',
  navigate: 'built-in-browser:navigate',
  goBack: 'built-in-browser:go-back',
  goForward: 'built-in-browser:go-forward',
  reload: 'built-in-browser:reload',
  stop: 'built-in-browser:stop',
  setView: 'built-in-browser:set-view',
  clearData: 'built-in-browser:clear-data',
  dispose: 'built-in-browser:dispose',
  getTabs: 'built-in-browser:get-tabs',
  openTab: 'built-in-browser:open-tab',
  closeTab: 'built-in-browser:close-tab',
  /** Main → renderer push of {@link BuiltInBrowserTabs} whenever a tab opens, closes or changes. */
  tabs: 'built-in-browser:tabs',
} as const

/** Most pages one conversation keeps open; the model reuses a tab once they are all open. */
export const BUILT_IN_BROWSER_MAX_TABS = 8

/** Initial layout for pages opened by background tools before a sidebar has placed them. */
export const BUILT_IN_BROWSER_DEFAULT_VIEWPORT = { width: 1024, height: 768 } as const

export const BUILT_IN_BROWSER_DEFAULT_READ_TIMEOUT_MS = 25_000
export const BUILT_IN_BROWSER_MAX_READ_TIMEOUT_MS = 60_000

/**
 * Which tab an observing request uses. Without `tab`, it uses the model's own tab, the latest one
 * opened for it: a url opens one when there is none, and a request without a url reads the tab the
 * user is viewing when the model has none. With `newTab`, `url` opens in a new tab.
 */
export interface BuiltInBrowserTabTarget {
  tab?: string
  newTab?: boolean
}

/**
 * One operation on a conversation's pages, selected by `kind`. `read`, `snapshot` and `screenshot`
 * observe `url`, or the page the tab shows when it is omitted; `run` and `upload` act on the page
 * `page` names, in the tab that issued it.
 */
export type BuiltInBrowserRequest =
  | ({ kind: 'read'; url?: string } & BuiltInBrowserTabTarget)
  | ({ kind: 'screenshot'; url?: string } & BuiltInBrowserTabTarget)
  | ({ kind: 'snapshot'; url?: string } & BuiltInBrowserTabTarget & BuiltInBrowserSnapshotRequest)
  /** With `download`, files the run downloads are saved to the conversation's download folder. */
  | { kind: 'run'; page: string; code: string; download?: boolean }
  | ({ kind: 'upload' } & BuiltInBrowserUploadRequest)

export type BuiltInBrowserRequestKind = BuiltInBrowserRequest['kind']

/** A request as it crosses IPC: with the id that cancels it and the longest wait for it. */
export type BuiltInBrowserCall = BuiltInBrowserRequest & { requestId: string; timeoutMs?: number }

export interface BuiltInBrowserSnapshotRequest {
  /** Reference of the element whose subtree to outline. */
  scope?: string
  /** Case-insensitive text; only matching lines and the lines containing them are kept. */
  query?: string
  /** `nextCursor` of the previous snapshot of the same page, sent with the same `scope` and `query`. */
  cursor?: string
  maxChars?: number
}

export interface BuiltInBrowserSnapshotInfo {
  /** Lines of the whole snapshot; `content` holds the part that fits. */
  totalLines: number
  nextCursor?: string
  /** `cursor` was for another page, scope or query, so the outline starts over. */
  restarted?: true
  /** Only the open native modal dialog is outlined, since the rest of the page is inert. */
  modal?: true
  /** The page has more elements than a snapshot outlines; narrow it with `scope` or `query`. */
  truncated?: true
  /** The snapshot could not be taken, such as when `scope` names an element that is gone. */
  error?: string
}

/** Most files one upload hands to a page, and the largest file it accepts. */
export const BUILT_IN_BROWSER_MAX_UPLOAD_FILES = 10
export const BUILT_IN_BROWSER_MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024
/** Largest file a run may download; a larger download is cancelled. */
export const BUILT_IN_BROWSER_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024

export interface BuiltInBrowserUploadRequest {
  page: string
  /** CSS selector of a file input, a label or container holding one, or a control that opens a file picker. */
  target: string
  /** Absolute paths, or paths relative to `baseDirectory`. */
  files: string[]
  baseDirectory?: string
  /**
   * Directories the files may come from without the user's approval; absent, any file may be
   * handed over. A file outside them refuses the upload with `approval_required` unless
   * `approvedVersion` matches the files as they are now.
   */
  allowedRoots?: string[]
  /** The `approvalVersion` of the files the user approved. */
  approvedVersion?: string
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
  /** The page's document went away before the script returned. */
  | 'page_unloaded'

export type BuiltInBrowserUploadErrorCode =
  | 'page_changed'
  | 'no_page'
  | 'busy'
  | 'timeout'
  | 'cancelled'
  | 'page_unloaded'
  /** A file is missing, not a regular file, too large, or there are too many files. */
  | 'file_unavailable'
  /** A file lies outside the directories the upload may read without the user's approval. */
  | 'approval_required'
  | 'target_not_found'
  /** The target cannot take these files: disabled, single-file, or not a file input. */
  | 'target_unsupported'
  /** Clicking the target did not open a file picker. */
  | 'no_file_chooser'
  /** The page's developer tools or another debugger holds the page. */
  | 'debugger_unavailable'

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
  /** Why the run did not complete, except for a script that threw, whose `message` says why. */
  code?: BuiltInBrowserRunErrorCode
  message?: string
  /** The script's serialized return value, when it completed. */
  value?: string
  /** Set when `value` was cut to the size limit. */
  truncated?: true
  /** The main frame started loading another document while the script ran. */
  navigated?: true
  diagnostics?: BuiltInBrowserDiagnostics
  /** Files the run downloaded, for a run that accepts downloads. */
  downloads?: BuiltInBrowserDownload[]
}

export interface BuiltInBrowserUploadFile {
  /** The name the page receives. */
  name: string
  size: number
  /** Canonical path, with symbolic links resolved. */
  path: string
}

/**
 * `completed` means the files were handed to the page's file input, which fires its input and
 * change events; whether the site accepted them shows on the page afterwards.
 */
export interface BuiltInBrowserUploadResult {
  operationId: string
  status: BuiltInBrowserRunStatus
  code?: BuiltInBrowserUploadErrorCode
  message?: string
  /** The files handed over, or the files awaiting approval. */
  files?: BuiltInBrowserUploadFile[]
  /** With `approval_required`: identifies these files as they are now, to bind the user's approval to them. */
  approvalVersion?: string
}

/** Most files one run saves; downloads it starts beyond them are cancelled. */
export const BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN = 10

/**
 * A file a page downloaded. `saved` files are complete at `path`; `blocked` ones were started outside
 * a run that accepts downloads; `too_large` ones exceeded the size limit and `over_limit` ones came
 * after the run had started {@link BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN} downloads, and both were cancelled.
 */
export interface BuiltInBrowserDownload {
  name: string
  status: 'saved' | 'in_progress' | 'failed' | 'too_large' | 'blocked' | 'over_limit'
  /** Where the file is saved, in the conversation's download folder; absent for blocked downloads. */
  path?: string
  /** Bytes received so far. */
  size?: number
  /** Origin and path of the download URL. */
  url: string
  /** The tab it happened in, for a download reported after the result of the run that started it. */
  tab?: string
}

/** Final outcome of a run that was reported as `unknown` and finished afterwards. */
export type BuiltInBrowserSettledOperation = Omit<BuiltInBrowserRunResult, 'status' | 'navigated'> & {
  status: Exclude<BuiltInBrowserRunStatus, 'not_started'>
  /** The tab it ran in. */
  tab?: string
}

/** What happened on the page since the previous result; each event is handed out once. */
export interface BuiltInBrowserPageEvents {
  /** The user clicked, typed or scrolled in the page. */
  userInteracted?: boolean
  /** Runs reported as `unknown` that finished since. */
  settledOperations?: BuiltInBrowserSettledOperation[]
  /** Downloads that were blocked, or finished after the result of the run that started them. */
  downloads?: BuiltInBrowserDownload[]
}

/** An open tab, as results list them for the model. */
export interface BuiltInBrowserTabSummary {
  tab: string
  url: string
  title: string
  /** The user is looking at this tab. */
  viewing?: true
}

/** The page a result describes, and what happened on it since the previous result. */
export interface BuiltInBrowserPageView extends BuiltInBrowserPageEvents {
  /** The tab showing the page. */
  tab?: string
  /** Every open tab, when the conversation has more than one. */
  tabs?: BuiltInBrowserTabSummary[]
  /**
   * Opaque reference to the page this result observed. It changes whenever the main frame loads
   * a document or changes its URL, including a reload of the same URL, and runs and uploads act
   * only on the page it names. Absent when the result did not observe the page, such as a refusal.
   */
  page?: string
  /** Final URL after redirects. */
  url: string
  title: string
}

export interface BuiltInBrowserReadResult extends BuiltInBrowserPageView {
  content: string
  /** How `content` was extracted: an article, or the visible text of a page without one. */
  readMode: 'article' | 'text'
}

/** Reaches the model as exactly its image, so it hands out neither a page reference nor page events. */
export interface BuiltInBrowserScreenshotResult {
  tab?: string
  url: string
  title: string
  screenshot: BuiltInBrowserScreenshot
}

export interface BuiltInBrowserSnapshotResult extends BuiltInBrowserPageView {
  /** The outline, or the part of it that fits. */
  content: string
  snapshot: BuiltInBrowserSnapshotInfo
}

export interface BuiltInBrowserRunPage extends BuiltInBrowserPageView {
  run: BuiltInBrowserRunResult
  /** Latest main-frame navigation, when the run was refused because the page changed. */
  lastNavigation?: BuiltInBrowserNavigation
}

export interface BuiltInBrowserUploadPage extends BuiltInBrowserPageView {
  upload: BuiltInBrowserUploadResult
  /** Latest main-frame navigation, when the upload was refused because the page changed. */
  lastNavigation?: BuiltInBrowserNavigation
}

/** The result of each kind of request. */
export interface BuiltInBrowserResults {
  read: BuiltInBrowserReadResult
  screenshot: BuiltInBrowserScreenshotResult
  snapshot: BuiltInBrowserSnapshotResult
  run: BuiltInBrowserRunPage
  upload: BuiltInBrowserUploadPage
}

/** State of one tab's page. */
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

export interface BuiltInBrowserTab extends BuiltInBrowserState {
  id: string
}

/** A conversation's open tabs, in the order they were opened. */
export interface BuiltInBrowserTabs {
  /** Included in main-process notifications. */
  sessionId?: string
  tabs: BuiltInBrowserTab[]
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

/**
 * `read` opens or reads a page, `snapshot` outlines its controls with element references, `run`
 * executes a script on it, `upload` hands local files to its file input, `screenshot` captures its
 * viewport.
 */
export const BUILT_IN_BROWSER_COMMANDS = ['read', 'snapshot', 'run', 'upload', 'screenshot'] as const
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
