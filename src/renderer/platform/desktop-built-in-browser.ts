import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserClearScope,
  type BuiltInBrowserPage,
  type BuiltInBrowserState,
  type BuiltInBrowserUploadRequest,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import type { ElectronIPC } from '@shared/electron-types'
import { v4 as uuidv4 } from 'uuid'
import type { BuiltInBrowser } from './interfaces'

export class DesktopBuiltInBrowser implements BuiltInBrowser {
  constructor(
    private readonly ipc: ElectronIPC,
    private readonly sessionId?: string
  ) {}

  forSession(sessionId: string): BuiltInBrowser {
    return new DesktopBuiltInBrowser(this.ipc, sessionId)
  }

  private invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.sessionId) throw new Error('A conversation is required for the built-in browser')
    return this.ipc.invoke(channel, this.sessionId, ...args)
  }

  async readPage(params: {
    url?: string
    timeoutMs?: number
    screenshot?: boolean
    script?: { code: string; page: string; downloadDirectory?: string }
    upload?: BuiltInBrowserUploadRequest
    signal?: AbortSignal
  }): Promise<BuiltInBrowserPage> {
    const { signal } = params
    signal?.throwIfAborted()
    const requestId = uuidv4()
    const onAbort = () => {
      void this.invoke(BUILT_IN_BROWSER_CHANNELS.cancelRead, requestId)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await this.invoke(BUILT_IN_BROWSER_CHANNELS.readPage, {
        requestId,
        url: params.url,
        timeoutMs: params.timeoutMs,
        screenshot: params.screenshot,
        script: params.script,
        upload: params.upload,
      })
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  navigate(url: string): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.navigate, url)
  }

  goBack(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.goBack)
  }

  goForward(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.goForward)
  }

  reload(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.reload)
  }

  stop(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.stop)
  }

  setView(request: BuiltInBrowserViewRequest): Promise<string | null> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.setView, request)
  }

  getState(): Promise<BuiltInBrowserState> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.getState)
  }

  onStateChange(callback: (state: BuiltInBrowserState) => void): () => void {
    return this.ipc.onBuiltInBrowserState((state) => {
      if (state.sessionId === this.sessionId) callback(state)
    })
  }

  clearData(scope: BuiltInBrowserClearScope): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.clearData, scope)
  }

  dispose(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.dispose)
  }
}
