import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserReadRequest,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
import { BuiltInBrowserController } from './controller'

export const builtInBrowser = new BuiltInBrowserController()

function hostOf(event: IpcMainInvokeEvent): BrowserWindow {
  const host = BrowserWindow.fromWebContents(event.sender)
  if (!host) throw new Error('Built-in browser requests must come from an app window')
  return host
}

export function registerBuiltInBrowserHandlers(): void {
  const watchedOwners = new Set<number>()

  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.readPage, (event, request: BuiltInBrowserReadRequest) => {
    const sender = event.sender
    const ownerId = sender.id
    if (!watchedOwners.has(ownerId)) {
      watchedOwners.add(ownerId)
      // A reloaded or closed window abandons its reads.
      const release = () => {
        watchedOwners.delete(ownerId)
        sender.off('did-navigate', release)
        sender.off('destroyed', release)
        builtInBrowser.cancelReadsOwnedBy(ownerId)
      }
      sender.on('did-navigate', release)
      sender.on('destroyed', release)
    }
    return builtInBrowser.readPage(hostOf(event), ownerId, request)
  })

  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.cancelRead, (event, requestId: string) => {
    builtInBrowser.cancelRead(event.sender.id, requestId)
  })

  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.navigate, (event, url: string) =>
    builtInBrowser.navigate(hostOf(event), url)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.goBack, () => builtInBrowser.goBack())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.goForward, () => builtInBrowser.goForward())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.reload, () => builtInBrowser.reload())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.stop, () => builtInBrowser.stop())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.setView, (event, request: BuiltInBrowserViewRequest) =>
    builtInBrowser.setView(hostOf(event), request)
  )
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.getState, () => builtInBrowser.getState())
  ipcMain.handle(BUILT_IN_BROWSER_CHANNELS.clearData, () => builtInBrowser.clearData())
}
