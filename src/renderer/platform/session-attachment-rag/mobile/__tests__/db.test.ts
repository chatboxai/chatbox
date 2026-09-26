import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileRagDatabase } from '../db'

describe('MobileRagDatabase', () => {
  let mockDb: any
  let db: MobileRagDatabase

  beforeEach(() => {
    mockDb = {
      execute: vi.fn().mockResolvedValue({ changes: { changes: 1 } }),
      run: vi.fn().mockResolvedValue({ changes: { changes: 1, lastId: 1 } }),
      query: vi.fn().mockResolvedValue({ values: [] }),
    }
    db = new MobileRagDatabase()
    db.setMockDatabase(mockDb)
  })

  it('cleanupInterruptedIndexingAttachments updates indexing jobs to failed', async () => {
    mockDb.query.mockResolvedValueOnce({
      values: [{ id: 101 }, { id: 102 }],
    })

    const count = await db.cleanupInterruptedIndexingAttachments()
    expect(count).toBe(2)
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE session_attachments SET status = 'failed'")
    )
  })

  it('runMaintenance runs cleanupInterruptedIndexingAttachments and returns count', async () => {
    mockDb.query
      .mockResolvedValueOnce({ values: [{ id: 5 }] }) // interrupted query
      .mockResolvedValueOnce({ values: [] }) // orphan query

    const result = await db.runMaintenance({ sessionIds: ['s1'], messageIds: ['m1'] })
    expect(result.interruptedFailedCount).toBe(1)
    expect(result.orphanDeletedIds).toEqual([])
  })

  it('creates attachment and retrieves it', async () => {
    mockDb.run.mockResolvedValueOnce({ changes: { changes: 1, lastId: 10 } })
    const created = await db.createAttachment({
      sessionId: 'sess_1',
      messageId: 'msg_1',
      attachmentStorageKey: 'key_1',
      filename: 'doc.txt',
      fileSize: 500,
      tokenEstimate: 120,
    })

    expect(created.id).toBe(10)
    expect(created.status).toBe('pending')

    mockDb.query.mockResolvedValueOnce({
      values: [
        {
          id: 10,
          session_id: 'sess_1',
          message_id: 'msg_1',
          filename: 'doc.txt',
          status: 'ready',
          total_chunks: 5,
          created_at: Date.now(),
        },
      ],
    })

    const fetched = await db.getAttachments([10])
    expect(fetched).toHaveLength(1)
    expect(fetched[0].status).toBe('ready')
    expect(fetched[0].chunkCount).toBe(5)
  })
})
