import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BUILT_IN_BROWSER_CHANNELS as channels } from '@shared/built-in-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  controllers: [] as Array<{
    sessionId?: string
    navigate: ReturnType<typeof vi.fn>
    setView: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    getState: ReturnType<typeof vi.fn>
  }>,
  host: {},
  clearData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => mocks.host },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
  },
}))
const downloadRoot = mkdtempSync(path.join(tmpdir(), 'browser-ipc-downloads-'))
const downloadsOf = (sessionId: string) => path.join(downloadRoot, 'browser-downloads', sessionId)
vi.mock('./page-downloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./page-downloads')>()),
  downloadLocationOf: (sessionId: string) => ({ root: downloadRoot, directory: downloadsOf(sessionId) }),
}))
vi.mock('./controller', () => ({
  BuiltInBrowserController: class {
    navigate = vi.fn()
    setView = vi.fn().mockResolvedValue(null)
    dispose = vi.fn()
    getState = vi.fn(() => ({
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      reading: false,
    }))
    clearData = mocks.clearData
    constructor(public sessionId?: string) {
      mocks.controllers.push(this)
    }
  },
}))
const { registerBuiltInBrowserHandlers } = await import('./index')
function invoke(channel: string, ...args: unknown[]) {
  return mocks.handlers.get(channel)?.(...args)
}
function owner(id: number) {
  return { sender: Object.assign(new EventEmitter(), { id, send: vi.fn(), isDestroyed: () => false }) }
}
function openTab(event: ReturnType<typeof owner>, sessionId: string): string {
  return invoke(channels.openTab, event, sessionId) as string
}

describe('browser IPC conversation ownership', () => {
  beforeEach(() => {
    mocks.controllers.length = 0
    mocks.handlers.clear()
    mocks.clearData.mockReset().mockResolvedValue(undefined)
    registerBuiltInBrowserHandlers()
  })

  it('keeps tabs separate by conversation and window and routes each call to its tab', () => {
    const event = owner(1)
    const a1 = openTab(event, 'a')
    const b1 = openTab(event, 'b')
    const a2 = openTab(event, 'a')
    openTab(owner(2), 'a')
    expect(mocks.controllers.map((controller) => controller.sessionId)).toEqual(['a', 'b', 'a', 'a'])
    invoke(channels.navigate, event, 'a', a1, 'https://a.example')
    invoke(channels.navigate, event, 'a', a2, 'https://a.example/next')
    invoke(channels.navigate, event, 'b', b1, 'https://b.example')
    expect(mocks.controllers[0].navigate).toHaveBeenCalledWith(mocks.host, 'https://a.example')
    expect(mocks.controllers[2].navigate).toHaveBeenCalledWith(mocks.host, 'https://a.example/next')
    expect(mocks.controllers[1].navigate).toHaveBeenCalledWith(mocks.host, 'https://b.example')
    expect(() => invoke(channels.navigate, event, 'b', 't9', 'https://b.example')).toThrow('No tab t9')
    expect(() => invoke(channels.getTabs, event, '')).toThrow('conversation is required')
  })

  it('lists and pushes the tabs of a conversation, and closes one tab alone', () => {
    const event = owner(1)
    const first = openTab(event, 'a')
    const second = openTab(event, 'a')
    expect(invoke(channels.getTabs, event, 'a')).toMatchObject({
      sessionId: 'a',
      tabs: [{ id: first }, { id: second }],
    })
    invoke(channels.closeTab, event, 'a', first)
    expect(mocks.controllers[0].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].dispose).not.toHaveBeenCalled()
    expect(event.sender.send).toHaveBeenLastCalledWith(channels.tabs, {
      sessionId: 'a',
      tabs: [expect.objectContaining({ id: second })],
    })
  })

  it('releases deleted conversations and their downloads across windows without recreating pages during late cleanup', async () => {
    const event = owner(1)
    const other = owner(2)
    for (const sessionId of ['a', 'b']) {
      mkdirSync(downloadsOf(sessionId), { recursive: true })
      writeFileSync(path.join(downloadsOf(sessionId), 'report.csv'), 'data')
    }
    const tab = openTab(event, 'a')
    openTab(event, 'b')
    openTab(other, 'a')
    await invoke(channels.dispose, event, 'a')
    expect(mocks.controllers[0].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[2].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].dispose).not.toHaveBeenCalled()
    expect(existsSync(downloadsOf('a'))).toBe(false)
    expect(existsSync(path.join(downloadsOf('b'), 'report.csv'))).toBe(true)
    await invoke(channels.dispose, event, 'a')
    invoke(channels.cancel, event, 'a', 'late-abort')
    invoke(channels.setView, event, 'a', tab, { visible: false })
    expect(mocks.controllers).toHaveLength(3)
    event.sender.emit('destroyed')
    expect(mocks.controllers[0].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].dispose).toHaveBeenCalledOnce()
  })

  it('closes tabs in every window before clearing the shared profile and blocks new page loads until done', async () => {
    const event = owner(1)
    const tab = openTab(event, 'a')
    openTab(owner(2), 'b')
    let finish: (() => void) | undefined
    mocks.clearData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const clearing = invoke(channels.clearData, event, 'a')
    await Promise.resolve()
    expect(mocks.controllers.every((browser) => browser.dispose.mock.calls.length === 1)).toBe(true)
    expect(mocks.clearData).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].dispose.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearData.mock.invocationCallOrder[0]
    )
    expect(() => invoke(channels.openTab, event, 'a')).toThrow('being cleared')
    expect(() => invoke(channels.request, event, 'a', { kind: 'read', requestId: 'blocked' })).toThrow('being cleared')
    const repeated = invoke(channels.clearData, event, 'a')
    finish?.()
    await Promise.all([clearing, repeated])
    expect(mocks.clearData).toHaveBeenCalledOnce()
    expect(() => invoke(channels.navigate, event, 'a', tab, 'https://example.com')).toThrow(`No tab ${tab}`)
    expect(invoke(channels.getTabs, event, 'a')).toMatchObject({ tabs: [] })
  })

  it('allows retry after shared profile clearing fails', async () => {
    const event = owner(1)
    mocks.clearData.mockRejectedValueOnce(new Error('disk failure'))
    await expect(invoke(channels.clearData, event, 'a')).rejects.toThrow('disk failure')
    await invoke(channels.clearData, event, 'a')
    expect(mocks.clearData).toHaveBeenCalledTimes(2)
  })

  it('shows only the selected tab across conversations and disposes pages on renderer reload or destruction', () => {
    const event = owner(1)
    openTab(event, 'a')
    const b1 = openTab(event, 'b')
    openTab(event, 'b')
    const visible = { visible: true, bounds: { x: 1, y: 1, width: 300, height: 600 } }
    invoke(channels.setView, event, 'b', b1, visible)
    expect(mocks.controllers[0].setView).toHaveBeenCalledWith(mocks.host, { visible: false })
    expect(mocks.controllers[2].setView).toHaveBeenCalledWith(mocks.host, { visible: false })
    expect(mocks.controllers[1].setView).toHaveBeenCalledWith(mocks.host, visible)
    event.sender.emit('did-navigate')
    for (const controller of mocks.controllers) expect(controller.dispose).toHaveBeenCalledOnce()
    openTab(event, 'a')
    expect(mocks.controllers).toHaveLength(4)
    event.sender.emit('destroyed')
    expect(mocks.controllers[3].dispose).toHaveBeenCalledOnce()
  })
})
