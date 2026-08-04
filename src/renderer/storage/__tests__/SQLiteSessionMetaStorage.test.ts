import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionMetaRecord } from '@shared/types'
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

  it('createMany delegates batch writes to the Capacitor SQLite transaction API', async () => {
    const storage = new SQLiteSessionMetaStorage()
    const records = [makeRecord({ id: 'a' }), makeRecord({ id: 'b', starred: true })]

    await storage.createMany(records)

    expect(mockDatabase.executeSet).toHaveBeenCalledTimes(1)
    expect(mockDatabase.executeSet).toHaveBeenCalledWith(
      [
        {
          statement: expect.stringContaining('INSERT OR REPLACE INTO session_meta'),
          values: ['a', 'Test Session', 0, 0, null, null, null, null, 'chat', 100, 100, null],
        },
        {
          statement: expect.stringContaining('INSERT OR REPLACE INTO session_meta'),
          values: ['b', 'Test Session', 1, 0, null, null, null, null, 'chat', 100, 100, null],
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

  it('adds archived_at column for existing mobile databases', async () => {
    const storage = new SQLiteSessionMetaStorage()
    mockDatabase.query.mockResolvedValueOnce({ values: [{ name: 'id' }, { name: 'hidden' }] })

    await storage.initialize()

    expect(mockDatabase.execute).toHaveBeenCalledWith('ALTER TABLE session_meta ADD COLUMN archived_at INTEGER')
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
