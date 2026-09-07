import { ApiError } from '@shared/models/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureExceptionMock = vi.fn()
const setTagMock = vi.fn()

vi.mock('@sentry/react', () => ({
  withScope: (callback: (scope: { setTag: (key: string, value: string) => void }) => void) =>
    callback({ setTag: setTagMock }),
  captureException: (error: unknown) => captureExceptionMock(error),
}))

import { captureAgentModeException } from './agent-mode'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('captureAgentModeException', () => {
  it('skips expected provider errors', () => {
    captureAgentModeException(new ApiError('rate limited'), { operation: 'suggestion' })
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('captures unexpected errors with tags', () => {
    const error = new Error('boom')
    captureAgentModeException(error, {
      operation: 'generation',
      provider: 'openai',
      model: 'gpt-4o',
      agentMode: 'on',
      fullAccess: true,
    })
    expect(captureExceptionMock).toHaveBeenCalledWith(error)
    expect(setTagMock).toHaveBeenCalledWith('component', 'agent-mode')
    expect(setTagMock).toHaveBeenCalledWith('provider', 'openai')
    expect(setTagMock).toHaveBeenCalledWith('model', 'gpt-4o')
    expect(setTagMock).toHaveBeenCalledWith('full_access', 'true')
  })

  it('wraps non-Error values without forwarding their content', () => {
    captureAgentModeException('string failure', { operation: 'tool_retry' })
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const captured = captureExceptionMock.mock.calls[0][0]
    expect(captured).toBeInstanceOf(Error)
    expect(captured.message).toBe('Non-Error exception (string)')
  })

  it('sanitizes custom-provider identifiers and drops user-typed model ids', () => {
    captureAgentModeException(new Error('boom'), {
      operation: 'generation',
      provider: 'custom-provider-3f1c9a2e',
      model: 'my-private-model',
    })
    expect(setTagMock).toHaveBeenCalledWith('provider', 'custom')
    expect(setTagMock).not.toHaveBeenCalledWith('model', expect.anything())
  })

  it('strips user-entered MCP server names from tool_name tags', () => {
    captureAgentModeException(new Error('boom'), {
      operation: 'tool_pause_continue',
      toolName: 'mcp__my_company_server__search_docs',
    })
    expect(setTagMock).toHaveBeenCalledWith('tool_name', 'mcp__search_docs')
  })

  it('keeps builtin tool names as-is', () => {
    captureAgentModeException(new Error('boom'), {
      operation: 'tool_retry',
      toolName: 'write_file',
    })
    expect(setTagMock).toHaveBeenCalledWith('tool_name', 'write_file')
  })
})
