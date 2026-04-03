import { afterEach, describe, expect, it, vi } from 'vitest'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

function restoreGlobalProperty(
  name: 'window' | 'fetch',
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
    return
  }

  Reflect.deleteProperty(globalThis, name)
}

describe('RendererLangSmithAdapter', () => {
  afterEach(() => {
    restoreGlobalProperty('window', originalWindowDescriptor)
    restoreGlobalProperty('fetch', originalFetchDescriptor)
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('recomputes availability when the Electron IPC bridge appears after adapter construction', async () => {
    vi.doMock('../variables', () => ({
      CHATBOX_BUILD_PLATFORM: 'unknown',
    }))

    const { RendererLangSmithAdapter } = await import('./langsmith')
    const adapter = new RendererLangSmithAdapter()

    expect(adapter.enabled).toBe(false)

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'langsmith:start-run') {
        return { runId: 'trace-run-1' }
      }

      return true
    })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          invoke,
        },
      },
    })

    expect(adapter.enabled).toBe(true)

    const run = await adapter.startRun({
      name: 'chatbox.session.generate',
    })
    await run.end({
      outputs: {
        status: 'ok',
      },
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'langsmith:start-run', {
      name: 'chatbox.session.generate',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'langsmith:end-run', {
      runId: 'trace-run-1',
      result: {
        outputs: {
          status: 'ok',
        },
      },
    })
  })

  it('uses the web LangSmith bridge for browser builds', async () => {
    vi.doMock('../variables', () => ({
      CHATBOX_BUILD_PLATFORM: 'web',
    }))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          reason: 'enabled',
          projectName: 'chatbox-chatbridge',
          runId: 'web-run-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          reason: 'enabled',
          projectName: 'chatbox-chatbridge',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          reason: 'enabled',
          projectName: 'chatbox-chatbridge',
          runId: 'web-event-1',
        }),
      })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    })

    const { RendererLangSmithAdapter } = await import('./langsmith')
    const adapter = new RendererLangSmithAdapter()

    expect(adapter.enabled).toBe(true)

    const run = await adapter.startRun({
      name: 'chatbox.session.generate',
      metadata: {
        session_id: 'session-1',
      },
    })
    await run.end({
      outputs: {
        status: 'ok',
      },
    })
    await adapter.recordEvent({
      name: 'chatbox.session.generate.event',
      outputs: {
        status: 'ok',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/langsmith/start-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'chatbox.session.generate',
        metadata: {
          session_id: 'session-1',
        },
      }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/langsmith/end-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId: 'web-run-1',
        result: {
          outputs: {
            status: 'ok',
          },
        },
      }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/langsmith/record-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'chatbox.session.generate.event',
        outputs: {
          status: 'ok',
        },
      }),
    })
  })
})
