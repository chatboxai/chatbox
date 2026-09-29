import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserCall,
  type BuiltInBrowserClearScope,
  type BuiltInBrowserRequest,
  type BuiltInBrowserResults,
  type BuiltInBrowserState,
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

  async request<Request extends BuiltInBrowserRequest>(
    request: Request,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<BuiltInBrowserResults[Request['kind']]> {
    const { signal } = options
    signal?.throwIfAborted()
    const call: BuiltInBrowserCall = { ...request, requestId: uuidv4(), timeoutMs: options.timeoutMs }
    const onAbort = () => {
      void this.invoke(BUILT_IN_BROWSER_CHANNELS.cancel, call.requestId)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      // The main process answers each kind of request with that kind's result.
      return await this.invoke<BuiltInBrowserResults[Request['kind']]>(BUILT_IN_BROWSER_CHANNELS.request, call)
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
