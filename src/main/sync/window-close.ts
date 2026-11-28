import { app, BrowserWindow, ipcMain } from 'electron'
import { SyncIpcChannels } from '../../shared/sync'
import { isSyncSender } from './sender'

interface CloseState {
  ready: boolean
  allowClose: boolean
  pending?: {
    close: boolean
    quit: boolean
    backgroundThrottling: boolean
  }
}
const states = new WeakMap<BrowserWindow, CloseState>()

export function attachSyncWindowCloseHandler(window: BrowserWindow): void {
  const state: CloseState = { ready: false, allowClose: false }
  states.set(window, state)

  window.on('close', (event) => {
    if (!event.defaultPrevented && deferClose(window, false)) event.preventDefault()
  })
  window.on('show', () => {
    if (state.pending && !state.pending.quit) state.pending.close = false
  })
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      state.ready = false
      finish(window)
    }
  })
  window.webContents.on('render-process-gone', () => {
    state.ready = false
    finish(window)
  })
}

export function deferSyncAppQuit(window: BrowserWindow | null): boolean {
  return window !== null && deferClose(window, true)
}

function deferClose(window: BrowserWindow, quit: boolean): boolean {
  const state = states.get(window)
  if (!state || state.allowClose || window.isDestroyed() || window.webContents.isCrashed()) return false

  if (state.pending) {
    state.pending.close = true
    state.pending.quit ||= quit
    window.hide()
    return true
  }
  if (!state.ready) return false

  const backgroundThrottling = window.webContents.getBackgroundThrottling()
  state.pending = { close: true, quit, backgroundThrottling }
  window.webContents.setBackgroundThrottling(false)
  window.hide()
  window.webContents.send(SyncIpcChannels.WINDOW_CLOSE_REQUESTED)
  return true
}

function finish(window: BrowserWindow): void {
  const state = states.get(window)
  const pending = state?.pending
  if (!state || !pending || window.isDestroyed()) return

  state.pending = undefined
  window.webContents.setBackgroundThrottling(pending.backgroundThrottling)
  if (!pending.close) return

  state.allowClose = true
  try {
    if (pending.quit) app.quit()
    else window.close()
  } finally {
    state.allowClose = false
  }
}

export function registerSyncWindowCloseHandler(): void {
  ipcMain.handle(SyncIpcChannels.WINDOW_CLOSE_READY, (event, ready: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const state = window && states.get(window)
    if (state && typeof ready === 'boolean' && isSyncSender(event, window?.webContents)) state.ready = ready
  })
  ipcMain.handle(SyncIpcChannels.WINDOW_CLOSE_COMPLETE, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && states.has(window) && isSyncSender(event, window.webContents)) setImmediate(() => finish(window))
  })
}
