import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createRunMock, updateRunMock, clientConstructorMock } = vi.hoisted(() => ({
  createRunMock: vi.fn(),
  updateRunMock: vi.fn(),
  clientConstructorMock: vi.fn(),
}))

vi.mock('langsmith', () => ({
  Client: vi.fn(function MockLangSmithClient(config: unknown) {
    clientConstructorMock(config)
    return {
      createRun: createRunMock,
      updateRun: updateRunMock,
    }
  }),
}))

const originalEnv = { ...process.env }

describe('LangSmith web bridge server helpers', () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    createRunMock.mockReset()
    updateRunMock.mockReset()
    clientConstructorMock.mockReset()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('returns a disabled response when tracing is not configured for the web bridge', async () => {
    process.env.LANGSMITH_TRACING = 'true'
    delete process.env.LANGSMITH_API_KEY

    const { startLangSmithWebRun } = await import('../../../api/langsmith/_shared')
    const result = await startLangSmithWebRun({
      name: 'chatbox.web.chat',
    })

    expect(result).toEqual({
      enabled: false,
      projectName: 'chatbox-chatbridge',
      reason: 'missing-api-key',
      runId: null,
    })
    expect(createRunMock).not.toHaveBeenCalled()
  })

  it('creates and updates LangSmith runs with sanitized correlation metadata', async () => {
    process.env.LANGSMITH_TRACING = 'true'
    process.env.LANGSMITH_API_KEY = 'test-key'
    process.env.LANGSMITH_PROJECT = 'chatbox-web'
    process.env.LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com'
    process.env.LANGSMITH_WORKSPACE_ID = 'workspace-1'

    const webRunId = '00000000-0000-4000-8000-000000000001'
    const randomIdSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(webRunId)

    const { recordLangSmithWebEvent } = await import('../../../api/langsmith/_shared')
    const result = await recordLangSmithWebEvent({
      name: 'chatbox.web.chat',
      runType: 'chain',
      parentRunId: 'parent-run-1',
      inputs: {
        prompt: 'hello world',
        apiKey: 'secret-key',
      },
      outputs: {
        image: 'data:image/png;base64,AAAA',
      },
      metadata: {
        session_id: 'session-1',
        thread_id: 'thread-1',
        message_id: 'message-1',
        authorization: 'Bearer secret',
      },
      tags: ['chatbox', 'web'],
      error: 'boom',
    })

    expect(result).toEqual({
      enabled: true,
      projectName: 'chatbox-web',
      reason: 'enabled',
      runId: webRunId,
    })
    expect(clientConstructorMock).toHaveBeenCalledWith({
      apiKey: 'test-key',
      apiUrl: 'https://api.smith.langchain.com',
      workspaceId: 'workspace-1',
      autoBatchTracing: false,
      tracingSamplingRate: 1,
    })
    expect(createRunMock).toHaveBeenCalledTimes(1)
    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: webRunId,
        name: 'chatbox.web.chat',
        run_type: 'chain',
        parent_run_id: 'parent-run-1',
        project_name: 'chatbox-web',
        inputs: {
          prompt: 'hello world',
          apiKey: '[redacted]',
        },
        tags: ['chatbox', 'web'],
        extra: {
          metadata: {
            session_id: 'session-1',
            thread_id: 'thread-1',
            message_id: 'message-1',
            authorization: '[redacted]',
          },
        },
      })
    )
    expect(updateRunMock).toHaveBeenCalledTimes(1)
    expect(updateRunMock).toHaveBeenCalledWith(
      webRunId,
      expect.objectContaining({
        outputs: {
          image: '[redacted-data-url]',
        },
        error: 'boom',
        extra: {
          metadata: {
            session_id: 'session-1',
            thread_id: 'thread-1',
            message_id: 'message-1',
            authorization: '[redacted]',
          },
        },
      })
    )

    randomIdSpy.mockRestore()
  })
})
