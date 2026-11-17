import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'

vi.mock('.', () => ({ default: { isDesktopLike: false, type: 'mobile' } }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

import { __test__, MobileSQLiteStorage } from './storages'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((close) => close()))

async function fixture() {
  const db = openNodeSessionRowDatabase()
  cleanups.push(() => db.close())
  const bridgeBytes: number[] = []
  const connection = {
    execute: vi.fn((sql: string) => db.execute(sql)),
    query: vi.fn(async (sql: string, params: Array<string | number | null> = []) => {
      const values = await db.query(sql, params)
      bridgeBytes.push(Buffer.byteLength(JSON.stringify(values)))
      return { values }
    }),
    run: (sql: string, params: Array<string | number | null>) => db.query(sql, params),
    executeSet: vi.fn(
      async (batch: Array<{ statement: string; values: Array<string | number | null> }>, transaction: boolean) => {
        expect(transaction).toBe(true)
        bridgeBytes.push(Buffer.byteLength(JSON.stringify(batch)))
        await db.executeBatch(batch.map(({ statement, values }) => ({ sql: statement, params: values })))
      }
    ),
  }
  const storage = new __test__.SQLiteStorage(connection as unknown as SQLiteDBConnection)
  await storage.getAllKeys()
  bridgeBytes.length = 0
  connection.execute.mockClear()
  connection.executeSet.mockClear()
  return { db, storage, connection, bridgeBytes }
}

it('copies complete and chunked values natively in one transaction', async () => {
  const { storage, db, connection, bridgeBytes } = await fixture()
  const value = '\ufeff中🙂\0"\\'.repeat(50_000)
  await storage.setItem('source', value)
  await storage.setItem('destination', 'old'.repeat(100_000))
  bridgeBytes.length = 0
  connection.executeSet.mockClear()

  expect(await storage.copyItem('source', 'destination')).toBe(true)
  expect(connection.executeSet).toHaveBeenCalledOnce()
  expect(Math.max(...bridgeBytes)).toBeLessThan(1024)
  await storage.removeItem('source')
  expect(await storage.getItem('destination')).toBe(value)

  await db.query('INSERT INTO key_value(key, value) VALUES (?, ?)', ['inline', 'complete value'])
  expect(await storage.copyItem('inline', 'destination')).toBe(true)
  expect(await storage.getItem('destination')).toBe('complete value')
  expect(await db.query('SELECT * FROM key_value_chunks WHERE key = ?', ['destination'])).toEqual([])
})

it('keeps the destination for an absent source and treats same-key copies as a no-op', async () => {
  const { storage, connection } = await fixture()
  await storage.setItem('destination', 'keep')
  connection.executeSet.mockClear()
  expect(await storage.copyItem('missing', 'destination')).toBe(false)
  expect(await storage.copyItem('destination', 'destination')).toBe(true)
  expect(await storage.copyItem('missing', 'missing')).toBe(false)
  expect(connection.executeSet).not.toHaveBeenCalled()
  expect(await storage.getItem('destination')).toBe('keep')
})

it('rolls back copied chunks and the destination value when publication fails', async () => {
  const { storage, db } = await fixture()
  const previous = 'old'.repeat(100_000)
  const replacement = 'new'.repeat(100_000)
  await storage.setItem('destination', previous)
  await storage.setItem('source', replacement)
  await db.execute(`
    CREATE TRIGGER reject_copy BEFORE INSERT ON key_value
    WHEN NEW.key = 'destination'
    BEGIN SELECT RAISE(ABORT, 'copy rejected'); END;
  `)

  await expect(storage.copyItem('source', 'destination')).rejects.toThrow('copy rejected')
  expect(await storage.getItem('destination')).toBe(previous)
  expect(await storage.getItem('source')).toBe(replacement)
  await db.execute('DROP TRIGGER reject_copy')
  expect(await storage.copyItem('source', 'destination')).toBe(true)
  expect(await storage.getItem('destination')).toBe(replacement)
})

it('reclaims freed pages and restores the default temporary-store setting', async () => {
  const { storage, db } = await fixture()
  await db.query('INSERT INTO key_value(key, value) VALUES (?, ?)', ['large', 'x'.repeat(12_000_000)])
  await storage.removeItem('large')
  const freePages = async () =>
    Number((await db.query<{ freelist_count: number }>('PRAGMA freelist_count'))[0]?.freelist_count)
  expect(await freePages()).toBeGreaterThan(0)

  await storage.compact()

  expect(await freePages()).toBe(0)
  expect((await db.query<{ temp_store: number }>('PRAGMA temp_store'))[0]?.temp_store).toBe(0)
})

it.each([
  { pageCount: 2048, freePages: 2047, compacts: false },
  { pageCount: 8193, freePages: 2048, compacts: false },
  { pageCount: 8192, freePages: 2048, compacts: true },
])(
  'compacts only at both space thresholds: $pageCount pages/$freePages free',
  async ({ pageCount, freePages, compacts }) => {
    const { storage, connection } = await fixture()
    const pragmas: Record<string, number> = { page_count: pageCount, freelist_count: freePages, page_size: 4096 }
    connection.query.mockImplementation(async (sql) => {
      const name = sql.replace('PRAGMA ', '').replace(';', '')
      return { values: [{ [name]: pragmas[name] }] }
    })
    await storage.compact()
    expect(connection.execute.mock.calls.some(([sql]) => sql === 'VACUUM;')).toBe(compacts)
  }
)

it('restores the temporary-store setting after compaction failure', async () => {
  const { storage, connection } = await fixture()
  const pragmas: Record<string, number> = { page_count: 4096, freelist_count: 2048, page_size: 4096 }
  connection.query.mockImplementation(async (sql) => {
    const name = sql.replace('PRAGMA ', '').replace(';', '')
    return { values: [{ [name]: pragmas[name] }] }
  })
  connection.execute.mockImplementation(async (sql) => {
    if (sql === 'VACUUM;') throw new Error('disk full')
  })
  await expect(storage.compact()).rejects.toThrow('disk full')
  expect(connection.execute.mock.calls.map(([sql]) => sql)).toEqual([
    'PRAGMA temp_store = FILE;',
    'VACUUM;',
    'PRAGMA temp_store = DEFAULT;',
  ])
})

it('exposes native copy and compaction through the platform facade', async () => {
  const { connection } = await fixture()
  const platformStorage = new MobileSQLiteStorage(connection as unknown as SQLiteDBConnection)
  await platformStorage.setStoreValue('source', { saved: true })
  expect(await platformStorage.copyStoreValue('source', 'destination')).toBe(true)
  expect(await platformStorage.getStoreValue('destination')).toEqual({ saved: true })
  await platformStorage.compactStore()
})
