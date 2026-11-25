import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppUpdater } from './app-updater'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
  }),
}))

vi.mock('./store-node', () => ({
  getSettings: () => ({ autoUpdate: false, betaUpdate: false }),
}))

vi.mock('./util', () => ({
  getLogger: () => ({ transports: { file: {} }, error: vi.fn(), info: vi.fn() }),
}))

function setup() {
  const send = vi.fn()
  const window = { webContents: { send }, isDestroyed: () => false } as unknown as BrowserWindow
  new AppUpdater(() => window)
  const check = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'updater:check')?.[1]
  if (!check) throw new Error('Expected updater:check IPC handler')
  return { send, check: () => check({} as Parameters<typeof check>[0]) }
}

beforeEach(() => {
  vi.resetAllMocks()
  autoUpdater.removeAllListeners()
})

describe('desktop update checks', () => {
  it('reports an auto-download failure once without leaving an unhandled rejection', async () => {
    const { send, check } = setup()
    const networkError = new Error('Connection lost while downloading')
    let failDownload!: () => void
    const downloadPromise = new Promise<string[]>((_, reject) => {
      failDownload = () => {
        // electron-updater emits its error event and rejects this distinct promise.
        autoUpdater.emit('error', networkError)
        reject(networkError)
      }
    })
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValueOnce(
      { downloadPromise } as Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>,
    )

    await expect(check()).resolves.toEqual({ started: true })
    autoUpdater.emit('download-progress', {
      percent: 50,
      bytesPerSecond: 100,
      transferred: 500,
      total: 1000,
    })
    failDownload()
    // Let Node report an unhandled rejection if the app did not consume it.
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(send.mock.calls).toEqual([
      ['updater:progress', { percent: 50, bytesPerSecond: 100, transferred: 500, total: 1000 }],
      ['updater:error', { message: networkError.message }],
    ])
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('still tries a different feed if the update metadata request fails', async () => {
    const { send, check } = setup()
    const networkError = new Error('First feed unavailable')
    vi.mocked(autoUpdater.checkForUpdates)
      .mockImplementationOnce(async () => {
        autoUpdater.emit('error', networkError)
        throw networkError
      })
      .mockResolvedValueOnce(null)

    await expect(check()).resolves.toEqual({ started: true })

    expect(autoUpdater.setFeedURL).toHaveBeenCalledTimes(2)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(send.mock.calls).toEqual([['updater:not-available', undefined]])
  })
})
