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
  // Regular (newable) function impl: `new SQLiteConnection()` must construct under vitest 4, which
  // Reflect.constructs the implementation — an arrow function there throws "is not a constructor".
  SQLiteConnection: vi.fn(function SQLiteConnectionMock() {
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
          values: ['a', 'Test Session', 0, 0, null, null, null, 'chat', null, 100, 100],
        },
        {
          statement: expect.stringContaining('INSERT OR REPLACE INTO session_meta'),
          values: ['b', 'Test Session', 1, 0, null, null, null, 'chat', null, 100, 100],
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
})
