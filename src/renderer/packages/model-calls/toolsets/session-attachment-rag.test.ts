import { beforeEach, describe, expect, test, vi } from 'vitest'

const queryMock = vi.fn()
const getAttachmentsMock = vi.fn()
const readParentsMock = vi.fn()
const getSessionRagConfigMock = vi.fn()
const getLicenseKeyMock = vi.fn()
const getSettingsMock = vi.fn()

vi.mock('@/platform', () => ({
  default: {
    getSessionAttachmentRagController: () => ({
      getAttachments: getAttachmentsMock,
      query: queryMock,
      readParents: readParentsMock,
    }),
  },
}))

vi.mock('@/packages/remote', () => ({
  getSessionRagConfig: getSessionRagConfigMock,
}))

vi.mock('@/stores/settingActions', () => ({
  getLicenseKey: getLicenseKeyMock,
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: getSettingsMock,
  },
}))

async function toModelOutput(tool: unknown, output: unknown) {
  const mapper = tool as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown> | unknown
  }
  return await mapper.toModelOutput({ toolCallId: 'tool-call-id', input: {}, output })
}

describe('session attachment RAG toolset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAttachmentsMock.mockResolvedValue([
      {
        id: 1,
        filename: 'large.pdf',
        status: 'ready',
      },
    ])
    getLicenseKeyMock.mockReturnValue(undefined)
    getSessionRagConfigMock.mockResolvedValue(undefined)
    getSettingsMock.mockReturnValue({
      defaultRerankModel: {
        provider: 'cohere',
        model: 'rerank-v3.5',
      },
    })
    queryMock.mockResolvedValue([])
    readParentsMock.mockResolvedValue([])
  })

  test('uses local default rerank model when remote session RAG rerank model is unavailable', async () => {
    const { getToolSet } = await import('./session-attachment-rag')
    const toolset = await getToolSet([1])
    const executeQuery = toolset.tools.query_session_attachment.execute
    expect(executeQuery).toBeDefined()

    await executeQuery?.(
      { query: 'budget summary', limit: 3 },
      {
        toolCallId: 'call-1',
        messages: [],
      }
    )

    expect(queryMock).toHaveBeenCalledWith({
      attachmentIds: [1],
      query: 'budget summary',
      plan: {
        recallTopK: 20,
        finalTopK: 3,
        rerank: {
          enabled: true,
          model: 'cohere:rerank-v3.5',
        },
      },
    })
  })

  test('keeps direct whole-document reading available while retrieval indexing fails', async () => {
    getAttachmentsMock.mockResolvedValue([{ id: 1, filename: 'large.pdf', status: 'failed' }])
    const { getToolSet } = await import('./session-attachment-rag')
    const { description } = await getToolSet([1])
    expect(description).toContain('### Failed')
    expect(description).toContain('For focused questions about a ready indexed attachment')
    expect(description).toContain('read PARSED_SANDBOX_PATH sequentially')
    expect(description).toContain(
      'If indexing is pending or failed but a readable sandbox text path is available, use that path'
    )
    expect(description).toContain('If direct full-text access is unavailable')
    expect(description).not.toContain('use query_session_attachment before answering')
  })

  test('local default rerank model wins over remote session RAG rerank model', async () => {
    getSessionRagConfigMock.mockResolvedValue({
      capabilities: {
        session_attachment_rerank: true,
      },
      models: {
        rerank: 'chatbox-ai:rerank',
      },
    })

    const { getToolSet } = await import('./session-attachment-rag')
    const toolset = await getToolSet([1])
    const executeQuery = toolset.tools.query_session_attachment.execute
    expect(executeQuery).toBeDefined()

    await executeQuery?.(
      { query: 'budget summary' },
      {
        toolCallId: 'call-1',
        messages: [],
      }
    )

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          rerank: {
            enabled: true,
            model: 'cohere:rerank-v3.5',
          },
        }),
      })
    )
  })

  test('query_session_attachment maps search results to readable model text', async () => {
    const { getToolSet } = await import('./session-attachment-rag')
    const toolset = await getToolSet([1])

    await expect(
      toModelOutput(toolset.tools.query_session_attachment, [
        {
          filename: 'large.pdf',
          sectionPath: 'Section 2',
          parentId: 42,
          score: 0.81234,
          text: 'Relevant attachment text.',
        },
      ])
    ).resolves.toEqual({
      type: 'text',
      value:
        'Result 1\nAttachment: large.pdf\nSection: Section 2\nParent ID: 42\nScore: 0.812\nText:\nRelevant attachment text.',
    })
  })

  test('read_session_attachment_parents maps parent blocks to readable model text', async () => {
    const { getToolSet } = await import('./session-attachment-rag')
    const toolset = await getToolSet([1])

    await expect(
      toModelOutput(toolset.tools.read_session_attachment_parents, [
        {
          filename: 'large.pdf',
          sectionPath: 'Appendix',
          pageStart: 10,
          pageEnd: 12,
          text: 'Larger parent block.',
        },
      ])
    ).resolves.toEqual({
      type: 'text',
      value: 'Parent block 1\nAttachment: large.pdf\nSection: Appendix\nPages: 10-12\nText:\nLarger parent block.',
    })
  })
})
