import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileRagDatabase } from '../db'

describe('MobileRagDatabase', () => {
  let mockDatabase: any
  let mockConnection: any
  let ragDb: MobileRagDatabase

  beforeEach(() => {
    mockDatabase = {
      open: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
      run: vi.fn().mockResolvedValue({ changes: { changes: 1, lastId: 1 } }),
      executeSet: vi.fn().mockResolvedValue({ changes: { changes: 1 } }),
      query: vi.fn().mockResolvedValue({ values: [] }),
    }
    mockConnection = {
      closeConnection: vi.fn(),
      createConnection: vi.fn().mockResolvedValue(mockDatabase),
    }
    ragDb = new MobileRagDatabase(mockConnection)
  })

  it('initializes schema and tables', async () => {
    await ragDb.initialize()
    expect(mockConnection.createConnection).toHaveBeenCalledWith(
      'chatbox-session-rag',
      false,
      'no-encryption',
      1,
      false
    )
    expect(mockDatabase.open).toHaveBeenCalled()
    expect(mockDatabase.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS session_attachment'))
    expect(mockDatabase.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS session_attachment_parent'))
    expect(mockDatabase.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS session_attachment_chunk'))
    expect(mockDatabase.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS session_attachment_vector'))
  })

  it('creates attachment and returns new id', async () => {
    mockDatabase.run.mockResolvedValueOnce({ changes: { lastId: 42 } })
    const id = await ragDb.createAttachment({
      sessionId: 'sess_1',
      messageId: 'msg_1',
      attachmentStorageKey: 'key_1',
      filename: 'book.txt',
      mimeType: 'text/plain',
      fileSize: 1024,
      tokenEstimate: 256,
      parserType: 'local',
    })

    expect(id).toBe(42)
    expect(mockDatabase.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO session_attachment'),
      expect.arrayContaining(['sess_1', 'msg_1', 'key_1', 'book.txt', 'text/plain', 1024, 256, 'local'])
    )
  })

  it('updates attachment progress and status', async () => {
    await ragDb.updateAttachmentProgress(42, {
      indexingStage: 'embedding',
      totalChunks: 100,
      embeddedChunks: 50,
      embeddingModel: 'openai:text-embedding-3-small',
      embeddingDimension: 1536,
    })

    expect(mockDatabase.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE session_attachment SET indexing_stage = ?, total_chunks = ?, embedded_chunks = ?, embedding_model = ?, embedding_dimension = ? WHERE id = ?'),
      ['embedding', 100, 50, 'openai:text-embedding-3-small', 1536, 42]
    )

    await ragDb.markAttachmentStatus(42, 'ready')
    expect(mockDatabase.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE session_attachment SET status = ?, indexing_stage = ?, completed_at = ? WHERE id = ?'),
      expect.arrayContaining(['ready', 'ready', 42])
    )
  })

  it('replaces parents and chunks in atomic batch', async () => {
    mockDatabase.run.mockImplementation(async (sql: string) => {
      if (sql.includes('session_attachment_parent')) {
        return { changes: { lastId: 10 } }
      }
      if (sql.includes('session_attachment_chunk')) {
        return { changes: { lastId: 100 } }
      }
      return { changes: { changes: 1 } }
    })

    const parents = [
      { parentOrder: 0, sectionPath: 'Ch1', text: 'Parent text', tokenEstimate: 50, charCount: 200 },
    ]
    const children = [
      { parentOrder: 0, chunkOrder: 0, sectionPath: 'Ch1', rawText: 'Chunk text', embeddedText: '[book] Chunk text', tokenEstimate: 25 },
    ]

    const chunkIds = await ragDb.replaceParentsAndChunks(42, parents, children)
    expect(chunkIds).toEqual([100])
    expect(mockDatabase.executeSet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ statement: 'DELETE FROM session_attachment_vector WHERE attachment_id = ?' }),
        expect.objectContaining({ statement: 'DELETE FROM session_attachment_chunk WHERE attachment_id = ?' }),
        expect.objectContaining({ statement: 'DELETE FROM session_attachment_parent WHERE attachment_id = ?' }),
      ])
    )
  })

  it('reads parents with session isolation checking', async () => {
    mockDatabase.query.mockResolvedValueOnce({
      values: [
        {
          id: 1,
          attachment_id: 42,
          parent_order: 0,
          section_path: 'Intro',
          text: 'Full parent section content',
          token_estimate: 100,
          char_count: 400,
          filename: 'notes.md',
        },
      ],
    })

    const parents = await ragDb.readParents([1], [42])
    expect(parents).toHaveLength(1)
    expect(parents[0].id).toBe(1)
    expect(parents[0].attachmentId).toBe(42)
    expect(parents[0].text).toBe('Full parent section content')
    expect(parents[0].filename).toBe('notes.md')
  })

  it('deletes attachment and all associated records', async () => {
    await ragDb.deleteAttachment(42)
    expect(mockDatabase.executeSet).toHaveBeenCalledWith([
      { statement: 'DELETE FROM session_attachment_vector WHERE attachment_id = ?', values: [42] },
      { statement: 'DELETE FROM session_attachment_chunk WHERE attachment_id = ?', values: [42] },
      { statement: 'DELETE FROM session_attachment_parent WHERE attachment_id = ?', values: [42] },
      { statement: 'DELETE FROM session_attachment WHERE id = ?', values: [42] },
    ])
  })

  it('returns accurate debug snapshot', async () => {
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ cnt: 3 }] }) // attachmentCount
      .mockResolvedValueOnce({ values: [{ cnt: 12 }] }) // parentCount
      .mockResolvedValueOnce({ values: [{ cnt: 45 }] }) // chunkCount
      .mockResolvedValueOnce({ values: [{ pending: 1, indexing: 0, ready: 2, failed: 0 }] }) // statusCounts
      .mockResolvedValueOnce({
        values: [
          {
            id: 1,
            session_id: 's1',
            message_id: 'm1',
            attachment_storage_key: 'k1',
            filename: 'f1.txt',
            mime_type: 'text/plain',
            file_size: 100,
            token_estimate: 25,
            status: 'ready',
            total_chunks: 10,
            embedded_chunks: 10,
          },
        ],
      }) // recentAttachments

    const snapshot = await ragDb.getDebugSnapshot()
    expect(snapshot.attachmentCount).toBe(3)
    expect(snapshot.parentCount).toBe(12)
    expect(snapshot.chunkCount).toBe(45)
    expect(snapshot.statusCounts.ready).toBe(2)
    expect(snapshot.statusCounts.pending).toBe(1)
    expect(snapshot.recentAttachments).toHaveLength(1)
    expect(snapshot.recentAttachments[0].filename).toBe('f1.txt')
  })
})
