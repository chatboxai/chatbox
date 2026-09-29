import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync } from 'node:fs'
import { lstat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  BUILT_IN_BROWSER_MAX_DOWNLOAD_BYTES,
  BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN,
  type BuiltInBrowserDownload,
} from '@shared/built-in-browser'
import { app, type DownloadItem, type Event, type WebContents } from 'electron'
import type { PageOutcomeTarget } from './page-outcomes'
import { MAX_DIAGNOSTIC_ENTRIES, redactUrl } from './script-run'

/** How long a run accepts new downloads after its script returned, even if earlier downloads finish. */
export const DOWNLOAD_START_GRACE_MS = 5_000

/**
 * Paths of downloads in progress, compared as the file system compares names. Shared by every page,
 * since the tabs of a conversation save into one folder.
 */
const reservedPaths = new Set<string>()

/**
 * The default file systems of macOS and Windows ignore case, so names that differ only in case are
 * one file there; two downloads in progress must not share it.
 */
function reservationKey(filePath: string): string {
  return process.platform === 'darwin' || process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

/** A folder for downloads and the trusted directory it must lie in, with no link between them. */
export interface DownloadLocation {
  root: string
  directory: string
}

/**
 * Where the runs of a conversation save downloads: a folder of Chatbox's own data, named by a hash
 * of the conversation id so every conversation has its own. Where the sandbox runtime confines
 * agent commands they cannot write there; elsewhere the folder is checked for links before use.
 */
export function downloadLocationOf(sessionId: string): DownloadLocation {
  const root = app.getPath('userData')
  const key = createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  return { root, directory: path.join(root, 'browser-downloads', key) }
}

/**
 * The paths from just below `location.root` down to `location.directory`, outermost first; none
 * when the folder is the root itself, which is trusted.
 */
function levelsOf(location: DownloadLocation): string[] {
  const relative = path.relative(location.root, location.directory)
  if (!relative) return []
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The download folder must lie inside Chatbox data.')
  }
  const parts = relative.split(path.sep)
  return parts.map((_, index) => path.join(location.root, ...parts.slice(0, index + 1)))
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Whether every level from the root down to `location.directory` is a directory and none is a link,
 * creating missing levels one at a time when `create` is set. Nothing is created beyond a link.
 */
export async function isOwnDirectory(location: DownloadLocation, create = false): Promise<boolean> {
  try {
    for (const level of levelsOf(location)) {
      const entry = await lstat(level).catch((error: unknown) => {
        if (!create || !isMissing(error)) throw error
        return null
      })
      if (!entry) {
        await mkdir(level).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        })
        if (!(await lstat(level)).isDirectory()) return false
      } else if (!entry.isDirectory()) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function isOwnDirectorySync(location: DownloadLocation): boolean {
  try {
    for (const level of levelsOf(location)) {
      let entry: ReturnType<typeof lstatSync> | null = null
      try {
        entry = lstatSync(level)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      if (!entry) {
        try {
          mkdirSync(level)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        }
        entry = lstatSync(level)
      }
      if (!entry.isDirectory()) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Removes a conversation's download folder when every level above it is a real directory in
 * Chatbox data at the start. A link in the folder's place is removed, not followed. Retries
 * outlast a download that still holds a file open on Windows.
 */
export async function removeDownloads(location: DownloadLocation): Promise<void> {
  const parent = { root: location.root, directory: path.dirname(location.directory) }
  if (!(await isOwnDirectory(parent))) return
  await rm(location.directory, { recursive: true, force: true, maxRetries: 5 })
}

/** Download handlers by page; the browser profile has one will-download listener, which routes here. */
const routes = new Map<number, PageDownloads>()

/** Saves a download started by a page that accepts it now; every other download is cancelled. */
export function routeDownload(event: Event, item: DownloadItem, contents: WebContents | undefined): void {
  const route = contents ? routes.get(contents.id) : undefined
  if (route) route.handle(event, item)
  else event.preventDefault()
}

/**
 * Longest filename, in UTF-8 bytes, a download is saved under. File systems allow 255 bytes; the rest
 * leaves room for the " (n)" that keeps names apart.
 */
const MAX_FILE_NAME_BYTES = 200

/** Cuts `text` to at most `maxBytes` of UTF-8 without splitting a character. */
function clipBytes(text: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const character of text) {
    bytes += Buffer.byteLength(character)
    if (bytes > maxBytes) break
    end += character.length
  }
  return text.slice(0, end)
}

/** A filename safe to create in a directory, keeping the name the site gave where possible. */
export function safeFileName(name: string): string {
  const cleaned = path
    .basename(name.replace(/\\/g, '/'))
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not valid in filenames
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  if (Buffer.byteLength(cleaned) <= MAX_FILE_NAME_BYTES) return cleaned || 'download'
  // Long names keep their extension, so the saved file still opens as its type.
  const extension = clipBytes(path.extname(cleaned), 20)
  return (
    clipBytes(
      cleaned.slice(0, cleaned.length - path.extname(cleaned).length),
      MAX_FILE_NAME_BYTES - Buffer.byteLength(extension)
    ) + extension
  )
}

interface Tracked {
  download: BuiltInBrowserDownload
  done: boolean
  /** Set once a run result reported it; a later end is then reported as a page event. */
  reported: boolean
}

export interface DownloadCapture {
  readonly location: DownloadLocation
  readonly tracked: Tracked[]
  /** The run already returned its result; the capture waits only for its script's late downloads. */
  lingering?: boolean
}

/**
 * Downloads of one page. They are saved only while a run that accepts downloads is capturing them;
 * the others are cancelled and reported, so the agent learns a click tried to download a file.
 */
export class PageDownloads {
  private capture: DownloadCapture | null = null
  private readonly waiters = new Set<() => void>()

  /**
   * Blocked downloads, and captured ones that end after the run result that reported them, go to
   * `target`'s queue for the model's next result.
   */
  constructor(
    contents: WebContents,
    private readonly target: PageOutcomeTarget
  ) {
    const id = contents.id
    routes.set(id, this)
    contents.once('destroyed', () => {
      if (routes.get(id) === this) routes.delete(id)
    })
  }

  /**
   * Ends the capture an earlier run left saving after its result, such as a timed out run whose
   * script went on. Downloads are saved only for the run that asked for them, so every later
   * operation and every navigation from the sidebar ends it first.
   */
  endEarlierCapture(): void {
    if (this.capture) this.releaseToEvents(this.capture)
  }

  /**
   * Ends a capture that only waits for a returned run's late downloads, once the user acts on the
   * page: what they download is theirs, not the run's.
   */
  endLingeringCapture(): void {
    if (this.capture?.lingering) this.releaseToEvents(this.capture)
  }

  /** Starts saving downloads into `location.directory`, until {@link release}. */
  async start(location: DownloadLocation): Promise<DownloadCapture> {
    if (!(await isOwnDirectory(location, true))) {
      throw new Error('The download folder is not a real directory in Chatbox data.')
    }
    const capture = { location, tracked: [] }
    this.capture = capture
    return capture
  }

  /**
   * Waits for the captured downloads to end, first giving a download started by the script's last
   * action a moment to begin. Resolves early with what is known when `signal` aborts.
   */
  async settle(capture: DownloadCapture, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      // The timer, not the wall clock, ends the grace period: a timer may fire just before
      // Date.now() reaches its deadline, and nothing would check again after it.
      let graceOver = false
      const check = () => {
        const waiting = !graceOver || capture.tracked.some((t) => !t.done)
        if (waiting && !signal.aborted) return
        clearTimeout(timer)
        this.waiters.delete(check)
        signal.removeEventListener('abort', check)
        resolve()
      }
      const timer = setTimeout(() => {
        graceOver = true
        check()
      }, DOWNLOAD_START_GRACE_MS)
      this.waiters.add(check)
      signal.addEventListener('abort', check, { once: true })
      check()
    })
  }

  /**
   * Returns what the capture holds so far and goes on saving: unfinished downloads are reported
   * when they end, and later ones with {@link releaseToEvents}.
   */
  report(capture: DownloadCapture): BuiltInBrowserDownload[] {
    capture.lingering = true
    return capture.tracked.map((tracked) => {
      tracked.reported = true
      return { ...tracked.download }
    })
  }

  /**
   * Stops saving downloads and returns what the capture holds that no result reported yet, such as
   * when the user navigated during the run; unfinished ones are reported when they end.
   */
  release(capture: DownloadCapture): BuiltInBrowserDownload[] {
    if (this.capture === capture) this.capture = null
    return capture.tracked.flatMap((tracked) => {
      if (tracked.reported) return []
      tracked.reported = true
      return [{ ...tracked.download }]
    })
  }

  /**
   * Stops saving downloads whose outcome no run result reported, such as those of a cancelled run or
   * a run that went on after its result: ended ones go out with the next result, the others when
   * they end.
   */
  releaseToEvents(capture: DownloadCapture): void {
    if (this.capture === capture) this.capture = null
    for (const tracked of capture.tracked) {
      if (tracked.done && !tracked.reported) this.enqueue(tracked.download)
      tracked.reported = true
    }
  }

  handle(event: Event, item: DownloadItem): void {
    const name = safeFileName(item.getFilename())
    const url = redactUrl(item.getURL())
    const capture = this.capture
    if (!capture) {
      event.preventDefault()
      this.pushEvent({ name, url, status: 'blocked' })
      return
    }
    if (capture.tracked.length >= BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN) {
      event.preventDefault()
      this.pushEvent({ name, url, status: 'over_limit' })
      return
    }
    let filePath: string
    try {
      // The folder may have been removed or replaced since the capture began.
      if (!isOwnDirectorySync(capture.location)) throw new Error('The download folder changed.')
      filePath = this.uniquePath(capture.location.directory, name)
    } catch {
      event.preventDefault()
      this.pushEvent({ name, url, status: 'blocked' })
      return
    }
    item.setSavePath(filePath)
    const tracked: Tracked = {
      download: { name: path.basename(filePath), url, status: 'in_progress', path: filePath, size: 0 },
      done: false,
      reported: false,
    }
    capture.tracked.push(tracked)
    let cancelledForSize = false
    const limitSize = () => {
      const size = Math.max(item.getTotalBytes(), item.getReceivedBytes())
      if (cancelledForSize || size <= BUILT_IN_BROWSER_MAX_DOWNLOAD_BYTES) return
      cancelledForSize = true
      item.cancel()
    }
    item.on('updated', (_event, state) => {
      tracked.download.size = item.getReceivedBytes()
      // An interruption Chromium could resume never ends on its own; nothing resumes it here, so it
      // is cancelled, which removes the partial file and ends the download as failed.
      if (state === 'interrupted') {
        item.cancel()
        return
      }
      limitSize()
    })
    item.once('done', (_event, state) => {
      reservedPaths.delete(reservationKey(filePath))
      tracked.done = true
      tracked.download.size = item.getReceivedBytes()
      tracked.download.status = cancelledForSize ? 'too_large' : state === 'completed' ? 'saved' : 'failed'
      if (tracked.download.status !== 'saved') delete tracked.download.path
      // Every run reports at most its own capped downloads, so their final outcomes are never dropped.
      if (tracked.reported) this.enqueue(tracked.download)
      this.notify()
    })
    limitSize()
    this.notify()
  }

  private enqueue(download: BuiltInBrowserDownload, limit?: number): void {
    const { outcomes, tab } = this.target
    outcomes.addDownload({ ...download, ...(tab ? { tab } : {}) }, limit)
  }

  /** Downloads the page started without being allowed to save them; only the first few are reported. */
  private pushEvent(download: BuiltInBrowserDownload): void {
    this.enqueue(download, MAX_DIAGNOSTIC_ENTRIES)
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter()
  }

  private uniquePath(directory: string, name: string): string {
    const extension = path.extname(name)
    const stem = name.slice(0, name.length - extension.length)
    for (let index = 0; ; index += 1) {
      const candidate = path.join(directory, index === 0 ? name : `${stem} (${index})${extension}`)
      let exists = true
      try {
        lstatSync(candidate)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        exists = false
      }
      if (!reservedPaths.has(reservationKey(candidate)) && !exists) {
        reservedPaths.add(reservationKey(candidate))
        return candidate
      }
    }
  }
}
