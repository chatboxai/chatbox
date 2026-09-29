import {
  BUILT_IN_BROWSER_CHANNELS,
  type BuiltInBrowserTabs,
  EMPTY_BUILT_IN_BROWSER_STATE,
} from '@shared/built-in-browser'
import type { ElectronIPC } from '@shared/electron-types'
import { describe, expect, it, vi } from 'vitest'
import { DesktopBuiltInBrowser } from './desktop-built-in-browser'

function setup() {
  const callbacks = new Set<(tabs: BuiltInBrowserTabs) => void>()
  const ipc = {
    invoke: vi.fn().mockResolvedValue(undefined),
    onBuiltInBrowserTabs: vi.fn((callback: (tabs: BuiltInBrowserTabs) => void) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    }),
  }
  const browser = new DesktopBuiltInBrowser(ipc as unknown as ElectronIPC)
  return { browser, ipc, callbacks }
}

describe('conversation-scoped built-in browser', () => {
  it('opens, lists and closes tabs, clears browser data and releases the conversation', async () => {
    const { browser, ipc } = setup()
    const a = browser.forSession('a')
    await a.openTab()
    await a.getTabs()
    await a.closeTab('t1')
    await a.clearData()
    await a.dispose()
    expect(ipc.invoke.mock.calls).toEqual([
      [BUILT_IN_BROWSER_CHANNELS.openTab, 'a'],
      [BUILT_IN_BROWSER_CHANNELS.getTabs, 'a'],
      [BUILT_IN_BROWSER_CHANNELS.closeTab, 'a', 't1'],
      [BUILT_IN_BROWSER_CHANNELS.clearData, 'a'],
      [BUILT_IN_BROWSER_CHANNELS.dispose, 'a'],
    ])
  })

  it('binds navigation, history, view placement and cancellation to their conversation and tab', async () => {
    const { browser, ipc } = setup()
    const a = browser.forSession('a')
    const b = browser.forSession('b')
    await a.tab('t1').navigate('https://a.example/')
    await b.tab('t2').navigate('https://b.example/')
    await a.tab('t1').goBack()
    await b.tab('t2').goForward()
    await a.tab('t1').reload()
    await b.tab('t2').stop()
    await b.tab('t2').setView({ visible: false })
    expect(ipc.invoke.mock.calls).toEqual([
      [BUILT_IN_BROWSER_CHANNELS.navigate, 'a', 't1', 'https://a.example/'],
      [BUILT_IN_BROWSER_CHANNELS.navigate, 'b', 't2', 'https://b.example/'],
      [BUILT_IN_BROWSER_CHANNELS.goBack, 'a', 't1'],
      [BUILT_IN_BROWSER_CHANNELS.goForward, 'b', 't2'],
      [BUILT_IN_BROWSER_CHANNELS.reload, 'a', 't1'],
      [BUILT_IN_BROWSER_CHANNELS.stop, 'b', 't2'],
      [BUILT_IN_BROWSER_CHANNELS.setView, 'b', 't2', { visible: false }],
    ])
    const abort = new AbortController()
    const read = a.request({ kind: 'read', tab: 't1' }, { signal: abort.signal })
    abort.abort()
    await read
    expect(ipc.invoke).toHaveBeenCalledWith(
      BUILT_IN_BROWSER_CHANNELS.request,
      'a',
      expect.objectContaining({ kind: 'read', tab: 't1', requestId: expect.any(String) })
    )
    expect(ipc.invoke).toHaveBeenCalledWith(BUILT_IN_BROWSER_CHANNELS.cancel, 'a', expect.any(String))
    expect(() => browser.tab('t1').navigate('https://example.com')).toThrow('conversation is required')
  })

  it('does not deliver another conversation’s tabs or reading events', () => {
    const { browser, callbacks } = setup()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribe = browser.forSession('a').onTabsChange(a)
    browser.forSession('b').onTabsChange(b)
    const tabs: BuiltInBrowserTabs = {
      sessionId: 'a',
      tabs: [{ ...EMPTY_BUILT_IN_BROWSER_STATE, id: 't1', url: 'https://a.example/', reading: true }],
    }
    for (const callback of callbacks) callback(tabs)
    expect(a).toHaveBeenCalledWith(tabs)
    expect(b).not.toHaveBeenCalled()
    unsubscribe()
    for (const callback of callbacks) callback(tabs)
    expect(a).toHaveBeenCalledTimes(1)
  })
})
