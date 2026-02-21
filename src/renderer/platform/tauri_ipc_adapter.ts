import type { DesktopIPC } from '@shared/desktop-ipc-types'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

type Unlisten = () => void

function getWindowWithTauri() {
  return window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const w = getWindowWithTauri()
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__)
}

function listenEvent(eventName: string, callback: (payload: unknown) => void): () => void {
  let unlisten: Unlisten | null = null
  let isDisposed = false

  void tauriListen(eventName, (event) => {
    if (!isDisposed) {
      callback(event.payload)
    }
  })
    .then((dispose) => {
      if (isDisposed) {
        dispose()
      } else {
        unlisten = dispose
      }
    })
    .catch((err) => {
      console.error(`[tauri-ipc] subscribe failed: ${eventName}`, err)
    })

  return () => {
    isDisposed = true
    unlisten?.()
    unlisten = null
  }
}

export function createTauriIPCAdapter(): DesktopIPC {
  return {
    invoke: (channel: string, ...args: unknown[]) => tauriInvoke('ipc_invoke', { channel, args }),
    onSystemThemeChange: (callback: () => void) => listenEvent('system-theme-updated', () => callback()),
    onWindowMaximizedChanged: (callback: (_event: unknown, windowMaximized: boolean) => void) =>
      listenEvent('window:maximized-changed', (payload: unknown) => {
        callback(undefined, Boolean(payload))
      }),
    onWindowShow: (callback: () => void) => listenEvent('window-show', () => callback()),
    onWindowFocused: (callback: () => void) => listenEvent('window:focused', () => callback()),
    onUpdateDownloaded: (callback: () => void) => listenEvent('update-downloaded', () => callback()),
    addMcpStdioTransportEventListener: (
      transportId: string,
      event: string,
      callback?: (...args: unknown[]) => void
    ) => {
      const eventName = `mcp:stdio-transport:${transportId}:${event}`
      return listenEvent(eventName, (payload: unknown) => {
        if (Array.isArray(payload)) {
          callback?.(...payload)
          return
        }
        callback?.(payload)
      })
    },
    onNavigate: (callback: (path: string) => void) =>
      listenEvent('navigate-to', (payload: unknown) => {
        if (typeof payload === 'string') {
          callback(payload)
        }
      }),
  }
}
