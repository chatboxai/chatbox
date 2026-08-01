import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (
  event: { sender: { send: ReturnType<typeof vi.fn> } },
  serverParams: { command: string; args?: string[]; env?: Record<string, string> }
) => Promise<string>

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  class MockStdioClientTransport {
    stderr = {
      addListener: vi.fn(),
      removeAllListeners: vi.fn(),
    }
    onclose?: () => void
    onerror?: (error: Error) => void
    onmessage?: (message: unknown) => void

    async close() {}
    async send() {}
    async start() {}
  }

  return { handlers, logger, MockStdioClientTransport }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../util', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('./shell-env', () => ({
  shellEnv: vi.fn(async () => ({})),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mocks.MockStdioClientTransport,
}))

const { closeAllTransports } = await import('./ipc-stdio-transport')

describe('stdio transport IPC', () => {
  afterEach(() => {
    closeAllTransports()
    mocks.logger.info.mockClear()
  })

  it('does not log stdio transport configuration', async () => {
    const secret = 'do-not-log-this-token'
    const createTransport = mocks.handlers.get('mcp:stdio-transport:create')
    expect(createTransport).toBeDefined()

    await createTransport?.(
      { sender: { send: vi.fn() } },
      {
        command: 'node',
        args: ['--api-key', secret],
        env: { MCP_TOKEN: secret },
      }
    )

    expect(mocks.logger.info).toHaveBeenCalledWith('create stdio transport')
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(secret)
  })
})
