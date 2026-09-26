import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserPage,
  type BuiltInBrowserState,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import type { ElectronIPC } from '@shared/electron-types'
import { v4 as uuidv4 } from 'uuid'
import type { BuiltInBrowser } from './interfaces'

export class DesktopBuiltInBrowser implements BuiltInBrowser {
  constructor(private readonly ipc: ElectronIPC) {}

  async readPage(params: {
    url?: string
    timeoutMs?: number
    screenshot?: boolean
    script?: { code: string; expectedUrl: string }
    signal?: AbortSignal
  }): Promise<BuiltInBrowserPage> {
    const { signal } = params
    signal?.throwIfAborted()
    const requestId = uuidv4()
    const onAbort = () => {
      void this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.cancelRead, requestId)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.readPage, {
        requestId,
        url: params.url,
        timeoutMs: params.timeoutMs,
        screenshot: params.screenshot,
        script: params.script,
      })
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  navigate(url: string): Promise<void> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.navigate, url)
  }

  goBack(): Promise<void> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.goBack)
  }

  goForward(): Promise<void> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.goForward)
  }

  reload(): Promise<void> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.reload)
  }

  stop(): Promise<void> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.stop)
  }

  setView(request: BuiltInBrowserViewRequest): Promise<string | null> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.setView, request)
  }

  getState(): Promise<BuiltInBrowserState> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.getState)
  }

  onStateChange(callback: (state: BuiltInBrowserState) => void): () => void {
    return this.ipc.onBuiltInBrowserState(callback)
  }

  clearData(): Promise<void> {
    return this.ipc.invoke(BUILT_IN_BROWSER_CHANNELS.clearData)
  }
}
