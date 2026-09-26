import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileSessionAttachmentRagController } from '../mobile-controller'

describe('MobileSessionAttachmentRagController', () => {
  let mockEngine: any
  let controller: MobileSessionAttachmentRagController

  beforeEach(() => {
    mockEngine = {
      createAttachment: vi.fn().mockResolvedValue({
        id: 1,
        filename: 'report.pdf',
        status: 'pending',
        indexStatus: 'pending',
        availability: 'allowed',
        chunkCount: 0,
      }),
      getAttachments: vi.fn().mockResolvedValue([
        {
          id: 1,
          filename: 'report.pdf',
          status: 'ready',
          indexStatus: 'ready',
          availability: 'allowed',
          chunkCount: 10,
        },
      ]),
      retryAttachment: vi.fn().mockResolvedValue(undefined),
      rebindAttachment: vi.fn().mockResolvedValue(undefined),
      deleteAttachment: vi.fn().mockResolvedValue(undefined),
      deleteMessageAttachments: vi.fn().mockResolvedValue([1]),
      deleteSessionAttachments: vi.fn().mockResolvedValue([1]),
      cleanupOrphans: vi.fn().mockResolvedValue([]),
      getDebugSnapshot: vi.fn().mockResolvedValue({
        dbPath: 'chatbox-session-rag',
        attachmentCount: 1,
      }),
      clearAll: vi.fn().mockResolvedValue(1),
      runMaintenance: vi.fn().mockResolvedValue({
        interruptedFailedCount: 2,
        canceledPurgedCount: 0,
        orphanDeletedIds: [],
      }),
      query: vi.fn().mockResolvedValue([
        {
          attachmentId: 1,
          parentId: 10,
          filename: 'report.pdf',
          chunkOrder: 0,
          text: 'Matched text',
          score: 0.95,
        },
      ]),
      readParents: vi.fn().mockResolvedValue([
        {
          id: 10,
          attachmentId: 1,
          filename: 'report.pdf',
          text: 'Full parent context',
          tokenEstimate: 50,
          charCount: 200,
        },
      ]),
    }

    controller = new MobileSessionAttachmentRagController(mockEngine)
  })

  it('delegates create to engine', async () => {
    const attachment = await controller.create({
      sessionId: 'sess_1',
      messageId: 'msg_1',
      attachmentStorageKey: 'key_1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: 1000,
      tokenEstimate: 200,
    })

    expect(attachment.id).toBe(1)
    expect(mockEngine.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'report.pdf' })
    )
  })

  it('delegates query and readParents to engine', async () => {
    const results = await controller.query({
      attachmentIds: [1],
      query: 'revenue in Q3',
      plan: { recallTopK: 20, finalTopK: 8 },
    })

    expect(results).toHaveLength(1)
    expect(results[0].score).toBe(0.95)
    expect(mockEngine.query).toHaveBeenCalledWith({
      attachmentIds: [1],
      query: 'revenue in Q3',
      plan: { recallTopK: 20, finalTopK: 8 },
    })

    const parents = await controller.readParents({
      parentIds: [10],
      attachmentIds: [1],
    })

    expect(parents).toHaveLength(1)
    expect(parents[0].text).toBe('Full parent context')
    expect(mockEngine.readParents).toHaveBeenCalledWith({
      parentIds: [10],
      attachmentIds: [1],
    })
  })

  it('delegates lifecycle, maintenance, and cleanup actions', async () => {
    await controller.retryAttachment(1)
    expect(mockEngine.retryAttachment).toHaveBeenCalledWith(1)

    await controller.deleteAttachment(1)
    expect(mockEngine.deleteAttachment).toHaveBeenCalledWith(1)

    await controller.deleteMessageAttachments('msg_1')
    expect(mockEngine.deleteMessageAttachments).toHaveBeenCalledWith('msg_1')

    await controller.deleteSessionAttachments('sess_1')
    expect(mockEngine.deleteSessionAttachments).toHaveBeenCalledWith('sess_1')

    const snapshot = await controller.getDebugSnapshot()
    expect(snapshot.attachmentCount).toBe(1)

    const maint = await controller.runMaintenance({ sessionIds: ['s1'], messageIds: ['m1'] })
    expect(maint.interruptedFailedCount).toBe(2)

    const cleared = await controller.clearAll()
    expect(cleared).toBe(1)
  })
})
