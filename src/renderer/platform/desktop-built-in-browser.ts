import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserCall,
  type BuiltInBrowserRequest,
  type BuiltInBrowserResults,
  type BuiltInBrowserTabs,
  type BuiltInBrowserViewRequest,
} from '@shared/built-in-browser'
import type { ElectronIPC } from '@shared/electron-types'
import { v4 as uuidv4 } from 'uuid'
import type { BuiltInBrowser, BuiltInBrowserTabControls } from './interfaces'

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

  getTabs(): Promise<BuiltInBrowserTabs> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.getTabs)
  }

  onTabsChange(callback: (tabs: BuiltInBrowserTabs) => void): () => void {
    return this.ipc.onBuiltInBrowserTabs((tabs) => {
      if (tabs.sessionId === this.sessionId) callback(tabs)
    })
  }

  openTab(): Promise<string> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.openTab)
  }

  closeTab(tabId: string): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.closeTab, tabId)
  }

  tab(tabId: string): BuiltInBrowserTabControls {
    return {
      navigate: (url) => this.invoke(BUILT_IN_BROWSER_CHANNELS.navigate, tabId, url),
      goBack: () => this.invoke(BUILT_IN_BROWSER_CHANNELS.goBack, tabId),
      goForward: () => this.invoke(BUILT_IN_BROWSER_CHANNELS.goForward, tabId),
      reload: () => this.invoke(BUILT_IN_BROWSER_CHANNELS.reload, tabId),
      stop: () => this.invoke(BUILT_IN_BROWSER_CHANNELS.stop, tabId),
      setView: (request: BuiltInBrowserViewRequest) => this.invoke(BUILT_IN_BROWSER_CHANNELS.setView, tabId, request),
    }
  }

  clearData(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.clearData)
  }

  dispose(): Promise<void> {
    return this.invoke(BUILT_IN_BROWSER_CHANNELS.dispose)
  }
}
