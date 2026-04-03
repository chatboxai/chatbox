import { describe, expect, it, vi } from 'vitest'
import { createMessage } from '@shared/types'

const getImageMock = vi.fn()
const traceEndMock = vi.fn()
const traceStartRunMock = vi.fn(async () => ({
  runId: 'image-trace-run-1',
  end: traceEndMock,
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({
    storage: {
      getImage: getImageMock,
    },
  })),
}))

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: traceStartRunMock,
  },
}))

describe('generateImage tracing', () => {
  it('creates a root trace and passes correlated paint tracing to the model', async () => {
    const { generateImage } = await import('./generate-image')

    const message = createMessage('user', 'Make this cinematic')
    message.contentParts.push({
      type: 'image',
      storageKey: 'image-storage-key',
    })

    getImageMock.mockResolvedValue('data:image/png;base64,AAAA')
    const paintMock = vi.fn(async () => ['data:image/png;base64,BBBB'])

    const result = await generateImage(
      {
        name: 'Image Model',
        modelId: 'image-model-1',
        isSupportVision: () => true,
        isSupportToolUse: () => false,
        isSupportSystemMessage: () => true,
        chat: vi.fn(),
        chatStream: async function* () {},
        paint: paintMock,
      },
      {
        message,
        num: 1,
        sessionId: 'session-9',
        threadId: 'thread-4',
        messageId: 'message-3',
      }
    )

    expect(result).toEqual(['data:image/png;base64,BBBB'])
    expect(traceStartRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbox.image_generation.generate',
        runType: 'chain',
        inputs: expect.objectContaining({
          sessionId: 'session-9',
          threadId: 'thread-4',
          messageId: 'message-3',
          modelId: 'image-model-1',
          num: 1,
          referenceImageCount: 1,
        }),
        metadata: expect.objectContaining({
          session_id: 'session-9',
          thread_id: 'thread-4',
          conversation_id: 'thread-4',
          message_id: 'message-3',
        }),
      })
    )
    expect(paintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        traceContext: expect.objectContaining({
          parentRunId: 'image-trace-run-1',
          name: 'chatbox.image_generation.generate.paint',
          metadata: expect.objectContaining({
            session_id: 'session-9',
            thread_id: 'thread-4',
            conversation_id: 'thread-4',
            message_id: 'message-3',
          }),
        }),
      }),
      undefined,
      undefined
    )
    expect(traceEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: expect.objectContaining({
          imageCount: 1,
        }),
      })
    )
  })
})
