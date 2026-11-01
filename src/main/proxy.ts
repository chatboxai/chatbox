import { session } from 'electron'
import { builtInBrowser } from './built-in-browser'
import * as store from './store-node'

export function init() {
  const { proxy } = store.getSettings()
  if (proxy) {
    void ensure(proxy)
  }
}

/** Applies the proxy to the app and the built-in browser; resolves once both use it. */
export async function ensure(proxy?: string): Promise<void> {
  await Promise.all([
    session.defaultSession.setProxy(proxy ? { proxyRules: proxy } : {}),
    builtInBrowser.setProxy(proxy),
  ])
}
