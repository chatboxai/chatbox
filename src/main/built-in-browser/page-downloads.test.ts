import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN } from '@shared/built-in-browser'
import type { DownloadItem, Event, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOWNLOAD_START_GRACE_MS,
  downloadLocationOf,
  PageDownloads,
  removeDownloads,
  routeDownload,
  safeFileName,
} from './page-downloads'
import { PendingOutcomes } from './page-outcomes'

let outcomes = new PendingOutcomes()
beforeEach(() => {
  outcomes = new PendingOutcomes()
})

const userData = path.join(tmpdir(), 'page-downloads-user-data')
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

let nextId = 1

function fakeContents() {
  const contents = new EventEmitter() as EventEmitter & { id: number }
  contents.id = nextId++
  return contents
}

class FakeItem extends EventEmitter {
  savePath = ''
  received = 0
  cancel = vi.fn(() => this.finish('cancelled'))
  constructor(
    private readonly filename: string,
    private readonly total = 0
  ) {
    super()
  }
  getFilename = () => this.filename
  getURL = () => 'https://files.example/export/report.csv?token=secret'
  getTotalBytes = () => this.total
  getReceivedBytes = () => this.received
  setSavePath = (value: string) => {
    this.savePath = value
  }
  progress(bytes: number) {
    this.received = bytes
    this.emit('updated', {}, 'progressing')
  }
  finish(state: 'completed' | 'cancelled' | 'interrupted') {
    this.emit('done', {}, state)
  }
}

function start(contents: EventEmitter & { id: number }, item: FakeItem) {
  const event = { preventDefault: vi.fn() }
  routeDownload(event as unknown as Event, item as unknown as DownloadItem, contents as unknown as WebContents)
  return event
}

describe('page downloads', () => {
  let directory: string

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'browser-downloads-')))
  })
  afterEach(() => {
    vi.useRealTimers()
    rmSync(directory, { recursive: true, force: true })
  })

  it('blocks downloads outside a capture and reports them once without secrets', () => {
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })

    const event = start(contents, new FakeItem('report.csv'))

    expect(event.preventDefault).toHaveBeenCalled()
    expect(outcomes.take().downloads ?? []).toEqual([
      { name: 'report.csv', url: 'https://files.example/export/report.csv', status: 'blocked' },
    ])
    expect(outcomes.take().downloads ?? []).toEqual([])
  })

  it('reports blocked downloads to the shared queue with the tab they happened in', () => {
    const contents = fakeContents()
    new PageDownloads(contents as unknown as WebContents, { outcomes, tab: 't2' })
    start(contents, new FakeItem('report.csv'))
    expect(outcomes.take().downloads).toEqual([
      expect.objectContaining({ name: 'report.csv', status: 'blocked', tab: 't2' }),
    ])
  })

  it('cancels downloads of pages without a download handler', () => {
    const event = start(fakeContents(), new FakeItem('a.bin'))
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('saves captured downloads under unique names and returns them once they finish', async () => {
    vi.useFakeTimers()
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    writeFileSync(path.join(directory, 'report.csv'), 'existing')
    const capture = await downloads.start({ root: directory, directory })
    const first = new FakeItem('report.csv')
    const second = new FakeItem('report.csv')

    start(contents, first)
    start(contents, second)
    const settled = downloads.settle(capture, new AbortController().signal)
    first.progress(4)
    first.finish('completed')
    second.progress(2)
    second.finish('interrupted')
    await vi.advanceTimersByTimeAsync(DOWNLOAD_START_GRACE_MS)
    await settled

    expect(first.savePath).toBe(path.join(directory, 'report (1).csv'))
    expect(second.savePath).toBe(path.join(directory, 'report (2).csv'))
    expect(downloads.release(capture)).toEqual([
      {
        name: 'report (1).csv',
        status: 'saved',
        path: first.savePath,
        size: 4,
        url: 'https://files.example/export/report.csv',
      },
      { name: 'report (2).csv', status: 'failed', size: 2, url: 'https://files.example/export/report.csv' },
    ])
    // Released: the next download is blocked again.
    expect(start(contents, new FakeItem('late.csv')).preventDefault).toHaveBeenCalled()
  })

  it('gives downloads of two tabs saving into one folder different names', async () => {
    const firstTab = fakeContents()
    const secondTab = fakeContents()
    const firstDownloads = new PageDownloads(firstTab as unknown as WebContents, { outcomes })
    const secondDownloads = new PageDownloads(secondTab as unknown as WebContents, { outcomes })
    await firstDownloads.start({ root: directory, directory })
    await secondDownloads.start({ root: directory, directory })
    const first = new FakeItem('report.csv')
    const second = new FakeItem('report.csv')

    start(firstTab, first)
    start(secondTab, second)

    expect(first.savePath).toBe(path.join(directory, 'report.csv'))
    expect(second.savePath).toBe(path.join(directory, 'report (1).csv'))
    first.finish('completed')
    second.finish('completed')
  })

  it('creates the conversation folder, and again when it was removed during a capture', async () => {
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const target = path.join(directory, 'browser-downloads', 'conversation')
    const capture = await downloads.start({ root: directory, directory: target })
    expect(existsSync(target)).toBe(true)
    rmSync(path.join(directory, 'browser-downloads'), { recursive: true })
    const item = new FakeItem('report.csv')

    expect(start(contents, item).preventDefault).not.toHaveBeenCalled()
    expect(item.savePath).toBe(path.join(target, 'report.csv'))
    expect(existsSync(target)).toBe(true)
    downloads.release(capture)
  })

  it('refuses a folder reached through a link out of its root, at the start and when a download arrives', async () => {
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const outside = path.join(directory, 'outside')
    const root = path.join(directory, 'user-data')
    mkdirSync(outside)
    mkdirSync(path.join(root, 'browser-downloads'), { recursive: true })
    symlinkSync(outside, path.join(root, 'browser-downloads', 'linked'), 'dir')
    await expect(downloads.start({ root, directory: path.join(root, 'browser-downloads', 'linked') })).rejects.toThrow(
      'not a real directory'
    )

    const target = path.join(root, 'browser-downloads', 'conversation')
    const capture = await downloads.start({ root, directory: target })
    rmSync(target, { recursive: true })
    symlinkSync(outside, target, 'dir')
    const item = new FakeItem('report.csv')

    expect(start(contents, item).preventDefault).toHaveBeenCalled()
    expect(item.savePath).toBe('')
    expect(outcomes.take().downloads ?? []).toEqual([
      expect.objectContaining({ name: 'report.csv', status: 'blocked' }),
    ])
    downloads.release(capture)
  })

  it('creates nothing beyond a linked parent and removes nothing through one', async () => {
    const downloads = new PageDownloads(fakeContents() as unknown as WebContents, { outcomes })
    const outside = path.join(directory, 'outside')
    const root = path.join(directory, 'user-data')
    mkdirSync(path.join(outside, 'conversation'), { recursive: true })
    writeFileSync(path.join(outside, 'conversation', 'keep.txt'), 'kept')
    mkdirSync(root)
    symlinkSync(outside, path.join(root, 'browser-downloads'), 'dir')
    const location = { root, directory: path.join(root, 'browser-downloads', 'fresh') }

    await expect(downloads.start(location)).rejects.toThrow('not a real directory')
    expect(existsSync(path.join(outside, 'fresh'))).toBe(false)

    await removeDownloads({ root, directory: path.join(root, 'browser-downloads', 'conversation') })
    expect(readFileSync(path.join(outside, 'conversation', 'keep.txt'), 'utf8')).toBe('kept')
  })

  it('removes a conversation folder, or only the link standing in its place', async () => {
    const root = path.join(directory, 'user-data')
    const outside = path.join(directory, 'outside')
    mkdirSync(path.join(root, 'browser-downloads', 'own'), { recursive: true })
    writeFileSync(path.join(root, 'browser-downloads', 'own', 'report.csv'), 'data')
    mkdirSync(outside)
    writeFileSync(path.join(outside, 'keep.txt'), 'kept')
    symlinkSync(outside, path.join(root, 'browser-downloads', 'linked'), 'dir')

    await removeDownloads({ root, directory: path.join(root, 'browser-downloads', 'own') })
    await removeDownloads({ root, directory: path.join(root, 'browser-downloads', 'linked') })

    expect(existsSync(path.join(root, 'browser-downloads', 'own'))).toBe(false)
    expect(existsSync(path.join(root, 'browser-downloads', 'linked'))).toBe(false)
    expect(readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('kept')
  })

  it('gives every conversation its own folder, whatever its id', () => {
    const folders = ['a', 'a.', 'a ', '..', 'A'].map((id) => downloadLocationOf(id).directory)
    expect(new Set(folders).size).toBe(folders.length)
    for (const folder of folders) expect(path.dirname(folder)).toBe(path.join(userData, 'browser-downloads'))
  })

  it('does not use a filename occupied by a dangling symbolic link', async () => {
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    symlinkSync(path.join(directory, 'missing-file'), path.join(directory, 'report.csv'))
    const capture = await downloads.start({ root: directory, directory })
    const item = new FakeItem('report.csv')

    start(contents, item)

    expect(item.savePath).toBe(path.join(directory, 'report (1).csv'))
    downloads.release(capture)
  })

  it('captures staggered downloads throughout the bounded start grace', async () => {
    vi.useFakeTimers()
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const capture = await downloads.start({ root: directory, directory })
    const first = new FakeItem('first.csv')
    start(contents, first)
    let done = false
    const settled = downloads.settle(capture, new AbortController().signal).then(() => {
      done = true
      return downloads.release(capture)
    })
    first.finish('completed')
    await vi.advanceTimersByTimeAsync(DOWNLOAD_START_GRACE_MS - 1)
    expect(done).toBe(false)
    const second = new FakeItem('second.csv')
    expect(start(contents, second).preventDefault).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(false)
    second.finish('completed')

    expect(await settled).toEqual([
      expect.objectContaining({ name: 'first.csv', status: 'saved' }),
      expect.objectContaining({ name: 'second.csv', status: 'saved' }),
    ])
  })

  it('ends the start grace after its deadline even when a download finishes early', async () => {
    vi.useFakeTimers()
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const capture = await downloads.start({ root: directory, directory })
    const item = new FakeItem('report.csv')
    start(contents, item)
    const settled = downloads.settle(capture, new AbortController().signal)
    item.finish('completed')
    await vi.advanceTimersByTimeAsync(DOWNLOAD_START_GRACE_MS)
    await settled
    expect(downloads.release(capture)).toEqual([expect.objectContaining({ status: 'saved' })])
  })

  it('ends the grace period when its timer fires, even when the clock has not reached it yet', async () => {
    // Only timers are faked, so Date.now() stays behind the grace deadline when the timer fires.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const capture = await downloads.start({ root: directory, directory })
    let done = false
    const settled = downloads.settle(capture, new AbortController().signal).then(() => {
      done = true
    })

    await vi.advanceTimersByTimeAsync(DOWNLOAD_START_GRACE_MS)
    await settled
    expect(done).toBe(true)
  })

  it('waits a moment for a download to start, then gives up', async () => {
    vi.useFakeTimers()
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const capture = await downloads.start({ root: directory, directory })
    let done = false
    const settled = downloads.settle(capture, new AbortController().signal).then(() => {
      done = true
    })

    await vi.advanceTimersByTimeAsync(DOWNLOAD_START_GRACE_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await settled
    expect(downloads.release(capture)).toEqual([])
  })

  it('reports a download still running at release when it ends, and cancels one that is too large', async () => {
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const capture = await downloads.start({ root: directory, directory })
    const slow = new FakeItem('slow.zip')
    const huge = new FakeItem('huge.iso', 600 * 1024 * 1024)
    start(contents, slow)
    start(contents, huge)

    const abort = new AbortController()
    const settled = downloads.settle(capture, abort.signal)
    abort.abort()
    await settled
    expect(downloads.release(capture)).toEqual([
      expect.objectContaining({ name: 'slow.zip', status: 'in_progress' }),
      expect.objectContaining({ name: 'huge.iso', status: 'too_large' }),
    ])
    expect(huge.cancel).toHaveBeenCalled()

    slow.progress(10)
    slow.finish('completed')
    expect(outcomes.take().downloads ?? []).toEqual([
      expect.objectContaining({ name: 'slow.zip', status: 'saved', size: 10 }),
    ])
  })
})

describe('page download limits', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'browser-download-limits-'))
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('saves at most the per-run number of files and reports every late outcome of the ones it saved', async () => {
    const contents = fakeContents()
    const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
    const capture = await downloads.start({ root: directory, directory })
    const items = Array.from(
      { length: BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN + 3 },
      (_, index) => new FakeItem(`f${index}.bin`)
    )
    const events = items.map((item) => start(contents, item))

    expect(events.filter((event) => event.preventDefault.mock.calls.length > 0)).toHaveLength(3)
    expect(downloads.release(capture)).toHaveLength(BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN)
    for (const item of items.slice(0, BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN)) item.finish('completed')

    const reported = outcomes.take().downloads ?? []
    expect(reported.filter((download) => download.status === 'over_limit')).toHaveLength(3)
    expect(reported.filter((download) => download.status === 'saved')).toHaveLength(
      BUILT_IN_BROWSER_MAX_DOWNLOADS_PER_RUN
    )
  })
})

describe('page downloads of a run whose result is not delivered', () => {
  it('reports finished downloads with the next result and the others when they end', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'browser-download-cancelled-'))
    try {
      const contents = fakeContents()
      const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
      const capture = await downloads.start({ root: directory, directory })
      const finished = new FakeItem('done.csv')
      const running = new FakeItem('later.csv')
      start(contents, finished)
      start(contents, running)
      finished.finish('completed')

      downloads.releaseToEvents(capture)
      expect(outcomes.take().downloads ?? []).toEqual([expect.objectContaining({ name: 'done.csv', status: 'saved' })])
      running.finish('completed')
      expect(outcomes.take().downloads ?? []).toEqual([expect.objectContaining({ name: 'later.csv', status: 'saved' })])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('interrupted page downloads', () => {
  it('ends a download interrupted with a chance to resume as failed', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'browser-download-interrupted-'))
    try {
      const contents = fakeContents()
      const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
      const capture = await downloads.start({ root: directory, directory })
      const item = new FakeItem('export.csv')
      start(contents, item)
      item.received = 4
      item.emit('updated', {}, 'interrupted')

      expect(item.cancel).toHaveBeenCalled()
      await downloads.settle(capture, AbortSignal.timeout(DOWNLOAD_START_GRACE_MS + 1000))
      expect(downloads.release(capture)).toEqual([expect.objectContaining({ name: 'export.csv', status: 'failed' })])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('page downloads released twice', () => {
  it('reports a download once when the user ended the capture before the run released it', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'browser-download-once-'))
    try {
      const contents = fakeContents()
      const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
      const capture = await downloads.start({ root: directory, directory })
      const item = new FakeItem('report.csv')
      start(contents, item)
      item.finish('completed')

      // The user navigates from the sidebar while the run still waits for more downloads.
      downloads.endEarlierCapture()
      expect(downloads.release(capture)).toEqual([])
      expect(outcomes.take().downloads ?? []).toEqual([
        expect.objectContaining({ name: 'report.csv', status: 'saved' }),
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps saving for a run still going when another call ends only lingering captures', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'browser-download-running-'))
    try {
      const contents = fakeContents()
      const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
      const capture = await downloads.start({ root: directory, directory })
      downloads.endLingeringCapture()
      const item = new FakeItem('export.csv')
      start(contents, item)
      item.finish('completed')

      expect(item.cancel).not.toHaveBeenCalled()
      expect(downloads.release(capture)).toEqual([expect.objectContaining({ name: 'export.csv', status: 'saved' })])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('page download names', () => {
  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'keeps names that differ only in case apart on case-insensitive file systems',
    async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'browser-download-case-'))
      try {
        const contents = fakeContents()
        const downloads = new PageDownloads(contents as unknown as WebContents, { outcomes })
        await downloads.start({ root: directory, directory })
        const upper = new FakeItem('Report.pdf')
        const lower = new FakeItem('report.pdf')
        start(contents, upper)
        start(contents, lower)
        expect(lower.savePath.toLowerCase()).not.toBe(upper.savePath.toLowerCase())
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
})

describe('safeFileName', () => {
  it('keeps the name the site gave without paths or reserved characters', () => {
    expect(safeFileName('report.csv')).toBe('report.csv')
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\Users\\a\\b:c?.txt')).toBe('b_c_.txt')
    expect(safeFileName('...')).toBe('download')
    // Long names are cut by bytes, as file systems count them, and keep their extension.
    const long = safeFileName(`${'报告'.repeat(60)}.xlsx`)
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(200)
    expect(long.endsWith('.xlsx')).toBe(true)
    expect(long.startsWith('报告报告')).toBe(true)
  })
})
