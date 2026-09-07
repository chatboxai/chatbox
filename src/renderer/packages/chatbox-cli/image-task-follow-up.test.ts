import type { ImageGeneration } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queueBackgroundTaskNotificationMock, resumeGenerationMock } = vi.hoisted(() => ({
  queueBackgroundTaskNotificationMock: vi.fn(),
  resumeGenerationMock: vi.fn(),
}))

vi.mock('@/stores/imageGenerationActions', () => ({
  resumeGeneration: resumeGenerationMock,
}))

vi.mock('./background-follow-up', () => ({
  queueBackgroundTaskNotification: queueBackgroundTaskNotificationMock,
}))

import { queueImageTaskCompletion, resumeImageGenerationWithFollowUp } from './image-task-follow-up'

function imageRecord(overrides: Partial<ImageGeneration> = {}): ImageGeneration {
  return {
    id: 'record-1',
    prompt: 'red fox',
    referenceImages: [],
    generatedImages: ['https://example.com/red-fox.png'],
    createdAt: 1_000,
    model: { provider: 'chatbox-ai', modelId: 'manifest-image' },
    status: 'done',
    ...overrides,
  }
}

describe('image task follow-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reconnects a resumed CLI image record to its persisted conversation origin', async () => {
    const record = imageRecord({
      source: {
        type: 'chatbox_cli',
        sessionId: 'session-persisted',
        toolCallId: 'tool-persisted',
      },
    })
    resumeGenerationMock.mockResolvedValueOnce(record)

    await expect(
      resumeImageGenerationWithFollowUp('record-1', {
        sessionId: 'session-fallback',
        toolCallId: 'tool-fallback',
      })
    ).resolves.toBe(record)

    expect(queueBackgroundTaskNotificationMock).toHaveBeenCalledWith(
      'session-persisted',
      'tool-persisted',
      expect.objectContaining({
        id: 'image-generation:record-1:done',
        status: 'completed',
        recordId: 'record-1',
        summary: expect.stringContaining('do not show the images again'),
      })
    )
  })

  it('uses the original chat as a fallback for records created before source metadata existed', async () => {
    const record = imageRecord()
    resumeGenerationMock.mockResolvedValueOnce(record)

    await resumeImageGenerationWithFollowUp('record-1', {
      sessionId: 'session-legacy',
      toolCallId: 'tool-legacy',
    })

    expect(queueBackgroundTaskNotificationMock).toHaveBeenCalledWith(
      'session-legacy',
      'tool-legacy',
      expect.objectContaining({ id: 'image-generation:record-1:done' })
    )
  })

  it('does not queue a follow-up when an interrupted resume returns no terminal record', async () => {
    resumeGenerationMock.mockResolvedValueOnce(null)

    await resumeImageGenerationWithFollowUp('record-1', {
      sessionId: 'session-1',
      toolCallId: 'tool-1',
    })

    expect(queueBackgroundTaskNotificationMock).not.toHaveBeenCalled()
  })

  it('queues a failed follow-up for a terminal error record', () => {
    queueImageTaskCompletion(
      imageRecord({
        status: 'error',
        generatedImages: [],
        error: 'provider failed',
      }),
      { sessionId: 'session-1', toolCallId: 'tool-1' }
    )

    expect(queueBackgroundTaskNotificationMock).toHaveBeenCalledWith(
      'session-1',
      'tool-1',
      expect.objectContaining({
        id: 'image-generation:record-1:error',
        status: 'failed',
        summary: 'Image generation failed: provider failed',
      })
    )
  })
})
