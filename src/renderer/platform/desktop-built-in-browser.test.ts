import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserState,
  EMPTY_BUILT_IN_BROWSER_STATE,
} from '@shared/built-in-browser'
import type { ElectronIPC } from '@shared/electron-types'
import { describe, expect, it, vi } from 'vitest'
import { DesktopBuiltInBrowser } from './desktop-built-in-browser'

function setup() {
  const callbacks = new Set<(state: BuiltInBrowserState) => void>()
  const ipc = {
    invoke: vi.fn().mockResolvedValue(EMPTY_BUILT_IN_BROWSER_STATE),
    onBuiltInBrowserState: vi.fn((callback: (state: BuiltInBrowserState) => void) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    }),
  }
  const browser = new DesktopBuiltInBrowser(ipc as unknown as ElectronIPC)
  return { browser, ipc, callbacks }
}

describe('conversation-scoped built-in browser', () => {
  it('sends explicit clearing scopes and releases the conversation', async () => {
    const { browser, ipc } = setup()
    const a = browser.forSession('a')
    await a.clearData('page')
    await a.clearData('all')
    await a.dispose()
    expect(ipc.invoke.mock.calls).toEqual([
      [BUILT_IN_BROWSER_CHANNELS.clearData, 'a', 'page'],
      [BUILT_IN_BROWSER_CHANNELS.clearData, 'a', 'all'],
      [BUILT_IN_BROWSER_CHANNELS.dispose, 'a'],
    ])
  })
  it('binds navigation, history, page reads, view placement and cancellation to their conversation', async () => {
    const { browser, ipc } = setup()
    const a = browser.forSession('a')
    const b = browser.forSession('b')
    await a.navigate('https://a.example/')
    await b.navigate('https://b.example/')
    await a.goBack()
    await b.goForward()
    await a.reload()
    await b.stop()
    await a.getState()
    await b.setView({ visible: false })
    expect(ipc.invoke.mock.calls).toEqual([
      [BUILT_IN_BROWSER_CHANNELS.navigate, 'a', 'https://a.example/'],
      [BUILT_IN_BROWSER_CHANNELS.navigate, 'b', 'https://b.example/'],
      [BUILT_IN_BROWSER_CHANNELS.goBack, 'a'],
      [BUILT_IN_BROWSER_CHANNELS.goForward, 'b'],
      [BUILT_IN_BROWSER_CHANNELS.reload, 'a'],
      [BUILT_IN_BROWSER_CHANNELS.stop, 'b'],
      [BUILT_IN_BROWSER_CHANNELS.getState, 'a'],
      [BUILT_IN_BROWSER_CHANNELS.setView, 'b', { visible: false }],
    ])
    const abort = new AbortController()
    const read = a.request({ kind: 'read' }, { signal: abort.signal })
    abort.abort()
    await read
    expect(ipc.invoke).toHaveBeenCalledWith(
      BUILT_IN_BROWSER_CHANNELS.request,
      'a',
      expect.objectContaining({ kind: 'read', requestId: expect.any(String) })
    )
    expect(ipc.invoke).toHaveBeenCalledWith(BUILT_IN_BROWSER_CHANNELS.cancel, 'a', expect.any(String))
    expect(() => browser.navigate('https://example.com')).toThrow('conversation is required')
  })

  it('does not deliver another conversation’s state or reading events', () => {
    const { browser, callbacks } = setup()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribe = browser.forSession('a').onStateChange(a)
    browser.forSession('b').onStateChange(b)
    const state = { ...EMPTY_BUILT_IN_BROWSER_STATE, sessionId: 'a', url: 'https://a.example/', reading: true }
    for (const callback of callbacks) callback(state)
    expect(a).toHaveBeenCalledWith(state)
    expect(b).not.toHaveBeenCalled()
    unsubscribe()
    for (const callback of callbacks) callback(state)
    expect(a).toHaveBeenCalledTimes(1)
  })
})
