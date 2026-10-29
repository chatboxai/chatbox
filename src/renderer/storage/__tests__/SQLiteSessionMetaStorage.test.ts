import type { SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SQLiteSessionMetaStorage } from '../SQLiteSessionMetaStorage'

const mockDatabase = vi.hoisted(() => ({
  open: vi.fn(),
  execute: vi.fn(),
  run: vi.fn(),
  executeSet: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
}))

const mockConnection = vi.hoisted(() => ({
  closeConnection: vi.fn(),
  createConnection: vi.fn(),
}))

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  // biome-ignore lint/complexity/useArrowFunction: SQLiteConnection is constructed with new.
  SQLiteConnection: vi.fn(function () {
    return mockConnection
  }),
}))

function makeRecord(overrides: Partial<SessionMetaRecord> & { id: string }): SessionMetaRecord {
  return {
    name: 'Test Session',
    type: 'chat',
    sortOrder: 100,
    createdAt: 100,
    ...overrides,
  }
}

describe('SQLiteSessionMetaStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnection.createConnection.mockResolvedValue(mockDatabase)
    mockDatabase.open.mockResolvedValue(undefined)
    mockDatabase.execute.mockResolvedValue({ changes: { changes: 0 } })
    mockDatabase.run.mockResolvedValue({ changes: { changes: 1 } })
    mockDatabase.executeSet.mockResolvedValue({ changes: { changes: 1 } })
    mockDatabase.query.mockResolvedValue({ values: [{ name: 'archived_at' }] })
  })

  it('iterates identities using bounded keyset reads without loading metadata payloads', async () => {
    const storage = new SQLiteSessionMetaStorage()
    await storage.initialize()
    const first = Array.from({ length: 128 }, (_, index) => ({ id: `id-${String(index).padStart(3, '0')}` }))
    mockDatabase.query.mockReset()
    mockDatabase.query
      .mockResolvedValueOnce({ values: first })
      .mockResolvedValueOnce({ values: [{ id: 'last' }] })
      .mockResolvedValueOnce({ values: [] })
    const ids: string[] = []
    for await (const id of storage.iterateIds()) ids.push(id)
    expect(ids).toEqual([...first.map((row) => row.id), 'last'])
    expect(mockDatabase.query.mock.calls.every(([sql]) => /^SELECT id FROM session_meta .*LIMIT 128$/.test(sql))).toBe(
      true
    )
    expect(mockDatabase.query.mock.calls.map(([, params]) => params)).toEqual([[], ['id-127'], ['last']])
  })

  it('createMany delegates batch writes to the Capacitor SQLite transaction API', async () => {
    const storage = new SQLiteSessionMetaStorage()
    const records = [makeRecord({ id: 'a' }), makeRecord({ id: 'b', starred: true })]

    await storage.createMany(records)

    expect(mockDatabase.executeSet).toHaveBeenCalledTimes(1)
    expect(mockDatabase.executeSet).toHaveBeenCalledWith(
      [
        {
          statement: expect.stringContaining('INSERT OR REPLACE INTO session_meta'),
          values: ['a', 'Test Session', null, 0, 0, null, null, null, null, 'chat', 100, 100, 0, 0],
        },
        {
          statement: expect.stringContaining('INSERT OR REPLACE INTO session_meta'),
          values: ['b', 'Test Session', null, 1, 0, null, null, null, null, 'chat', 100, 100, 0, 0],
        },
      ],
      true
    )
    expect(mockDatabase.run).not.toHaveBeenCalled()
  })

  it('createMany preserves the original write error instead of masking it with rollback failure', async () => {
    const storage = new SQLiteSessionMetaStorage()
    const originalError = new Error('insert failed')
    mockDatabase.executeSet.mockRejectedValueOnce(originalError)

    await expect(storage.createMany([makeRecord({ id: 'a' })])).rejects.toThrow('insert failed')

    expect(mockDatabase.run).not.toHaveBeenCalledWith('ROLLBACK')
  })

  it('deleteMany delegates batch deletes to the Capacitor SQLite transaction API', async () => {
    const storage = new SQLiteSessionMetaStorage()

    await storage.deleteMany(['a', 'b'])

    expect(mockDatabase.executeSet).toHaveBeenCalledTimes(1)
    expect(mockDatabase.executeSet).toHaveBeenCalledWith(
      [
        { statement: 'DELETE FROM session_meta WHERE id = ?', values: ['a'] },
        { statement: 'DELETE FROM session_meta WHERE id = ?', values: ['b'] },
      ],
      true
    )
    expect(mockDatabase.run).not.toHaveBeenCalled()
  })

  it('deleteMany preserves the original write error instead of masking it with rollback failure', async () => {
    const storage = new SQLiteSessionMetaStorage()
    const originalError = new Error('delete failed')
    mockDatabase.executeSet.mockRejectedValueOnce(originalError)

    await expect(storage.deleteMany(['a'])).rejects.toThrow('delete failed')

    expect(mockDatabase.run).not.toHaveBeenCalledWith('ROLLBACK')
  })

  it('adds optional session metadata columns for existing mobile databases', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query.mockResolvedValueOnce({ values: [{ name: 'id' }, { name: 'hidden' }] })

    await storage.initialize()

    expect(mockDatabase.execute).toHaveBeenCalledWith('ALTER TABLE session_meta ADD COLUMN archived_at INTEGER')
    expect(mockDatabase.execute).toHaveBeenCalledWith(
      'ALTER TABLE session_meta ADD COLUMN has_paused_tool_call INTEGER NOT NULL DEFAULT 0'
    )
    expect(mockDatabase.execute).toHaveBeenCalledWith(
      'ALTER TABLE session_meta ADD COLUMN recovery_archived INTEGER NOT NULL DEFAULT 0'
    )
    expect(mockDatabase.execute).toHaveBeenCalledWith('ALTER TABLE session_meta ADD COLUMN folder_id TEXT')
  })

  it('getPage orders rows by pin, folder order and sort order', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ name: 'archived_at' }, { name: 'folder_id' }] })
      .mockResolvedValueOnce({
        values: [{ id: 'filed', name: 'Filed', folder_id: 'f1', starred: 0, hidden: 0, sort_order: 1, created_at: 1 }],
      })
      .mockResolvedValueOnce({ values: [{ total: 1 }] })

    const page = await storage.getPage(0, 50, ['f1', 'f2'])

    expect(mockDatabase.query).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM session_meta WHERE hidden = 0 ORDER BY CASE WHEN starred = 1 THEN 0 WHEN folder_id = ? THEN 1 WHEN folder_id = ? THEN 2 ELSE 3 END, sort_order DESC LIMIT ? OFFSET ?',
      ['f1', 'f2', 50, 0]
    )
    expect(page.items[0]).toMatchObject({ id: 'filed', folderId: 'f1' })
  })

  it('create persists hasPausedToolCall as an integer column', async () => {
    const storage = new SQLiteSessionMetaStorage()

    await storage.create(makeRecord({ id: 'paused', hasPausedToolCall: true }))

    expect(mockDatabase.run).toHaveBeenCalledWith(expect.stringContaining('has_paused_tool_call'), [
      'paused',
      'Test Session',
      null,
      0,
      0,
      null,
      null,
      null,
      null,
      'chat',
      100,
      100,
      1,
      0,
    ])
  })

  it('persists and restores the recovery archive marker', async () => {
    const storage = new SQLiteSessionMetaStorage()

    await storage.create(makeRecord({ id: 'recovery', hidden: true, archivedAt: 100, recoveryArchived: true }))

    expect(mockDatabase.run).toHaveBeenCalledWith(expect.stringContaining('recovery_archived'), [
      'recovery',
      'Test Session',
      null,
      0,
      1,
      100,
      null,
      null,
      null,
      'chat',
      100,
      100,
      0,
      1,
    ])

    mockDatabase.query.mockResolvedValueOnce({
      values: [
        {
          id: 'recovery',
          name: 'Test Session',
          hidden: 1,
          archived_at: 100,
          recovery_archived: 1,
          sort_order: 100,
          created_at: 100,
        },
      ],
    })

    await expect(storage.getById('recovery')).resolves.toMatchObject({
      id: 'recovery',
      recoveryArchived: true,
    })
  })

  it('clears the recovery archive marker during a full metadata update', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query
      .mockResolvedValueOnce({
        values: [{ name: 'archived_at' }, { name: 'has_paused_tool_call' }, { name: 'recovery_archived' }],
      })
      .mockResolvedValueOnce({
        values: [
          {
            id: 'recovery',
            name: 'Test Session',
            hidden: 1,
            archived_at: 100,
            recovery_archived: 1,
            sort_order: 100,
            created_at: 100,
          },
        ],
      })

    await storage.update('recovery', { hidden: false, archivedAt: undefined, recoveryArchived: undefined })

    expect(mockDatabase.run).toHaveBeenLastCalledWith(expect.stringContaining('recovery_archived = ?'), [
      'Test Session',
      null,
      0,
      0,
      null,
      null,
      null,
      null,
      null,
      100,
      100,
      0,
      0,
      'recovery',
    ])
  })

  it('getById maps the persisted paused-tool-call column back onto the record', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ name: 'archived_at' }, { name: 'has_paused_tool_call' }] })
      .mockResolvedValueOnce({
        values: [
          {
            id: 'paused',
            name: 'Paused',
            starred: 0,
            hidden: 0,
            archived_at: null,
            type: 'chat',
            sort_order: 100,
            created_at: 100,
            has_paused_tool_call: 1,
          },
        ],
      })

    await expect(storage.getById('paused')).resolves.toMatchObject({
      id: 'paused',
      hasPausedToolCall: true,
    })
  })

  it('getArchivedPage queries archived rows with limit and offset', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ name: 'archived_at' }] })
      .mockResolvedValueOnce({
        values: [
          {
            id: 'archived',
            name: 'Archived',
            starred: 0,
            hidden: 1,
            archived_at: 2000,
            sort_order: 100,
            created_at: 100,
          },
        ],
      })
      .mockResolvedValueOnce({ values: [{ total: 3 }] })

    const page = await storage.getArchivedPage(2, 1)

    expect(mockDatabase.query).toHaveBeenCalledWith(
      'SELECT * FROM session_meta WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ? OFFSET ?',
      [1, 2]
    )
    expect(page.items.map((record) => record.id)).toEqual(['archived'])
    expect(page.nextCursor).toBeNull()
    expect(page.total).toBe(3)
  })

  it('getArchivedTotal counts archived rows directly', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ name: 'archived_at' }] })
      .mockResolvedValueOnce({ values: [{ total: 7 }] })

    await expect(storage.getArchivedTotal()).resolves.toBe(7)

    expect(mockDatabase.query).toHaveBeenLastCalledWith(
      'SELECT COUNT(*) as total FROM session_meta WHERE archived_at IS NOT NULL'
    )
  })

  it('getAllTotal counts all rows directly', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query
      .mockResolvedValueOnce({ values: [{ name: 'archived_at' }] })
      .mockResolvedValueOnce({ values: [{ total: 9 }] })

    await expect(storage.getAllTotal()).resolves.toBe(9)

    expect(mockDatabase.query).toHaveBeenLastCalledWith('SELECT COUNT(*) as total FROM session_meta')
  })
})
