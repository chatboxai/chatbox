import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockInvoke = vi.fn()
const mockExposeInMainWorld = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}))

describe('preload IPC allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  async function loadExposedHandler() {
    await import('./index')
    // exposeInMainWorld('electronAPI', electronHandler) — grab the handler object
    return mockExposeInMainWorld.mock.calls[0][1] as { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }
  }

  it('forwards allowlisted channels to ipcRenderer.invoke', async () => {
    mockInvoke.mockResolvedValue('ok')
    const electronHandler = await loadExposedHandler()

    const result = await electronHandler.invoke('getVersion')

    expect(result).toBe('ok')
    expect(mockInvoke).toHaveBeenCalledWith('getVersion')
  })

  it('forwards allowlisted channels with arguments', async () => {
    mockInvoke.mockResolvedValue({ success: true })
    const electronHandler = await loadExposedHandler()

    await electronHandler.invoke('fs:read', { filePath: '/some/path' })

    expect(mockInvoke).toHaveBeenCalledWith('fs:read', { filePath: '/some/path' })
  })

  it('rejects channels that are not on the allowlist instead of calling ipcRenderer.invoke', async () => {
    const electronHandler = await loadExposedHandler()

    await expect(electronHandler.invoke('some:made-up-channel')).rejects.toThrow(
      /not on the renderer allowlist/
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('rejects a disallowed channel even when it looks like a legitimate one', async () => {
    const electronHandler = await loadExposedHandler()

    // e.g. an attacker probing for handlers that exist in main but were
    // never meant to be renderer-invokable.
    await expect(electronHandler.invoke('getHostname')).rejects.toThrow(/not on the renderer allowlist/)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
