// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { ElectronIPC } from 'src/shared/electron-types'

// export type Channels = 'ipc-example';

const electronHandler: ElectronIPC = {
  // ipcRenderer: {
  //     sendMessage(channel: Channels, ...args: unknown[]) {
  //         ipcRenderer.send(channel, ...args);
  //     },
  //     on(channel: Channels, func: (...args: unknown[]) => void) {
  //         const subscription = (
  //             _event: IpcRendererEvent,
  //             ...args: unknown[]
  //         ) => func(...args);
  //         ipcRenderer.on(channel, subscription);

  //         return () => {
  //             ipcRenderer.removeListener(channel, subscription);
  //         };
  //     },
  //     once(channel: Channels, func: (...args: unknown[]) => void) {
  //         ipcRenderer.once(channel, (_event, ...args) => func(...args));
  //     },
  // },
  invoke: ipcRenderer.invoke,
  onSystemThemeChange: (callback: () => void) => {
    ipcRenderer.on('system-theme-updated', callback)
    return () => ipcRenderer.off('system-theme-updated', callback)
  },
  onWindowShow: (callback: () => void) => {
    ipcRenderer.on('window-show', callback)
    return () => ipcRenderer.off('window-show', callback)
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('update-downloaded', callback)
    return () => ipcRenderer.off('update-downloaded', callback)
  },
  addMcpStdioTransportEventListener: (transportId: string, event: string, callback?: (...args: any[]) => void) => {
    ipcRenderer.on(`mcp:stdio-transport:${transportId}:${event}`, (_event, ...args) => {
      callback?.(...args)
    })
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronHandler)
