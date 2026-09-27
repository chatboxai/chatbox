import { EventEmitter } from 'node:events'
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
    resetPage: ReturnType<typeof vi.fn>
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
vi.mock('./controller', () => ({
  BuiltInBrowserController: class {
    navigate = vi.fn()
    setView = vi.fn()
    dispose = vi.fn()
    getState = vi.fn()
    resetPage = vi.fn()
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
  return { sender: Object.assign(new EventEmitter(), { id }) }
}

describe('browser IPC conversation ownership', () => {
  beforeEach(() => {
    mocks.controllers.length = 0
    mocks.handlers.clear()
    mocks.clearData.mockReset().mockResolvedValue(undefined)
    registerBuiltInBrowserHandlers()
  })
  it('keeps controllers separate by conversation and window and reuses each page', () => {
    const event = owner(1)
    invoke(channels.navigate, event, 'a', 'https://a.example')
    invoke(channels.navigate, event, 'b', 'https://b.example')
    invoke(channels.navigate, event, 'a', 'https://a.example/next')
    invoke(channels.getState, owner(2), 'a')
    expect(mocks.controllers.map((controller) => controller.sessionId)).toEqual(['a', 'b', 'a'])
    expect(mocks.controllers[0].navigate.mock.calls).toEqual([
      [mocks.host, 'https://a.example'],
      [mocks.host, 'https://a.example/next'],
    ])
    expect(mocks.controllers[1].navigate).toHaveBeenCalledWith(mocks.host, 'https://b.example')
    expect(() => invoke(channels.getState, event, '')).toThrow('conversation is required')
  })
  it('releases deleted conversations across windows without recreating pages during late cleanup', () => {
    const event = owner(1)
    const other = owner(2)
    invoke(channels.navigate, event, 'a', 'https://a.example')
    invoke(channels.navigate, event, 'b', 'https://b.example')
    invoke(channels.navigate, other, 'a', 'https://a.example')
    invoke(channels.dispose, event, 'a')
    expect(mocks.controllers[0].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[2].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].dispose).not.toHaveBeenCalled()
    invoke(channels.dispose, event, 'a')
    invoke(channels.cancelRead, event, 'a', 'late-abort')
    invoke(channels.setView, event, 'a', { visible: false })
    expect(mocks.controllers).toHaveLength(3)
    event.sender.emit('destroyed')
    expect(mocks.controllers[0].dispose).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].dispose).toHaveBeenCalledOnce()
  })

  it('clears only the current page without clearing the shared website profile', async () => {
    const event = owner(1)
    invoke(channels.getState, event, 'a')
    invoke(channels.getState, event, 'b')
    await invoke(channels.clearData, event, 'a', 'page')
    expect(mocks.controllers[0].resetPage).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].resetPage).not.toHaveBeenCalled()
    expect(mocks.clearData).not.toHaveBeenCalled()
    await expect(invoke(channels.clearData, event, 'a', 'invalid')).rejects.toThrow('Unknown browser data scope')
  })

  it('resets pages in every window before clearing the shared profile and blocks new page loads until done', async () => {
    const event = owner(1)
    invoke(channels.getState, event, 'a')
    invoke(channels.getState, owner(2), 'b')
    let finish: (() => void) | undefined
    mocks.clearData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const clearing = invoke(channels.clearData, event, 'a', 'all')
    await Promise.resolve()
    expect(mocks.controllers.every((browser) => browser.resetPage.mock.calls.length === 1)).toBe(true)
    expect(mocks.clearData).toHaveBeenCalledOnce()
    expect(mocks.controllers[1].resetPage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearData.mock.invocationCallOrder[0]
    )
    expect(() => invoke(channels.navigate, event, 'a', 'https://example.com')).toThrow('being cleared')
    expect(() => invoke(channels.readPage, event, 'a', { requestId: 'blocked' })).toThrow('being cleared')
    const repeated = invoke(channels.clearData, event, 'a', 'all')
    finish?.()
    await Promise.all([clearing, repeated])
    expect(mocks.clearData).toHaveBeenCalledOnce()
    invoke(channels.navigate, event, 'a', 'https://example.com')
    expect(mocks.controllers[0].navigate).toHaveBeenCalledOnce()
  })

  it('allows retry after shared profile clearing fails', async () => {
    const event = owner(1)
    mocks.clearData.mockRejectedValueOnce(new Error('disk failure'))
    await expect(invoke(channels.clearData, event, 'a', 'all')).rejects.toThrow('disk failure')
    await invoke(channels.clearData, event, 'a', 'all')
    expect(mocks.clearData).toHaveBeenCalledTimes(2)
  })

  it('only shows the selected page and disposes pages on renderer reload or destruction', () => {
    const event = owner(1)
    invoke(channels.getState, event, 'a')
    invoke(channels.getState, event, 'b')
    const visible = { visible: true, bounds: { x: 1, y: 1, width: 300, height: 600 } }
    invoke(channels.setView, event, 'b', visible)
    expect(mocks.controllers[0].setView).toHaveBeenCalledWith(mocks.host, { visible: false })
    expect(mocks.controllers[1].setView).toHaveBeenCalledWith(mocks.host, visible)
    event.sender.emit('did-navigate')
    for (const controller of mocks.controllers) expect(controller.dispose).toHaveBeenCalledOnce()
    invoke(channels.getState, event, 'a')
    expect(mocks.controllers).toHaveLength(3)
    event.sender.emit('destroyed')
    expect(mocks.controllers[2].dispose).toHaveBeenCalledOnce()
  })
})
