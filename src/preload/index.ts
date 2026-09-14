// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ElectronIPC } from 'src/shared/electron-types'

// export type Channels = 'ipc-example';

function createListener<T extends unknown[]>(channel: string) {
  return (callback: (...args: T) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: T) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

function addMcpStdioTransportEventListener<Args extends unknown[]>(
  transportId: string,
  event: string,
  callback?: (...args: Args) => void
) {
  const channel = `mcp:stdio-transport:${transportId}:${event}`
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
    callback?.(...(args as Args))
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Deep links can arrive while the renderer is still bootstrapping. Hold the latest one until
// the app subscribes so a link that launched the app is not dropped.
let navigateCallback: ((path: string) => void) | undefined
let pendingNavigation: string | undefined
ipcRenderer.on('navigate-to', (_event, path: string) => {
  if (navigateCallback) {
    navigateCallback(path)
  } else {
    pendingNavigation = path
  }
})

const electronHandler: ElectronIPC = {
  invoke: ipcRenderer.invoke,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onSystemThemeChange: (callback: () => void) => {
    ipcRenderer.on('system-theme-updated', callback)
    return () => ipcRenderer.off('system-theme-updated', callback)
  },
  onWindowMaximizedChanged: (callback: (_: Electron.IpcRendererEvent, windowMaximized: boolean) => void) => {
    ipcRenderer.on('window:maximized-changed', callback)
    return () => ipcRenderer.off('window:maximized-changed', callback)
  },
  onWindowFocused: (callback: (_: Electron.IpcRendererEvent) => void) => {
    ipcRenderer.on('window:focused', callback)
    return () => ipcRenderer.off('window:focused', callback)
  },
  onBackupCloseRequest: createListener('backup-operation:close-requested'),
  onWindowShow: (callback: () => void) => {
    ipcRenderer.on('window-show', callback)
    return () => ipcRenderer.off('window-show', callback)
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('update-downloaded', callback)
    return () => ipcRenderer.off('update-downloaded', callback)
  },
  addMcpStdioTransportEventListener,
  onNavigate: (callback: (path: string) => void) => {
    navigateCallback = callback
    if (pendingNavigation !== undefined) {
      const path = pendingNavigation
      pendingNavigation = undefined
      callback(path)
    }
    return () => {
      if (navigateCallback === callback) {
        navigateCallback = undefined
      }
    }
  },
  onSkillsBuiltinUpdated: createListener('skills:builtin-updated'),

  // Auto-updater events
  onUpdaterChecking: createListener('updater:checking'),
  onUpdaterAvailable: createListener('updater:available'),
  onUpdaterNotAvailable: createListener('updater:not-available'),
  onUpdaterProgress: createListener('updater:progress'),
  onUpdaterDownloaded: createListener('updater:downloaded'),
  onUpdaterError: createListener('updater:error'),
}

contextBridge.exposeInMainWorld('electronAPI', electronHandler)
