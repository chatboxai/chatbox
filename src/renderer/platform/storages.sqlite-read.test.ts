import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'

vi.mock('.', () => ({ default: { isDesktopLike: false, type: 'mobile' } }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))

import { __test__ } from './storages'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function fixture(value: string | null) {
  const database = openNodeSessionRowDatabase()
  cleanups.push(() => database.close())
  const queries: Array<{ sql: string; bytes: number }> = []
  const connection = {
    execute: async (sql: string) => {
      await database.execute(sql)
      return { changes: { changes: 0 } }
    },
    query: async (sql: string, values: Array<string | number | null> = []) => {
      const rows = await database.query<Record<string, unknown>>(sql, values)
      queries.push({ sql, bytes: Buffer.byteLength(JSON.stringify({ values: rows }).replace(/\//g, '\\/')) })
      return { values: rows }
    },
  }
  const storage = new __test__.SQLiteStorage(connection as unknown as SQLiteDBConnection)
  await storage.getAllKeys()
  await database.query('INSERT INTO key_value(key,value) VALUES (?,?)', ['settings', value])
  queries.length = 0
  return { storage, queries, database }
}

describe('bounded mobile SQLite value reads', () => {
  it.each([
    ['settings JSON', JSON.stringify({ customPrompt: 'x'.repeat(9000), language: 'en' })],
    ['empty value', ''],
    ['embedded NUL', 'a\0b😀'],
    ['128-byte boundary', 'x'.repeat(128)],
    ['inline byte boundary', 'x'.repeat(16 * 1024)],
    ['Unicode JSON', JSON.stringify({ text: '中文😀'.repeat(900), escaped: '\0\ud800\\"\n' })],
    ['heavily escaped JSON', JSON.stringify({ text: '\\"\n\t'.repeat(900) })],
  ])('reads complete %s in one bounded query', async (_name, value) => {
    const { storage, queries } = await fixture(value)
    expect(await storage.getItem('settings')).toBe(value)
    expect(queries).toHaveLength(1)
    expect(queries[0].bytes).toBeLessThan(100 * 1024)
  })

  it('keeps a larger inline value off the first bridge response', async () => {
    const value = '😀'.repeat(5000)
    const { storage, queries } = await fixture(value)
    expect(await storage.getItem('settings')).toBe(value)
    expect(queries).toHaveLength(2)
    expect(queries[0].bytes).toBeLessThan(2048)
  })

  it('uses the byte boundary rather than the JavaScript character count', async () => {
    const value = '界'.repeat(6000)
    const { storage, queries } = await fixture(value)
    expect(await storage.getItem('settings')).toBe(value)
    expect(queries).toHaveLength(2)
    expect(queries[0].bytes).toBeLessThan(2048)
  })

  it('preserves missing and SQL-null values', async () => {
    const { storage, queries } = await fixture(null)
    expect(await storage.getItem('settings')).toBeNull()
    expect(await storage.getItem('missing')).toBeNull()
    expect(queries).toHaveLength(2)
  })

  it('follows the committed chunk manifest', async () => {
    const value = '😀'.repeat(500)
    const manifest = `__CHATBOX_CHUNKED_VALUE_V1__:generation:2:${value.length}`
    const { storage, queries, database } = await fixture(manifest)
    for (let index = 0; index < 2; index++) {
      await database.query('INSERT INTO key_value_chunks(key,generation,chunk_index,value) VALUES (?,?,?,?)', [
        'settings',
        'generation',
        index,
        value.slice(index * 500, (index + 1) * 500),
      ])
    }
    expect(await storage.getItem('settings')).toBe(value)
    expect(queries).toHaveLength(3)
  })
})
