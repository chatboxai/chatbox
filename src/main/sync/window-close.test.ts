import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncIpcChannels } from '../../shared/sync'
import { attachSyncWindowCloseHandler, deferSyncAppQuit, registerSyncWindowCloseHandler } from './window-close'

const electron = vi.hoisted(() => ({
  app: { quit: vi.fn(), isPackaged: false },
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))
vi.mock('electron', () => electron)

function setUpWindow() {
  const calls: string[] = []
  const webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'http://localhost:1212/#/settings' },
    isDestroyed: () => false,
    isCrashed: () => false,
    getBackgroundThrottling: () => true,
    setBackgroundThrottling: vi.fn(),
    send: vi.fn(() => calls.push('sync')),
  })
  const window = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    hide: vi.fn(() => calls.push('hide')),
    close: vi.fn(() => {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        },
      }
      window.emit('close', event)
      return event.defaultPrevented
    }),
  })
  const browserWindow = window as unknown as BrowserWindow
  electron.BrowserWindow.fromWebContents.mockReturnValue(browserWindow)
  attachSyncWindowCloseHandler(browserWindow)
  const emitIpc = (channel: string, ready = true) => {
    const handler = electron.ipcMain.handle.mock.calls.find(([name]) => name === channel)?.[1]
    return handler({ sender: webContents, senderFrame: webContents.mainFrame }, ready)
  }
  return { calls, window, browserWindow, webContents, emitIpc }
}

describe('background sync on window close', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:1212/')
    registerSyncWindowCloseHandler()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('hides before asking for sync and closes after the renderer finishes', async () => {
    const { calls, window, webContents, emitIpc } = setUpWindow()
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_READY)

    expect(window.close()).toBe(true)
    expect(calls).toEqual(['hide', 'sync'])
    expect(webContents.setBackgroundThrottling).toHaveBeenCalledWith(false)
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_COMPLETE)
    await setImmediate()

    expect(window.close).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['hide', 'sync'])
    expect(webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  })

  it('keeps a window reopened during sync and coalesces another close request', async () => {
    const { window, webContents, emitIpc } = setUpWindow()
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_READY)

    window.close()
    window.emit('show')
    window.close()
    window.emit('show')
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_COMPLETE)
    await setImmediate()

    expect(window.close).toHaveBeenCalledTimes(2)
    expect(webContents.send).toHaveBeenCalledTimes(1)
  })

  it('waits for the already pending sync when the app is asked to quit', async () => {
    const { window, browserWindow, webContents, emitIpc } = setUpWindow()
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_READY)
    electron.app.quit.mockImplementation(() => {
      expect(deferSyncAppQuit(browserWindow)).toBe(false)
      expect(window.close()).toBe(false)
    })

    window.close()
    expect(deferSyncAppQuit(browserWindow)).toBe(true)
    expect(electron.app.quit).not.toHaveBeenCalled()
    expect(webContents.send).toHaveBeenCalledTimes(1)
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_COMPLETE)
    await setImmediate()

    expect(electron.app.quit).toHaveBeenCalledTimes(1)
  })

  it('allows a window without a ready renderer to close immediately', () => {
    const { window, webContents, emitIpc } = setUpWindow()
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_READY)
    emitIpc(SyncIpcChannels.WINDOW_CLOSE_READY, false)
    expect(window.close()).toBe(false)
    expect(window.hide).not.toHaveBeenCalled()
    expect(webContents.send).not.toHaveBeenCalled()
  })
})
