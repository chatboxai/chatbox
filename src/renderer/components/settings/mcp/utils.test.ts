import { describe, expect, it } from 'vitest'
import type { MCPServerConfig } from '@/packages/mcp/types'
import {
  getConfigFromFormValues,
  getFormValuesFromConfig,
  type MCPServerConfigFormValues,
  parseServerFromJson,
  parseServersFromJson,
} from './utils'

function createFormValues(command: string): MCPServerConfigFormValues {
  return {
    id: 'server-1',
    name: 'Test server',
    enabled: true,
    transport: {
      type: 'stdio',
      command,
    },
  }
}

describe('MCP stdio command form conversion', () => {
  it('preserves a quoted Windows path across repeated edits', () => {
    const initialValues = createFormValues(String.raw`uv --directory "C:\\path\\to\\" run xx.py`)
    const initialConfig = getConfigFromFormValues(initialValues)

    expect(initialConfig.transport).toEqual({
      type: 'stdio',
      command: 'uv',
      args: ['--directory', 'C:\\path\\to\\', 'run', 'xx.py'],
      env: undefined,
    })

    const reopenedValues = getFormValuesFromConfig(initialConfig)
    const resavedConfig = getConfigFromFormValues(reopenedValues)
    const reopenedAgainValues = getFormValuesFromConfig(resavedConfig)

    expect(resavedConfig).toEqual(initialConfig)
    expect(reopenedAgainValues).toEqual(reopenedValues)
  })

  it('quotes the executable and arguments when rebuilding a command line', () => {
    const config: MCPServerConfig = {
      id: 'server-1',
      name: 'Test server',
      enabled: true,
      protocolMode: 'legacy',
      transport: {
        type: 'stdio',
        command: String.raw`C:\Program Files\MCP\server.exe`,
        args: [
          '--directory',
          'C:\\path\\to\\',
          '--label',
          'My Server',
          '--config',
          String.raw`C:\Users\Test User\mcp.json`,
          `single'quote`,
          '',
        ],
        env: undefined,
      },
    }

    expect(getConfigFromFormValues(getFormValuesFromConfig(config))).toEqual(config)
  })

  it.each(['auto', 'legacy'] as const)('preserves %s protocol mode across repeated edits', (protocolMode) => {
    const config: MCPServerConfig = {
      id: 'server-1',
      name: 'Test server',
      enabled: true,
      protocolMode,
      transport: { type: 'http', url: 'https://example.com/mcp' },
    }

    expect(getConfigFromFormValues(getFormValuesFromConfig(config))).toEqual(config)
  })

  it('shows existing configurations without a protocol mode as legacy', () => {
    const config: MCPServerConfig = {
      id: 'server-1',
      name: 'Test server',
      enabled: true,
      transport: { type: 'http', url: 'https://example.com/mcp' },
    }

    expect(getFormValuesFromConfig(config).protocolMode).toBe('legacy')
  })

  it('marks single-server and bulk JSON imports as automatic protocol mode', () => {
    const single = parseServerFromJson(JSON.stringify({ name: 'Remote MCP', url: 'https://example.com/mcp' }))
    const bulk = parseServersFromJson(
      JSON.stringify({
        mcpServers: {
          local: { command: 'npx', args: ['-y', 'example-mcp'] },
        },
      })
    )

    expect(single?.protocolMode).toBe('auto')
    expect(bulk[0]?.protocolMode).toBe('auto')
  })
})
