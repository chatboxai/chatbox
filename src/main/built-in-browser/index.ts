import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserClearScope,
  type BuiltInBrowserReadRequest,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
import { BuiltInBrowserController } from './controller'

// All conversation views use the same persistent website login profile and proxy.
export const builtInBrowser = new BuiltInBrowserController()

function hostOf(event: IpcMainInvokeEvent): BrowserWindow {
  const host = BrowserWindow.fromWebContents(event.sender)
  if (!host) throw new Error('Built-in browser requests must come from an app window')
  return host
}

export function registerBuiltInBrowserHandlers(): void {
  const owners = new Map<number, Map<string, BuiltInBrowserController>>()
  let clearingProfile: Promise<void> | undefined

  function validate(event: IpcMainInvokeEvent, sessionId: string): void {
    hostOf(event)
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('A conversation is required for the built-in browser')
    }
  }

  function browserOf(event: IpcMainInvokeEvent, sessionId: string): BuiltInBrowserController {
    validate(event, sessionId)
    const sender = event.sender
    let browsers = owners.get(sender.id)
    if (!browsers) {
      browsers = new Map()
      owners.set(sender.id, browsers)
      const release = () => {
        sender.off('did-navigate', release)
        sender.off('destroyed', release)
        for (const browser of owners.get(sender.id)?.values() ?? []) browser.dispose()
        owners.delete(sender.id)
      }
      sender.on('did-navigate', release)
      sender.on('destroyed', release)
    }
    let browser = browsers.get(sessionId)
    if (!browser) {
      // The owner listener releases all its pages together, including on renderer reload.
      browser = new BuiltInBrowserController(sessionId, false)
      browsers.set(sessionId, browser)
    }
    return browser
  }

  function pageBrowserOf(event: IpcMainInvokeEvent, sessionId: string): BuiltInBrowserController {
    if (clearingProfile) throw new Error('Browser data is being cleared. Try again when clearing finishes.')
    return browserOf(event, sessionId)
  }

  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.readPage, (event, sessionId: string, request: BuiltInBrowserReadRequest) =>
    pageBrowserOf(event, sessionId).readPage(hostOf(event), event.sender.id, request)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.cancelRead, (event, sessionId: string, requestId: string) => {
    validate(event, sessionId)
    owners.get(event.sender.id)?.get(sessionId)?.cancelRead(event.sender.id, requestId)
  })
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.dispose, (event, sessionId: string) => {
    validate(event, sessionId)
    // Session deletion applies across windows, unlike ordinary page operations.
    for (const browsers of owners.values()) {
      browsers.get(sessionId)?.dispose()
      browsers.delete(sessionId)
    }
  })
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.navigate, (event, sessionId: string, url: string) =>
    pageBrowserOf(event, sessionId).navigate(hostOf(event), url)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.goBack, (event, sessionId: string) =>
    pageBrowserOf(event, sessionId).goBack()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.goForward, (event, sessionId: string) =>
    pageBrowserOf(event, sessionId).goForward()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.reload, (event, sessionId: string) =>
    pageBrowserOf(event, sessionId).reload()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.stop, (event, sessionId: string) => browserOf(event, sessionId).stop())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.setView, (event, sessionId: string, request: BuiltInBrowserViewRequest) => {
    validate(event, sessionId)
    const host = hostOf(event)
    if (!request.visible) return owners.get(event.sender.id)?.get(sessionId)?.setView(host, request) ?? null
    const browser = browserOf(event, sessionId)
    for (const other of owners.get(event.sender.id)?.values() ?? []) {
      if (other !== browser) void other.setView(host, { visible: false })
    }
    return browser.setView(host, request)
  })
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.getState, (event, sessionId: string) =>
    browserOf(event, sessionId).getState()
  )
  ipcMain.handle(
    BUILT_IN_BROWSER_CHANNELS.clearData,
    async (event, sessionId: string, scope: BuiltInBrowserClearScope) => {
      validate(event, sessionId)
      if (scope === 'page') {
        owners.get(event.sender.id)?.get(sessionId)?.resetPage()
        return
      }
      if (scope !== 'all') throw new Error('Unknown browser data scope')
      if (clearingProfile) return clearingProfile
      // Close every page before clearing shared storage so running scripts cannot repopulate it.
      clearingProfile = Promise.resolve().then(async () => {
        for (const browsers of owners.values()) {
          for (const browser of browsers.values()) browser.resetPage()
        }
        await builtInBrowser.clearData()
      })
      try {
        await clearingProfile
      } finally {
        clearingProfile = undefined
      }
    }
  )
}
