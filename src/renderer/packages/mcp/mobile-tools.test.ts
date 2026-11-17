import type { Settings } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { type MCPServer, mcpController } from './controller'
import { prepareMobileMCPTools } from './mobile-tools'

vi.mock('./builtin', () => ({ getBuiltinServerConfig: vi.fn() }))
vi.mock('./controller', () => ({
  mcpController: { startServer: vi.fn(), getServer: vi.fn(), getAvailableTools: vi.fn() },
}))
const settings: Pick<Settings, 'mcp' | 'licenseKey'> = {
  licenseKey: '',
  mcp: {
    enabledBuiltinServers: [],
    servers: [
      { id: 'remote', name: 'Remote', enabled: true, transport: { type: 'http', url: 'https://example.com' } },
      { id: 'disabled', name: 'Disabled', enabled: false, transport: { type: 'http', url: 'https://example.com' } },
      { id: 'local', name: 'Local', enabled: true, transport: { type: 'stdio', command: 'npx', args: [] } },
    ],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mcpController.getServer).mockReset()
  vi.mocked(mcpController.startServer).mockResolvedValue()
  vi.mocked(mcpController.getAvailableTools).mockReturnValue({})
})

describe('mobile MCP tool preparation', () => {
  test.each([
    [false, true],
    [true, false],
  ])('requires Work Mode=%s and model tool support=%s', async (enabled, supported) => {
    const result = await prepareMobileMCPTools({
      enabled,
      model: { isSupportToolUse: () => supported },
      settings,
      signal: new AbortController().signal,
    })
    expect(result.tools).toEqual({})
    expect(mcpController.startServer).not.toHaveBeenCalled()
  })
  test('prepares enabled HTTP services and reports unavailable ones', async () => {
    const result = await prepareMobileMCPTools({
      enabled: true,
      model: { isSupportToolUse: () => true },
      settings,
      signal: new AbortController().signal,
    })
    expect(mcpController.startServer).toHaveBeenCalledTimes(1)
    expect(mcpController.startServer).toHaveBeenCalledWith(
      settings.mcp.servers[0],
      expect.objectContaining({ interactive: false })
    )
    expect(result.unavailable).toEqual(['Remote', 'Local'])
    expect(mcpController.getAvailableTools).toHaveBeenCalledWith(new Set())
  })
  test('does not connect after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      prepareMobileMCPTools({
        enabled: true,
        model: { isSupportToolUse: () => true },
        settings,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mcpController.startServer).not.toHaveBeenCalled()
  })

  test('returns only connected tools from the enabled configuration snapshot', async () => {
    vi.mocked(mcpController.getServer).mockReturnValue({ status: { state: 'running' } } as MCPServer)
    const tools = { mcp__remote__echo: { description: 'echo', inputSchema: z.object({}) } }
    vi.mocked(mcpController.getAvailableTools).mockReturnValue(tools)
    const result = await prepareMobileMCPTools({
      enabled: true,
      model: { isSupportToolUse: () => true },
      settings,
      signal: new AbortController().signal,
    })
    expect(result.tools).toBe(tools)
    expect(result.unavailable).toEqual(['Local'])
    expect(mcpController.getAvailableTools).toHaveBeenCalledWith(new Set(['remote']))
  })
})
