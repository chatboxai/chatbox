import { describe, expect, it } from 'vitest'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { getConfigFromFormValues, getFormValuesFromConfig, type MCPServerConfigFormValues } from './utils'

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
  it('preserves environment variables with empty values across edits', () => {
    const initialConfig: MCPServerConfig = {
      id: 'server-1',
      name: 'Test server',
      enabled: true,
      transport: {
        type: 'stdio',
        command: 'server',
        args: [],
        env: {
          EMPTY: '',
          TOKEN: 'value',
        },
      },
    }

    expect(getConfigFromFormValues(getFormValuesFromConfig(initialConfig))).toEqual(initialConfig)
  })

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
      },
    }

    expect(getConfigFromFormValues(getFormValuesFromConfig(config))).toEqual(config)
  })
})
