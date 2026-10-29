import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserCall,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
import { BuiltInBrowserController } from './controller'
import { downloadLocationOf, removeDownloads } from './page-downloads'
import { SessionPages } from './session-pages'

// All conversation views use the same persistent website login profile and proxy.
export const builtInBrowser = new BuiltInBrowserController()

function hostOf(event: IpcMainInvokeEvent): BrowserWindow {
  const host = BrowserWindow.fromWebContents(event.sender)
  if (!host) throw new Error('Built-in browser requests must come from an app window')
  return host
}

export function registerBuiltInBrowserHandlers(): void {
  const owners = new Map<number, Map<string, SessionPages>>()
  let clearingProfile: Promise<void> | undefined

  function validate(event: IpcMainInvokeEvent, sessionId: string): void {
    hostOf(event)
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('A conversation is required for the built-in browser')
    }
  }

  function pagesOf(event: IpcMainInvokeEvent, sessionId: string): SessionPages {
    validate(event, sessionId)
    const sender = event.sender
    let sessions = owners.get(sender.id)
    if (!sessions) {
      sessions = new Map()
      owners.set(sender.id, sessions)
      const release = () => {
        sender.off('did-navigate', release)
        sender.off('destroyed', release)
        for (const pages of owners.get(sender.id)?.values() ?? []) pages.dispose()
        owners.delete(sender.id)
      }
      sender.on('did-navigate', release)
      sender.on('destroyed', release)
    }
    let pages = sessions.get(sessionId)
    if (!pages) {
      // The owner listener releases all its pages together, including on renderer reload.
      pages = new SessionPages(sessionId, sender)
      sessions.set(sessionId, pages)
    }
    return pages
  }

  function usablePagesOf(event: IpcMainInvokeEvent, sessionId: string): SessionPages {
    if (clearingProfile) throw new Error('Browser data is being cleared. Try again when clearing finishes.')
    return pagesOf(event, sessionId)
  }

  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.request, (event, sessionId: string, call: BuiltInBrowserCall) =>
    usablePagesOf(event, sessionId).request(hostOf(event), event.sender.id, call)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.cancel, (event, sessionId: string, requestId: string) => {
    validate(event, sessionId)
    owners.get(event.sender.id)?.get(sessionId)?.cancel(event.sender.id, requestId)
  })
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.dispose, async (event, sessionId: string) => {
    validate(event, sessionId)
    // Session deletion applies across windows, unlike ordinary page operations.
    for (const sessions of owners.values()) {
      sessions.get(sessionId)?.dispose()
      sessions.delete(sessionId)
    }
    // The conversation's downloads go with it.
    await removeDownloads(downloadLocationOf(sessionId))
  })
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.getTabs, (event, sessionId: string) => pagesOf(event, sessionId).list())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.openTab, (event, sessionId: string) =>
    usablePagesOf(event, sessionId).openTab()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.closeTab, (event, sessionId: string, tabId: string) =>
    pagesOf(event, sessionId).closeTab(tabId)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.navigate, (event, sessionId: string, tabId: string, url: string) =>
    usablePagesOf(event, sessionId).tab(tabId).navigate(hostOf(event), url)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.goBack, (event, sessionId: string, tabId: string) =>
    usablePagesOf(event, sessionId).tab(tabId).goBack()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.goForward, (event, sessionId: string, tabId: string) =>
    usablePagesOf(event, sessionId).tab(tabId).goForward()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.reload, (event, sessionId: string, tabId: string) =>
    usablePagesOf(event, sessionId).tab(tabId).reload()
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.stop, (event, sessionId: string, tabId: string) =>
    pagesOf(event, sessionId).tab(tabId).stop()
  )
  ipcMain.handle(
    BUILT_IN_BROWSER_CHANNELS.setView,
    (event, sessionId: string, tabId: string, request: BuiltInBrowserViewRequest) => {
      validate(event, sessionId)
      const host = hostOf(event)
      if (!request.visible) return owners.get(event.sender.id)?.get(sessionId)?.setView(host, tabId, request) ?? null
      const pages = pagesOf(event, sessionId)
      for (const other of owners.get(event.sender.id)?.values() ?? []) {
        if (other !== pages) other.hideAll(host)
      }
      return pages.setView(host, tabId, request)
    }
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.clearData, async (event, sessionId: string) => {
    validate(event, sessionId)
    if (clearingProfile) return clearingProfile
    // Close every page before clearing shared storage so running scripts cannot repopulate it.
    clearingProfile = Promise.resolve().then(async () => {
      for (const sessions of owners.values()) {
        for (const pages of sessions.values()) pages.closeAll()
      }
      await builtInBrowser.clearData()
    })
    try {
      await clearingProfile
    } finally {
      clearingProfile = undefined
    }
  })
}
