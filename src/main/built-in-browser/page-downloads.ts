import { lstatSync, realpathSync } from 'node:fs'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  BUILT_IN_BROWSER_MAX_DOWNLOAD_BYTES,
  BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN,
  type BuiltInBrowserDownload,
} from '@shared/built-in-browser'
import type { DownloadItem, Event, WebContents } from 'electron'
import { MAX_DIAGNOSTIC_ENTRIES, redactUrl } from './script-run'

/** How long a run accepts new downloads after its script returned, even if earlier downloads finish. */
export const DOWNLOAD_START_GRACE_MS = 5_000

/**
 * The default file systems of macOS and Windows ignore case, so names that differ only in case are
 * one file there; two downloads in progress must not share it.
 */
function reservationKey(filePath: string): string {
  return process.platform === 'darwin' || process.platform === 'win32' ? filePath.toLowerCase() : filePath
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
  readonly directory: string
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
  /** Blocked downloads, and captured ones that ended after the run result reported them. */
  private events: BuiltInBrowserDownload[] = []
  /** Paths of downloads in progress, compared as the file system compares names. */
  private readonly reserved = new Set<string>()
  private readonly waiters = new Set<() => void>()

  constructor(contents: WebContents) {
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

  /** Starts saving downloads into `directory`, until {@link release}. */
  async start(directory: string): Promise<DownloadCapture> {
    // The existing session working directory is the trusted root. Resolve its aliases before
    // creating the download folder, and never recursively create through unverified ancestors.
    const parent = await realpath(path.dirname(directory))
    const destination = path.join(parent, path.basename(directory))
    await mkdir(destination).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    })
    const entry = await lstat(destination)
    const canonical = await realpath(destination)
    if (!entry.isDirectory() || entry.isSymbolicLink() || path.dirname(canonical) !== parent) {
      throw new Error('The download directory must be a real directory inside the session working directory.')
    }
    const capture = { directory: canonical, tracked: [] }
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
      if (tracked.done && !tracked.reported) this.events.push({ ...tracked.download })
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
    // Recheck when the response arrives: the folder may have changed since capture began.
    let filePath: string
    try {
      if (!lstatSync(capture.directory).isDirectory() || realpathSync.native(capture.directory) !== capture.directory) {
        throw new Error('The download directory changed.')
      }
      filePath = this.uniquePath(capture.directory, name)
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
      this.reserved.delete(reservationKey(filePath))
      tracked.done = true
      tracked.download.size = item.getReceivedBytes()
      tracked.download.status = cancelledForSize ? 'too_large' : state === 'completed' ? 'saved' : 'failed'
      if (tracked.download.status !== 'saved') delete tracked.download.path
      // Every run reports at most its own capped downloads, so their final outcomes are never dropped.
      if (tracked.reported) this.events.push({ ...tracked.download })
      this.notify()
    })
    limitSize()
    this.notify()
  }

  /** Downloads to report with the next result; each is handed out once. */
  takeEvents(): BuiltInBrowserDownload[] {
    const { events } = this
    this.events = []
    return events
  }

  /** Downloads the page started without being allowed to save them; only the first few are reported. */
  private pushEvent(download: BuiltInBrowserDownload): void {
    if (this.events.length < MAX_DIAGNOSTIC_ENTRIES) this.events.push(download)
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
      if (!this.reserved.has(reservationKey(candidate)) && !exists) {
        this.reserved.add(reservationKey(candidate))
        return candidate
      }
    }
  }
}
