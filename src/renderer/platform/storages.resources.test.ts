import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'

vi.mock('.', () => ({ default: { isDesktopLike: false, type: 'mobile' } }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

import { __test__ } from './storages'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((close) => close()))
async function fixture() {
  const db = openNodeSessionRowDatabase()
  cleanups.push(() => db.close())
  const bytes: number[] = []
  let fail = false
  const connection = {
    execute: (sql: string) => db.execute(sql),
    query: async (sql: string, params: Array<string | number | null> = []) => {
      const values = await db.query(sql, params)
      bytes.push(Buffer.byteLength(JSON.stringify(values)))
      return { values }
    },
    run: (sql: string, params: Array<string | number | null>) => db.query(sql, params),
    executeSet: async (
      batch: Array<{ statement: string; values: Array<string | number | null> }>,
      transaction: boolean
    ) => {
      expect(transaction).toBe(true)
      bytes.push(Buffer.byteLength(JSON.stringify(batch)))
      if (fail) {
        fail = false
        throw new Error('quota')
      }
      await db.executeBatch(batch.map(({ statement, values }) => ({ sql: statement, params: values })))
    },
  }
  const storage = new __test__.SQLiteStorage(connection as unknown as SQLiteDBConnection)
  await storage.getAllKeys()
  return {
    db,
    storage,
    bytes,
    failNext: () => {
      fail = true
    },
  }
}
it('reads persisted native chunks with NUL, BOM and Unicode across byte slices', async () => {
  const { storage, db } = await fixture()
  const parts = ['中文🙂', '\ufeffattachment\0', '\ufeff中🙂'.repeat(40_000) + '\0tail', 'tail']
  for (const [index, value] of parts.entries())
    await db.query('INSERT INTO key_value_chunks(key,generation,chunk_index,value) VALUES (?,?,?,?)', [
      'fixture:stored-value',
      'generation',
      index,
      value,
    ])
  await db.query('INSERT INTO key_value(key,value) VALUES (?,?)', [
    'fixture:stored-value',
    `__CHATBOX_CHUNKED_VALUE_V1__:generation:${parts.length}:${parts.join('').length}`,
  ])
  expect(await storage.getItem('fixture:stored-value')).toBe(parts.join(''))
})

it('removes ordinary values and their chunks in one transaction', async () => {
  const { storage, bytes } = await fixture()
  await storage.setItem('a', 'small')
  await storage.setItem('b', 'y'.repeat(600_000))
  await storage.setItem('keep', 'kept')
  bytes.length = 0
  await storage.removeItems(['b', 'a', 'a'])
  expect(bytes).toHaveLength(1)
  expect(await storage.getItem('a')).toBeNull()
  expect(await storage.getItem('b')).toBeNull()
  expect(await storage.getItem('keep')).toBe('kept')
})
