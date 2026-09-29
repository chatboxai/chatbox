import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { BackupFile } from '@chatbox/core/backup'
import type LocalForage from 'localforage'
import { afterEach, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { mobileBackupBlobs } from './mobile-backup-blobs'

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
async function text(file: BackupFile | null) {
  if (!file?.readBytes) throw new Error('missing file')
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let value = ''
  for (let offset = 0; offset < file.size; offset += 65536)
    value += decoder.decode(await file.readBytes(offset, Math.min(65536, file.size - offset)), { stream: true })
  return value + decoder.decode()
}
async function* chunks(value: string) {
  for (let i = 0; i < value.length; i += 1337) yield value.slice(i, i + 1337)
}
it('round-trips native streamed resources and copies legacy values without transferring whole values', async () => {
  const { storage, db, bytes } = await fixture()
  const value = '\ufeff中🙂\0"\\'.repeat(40000)
  await storage.writeStream('resource', chunks(value))
  expect(await text(await storage.openBackupValue('resource'))).toBe(value)
  await storage.copyItem('resource', 'copy')
  await storage.removeItem('resource')
  expect(await text(await storage.openBackupValue('copy'))).toBe(value)
  await db.query('INSERT INTO key_value(key,value) VALUES (?,?)', ['legacy', value])
  expect(await storage.copyItem('legacy', 'snapshot')).toBe(true)
  expect(await text(await storage.openBackupValue('snapshot'))).toBe(value)
  expect(await storage.copyItem('missing', 'snapshot')).toBe(false)
  expect(await text(await storage.openBackupValue('snapshot'))).toBe(value)
  expect(Math.max(...bytes)).toBeLessThan(384 * 1024)
})
it('reads values stored as many small chunks within the bridge budget', async () => {
  const { storage, db, bytes } = await fixture()
  const value = 'a'.repeat(20000)
  for (let index = 0; index < value.length; index++)
    await db.query('INSERT INTO key_value_chunks(key,generation,chunk_index,value) VALUES (?,?,?,?)', [
      'tiny',
      'g',
      index,
      value[index],
    ])
  await db.query('INSERT INTO key_value(key,value) VALUES (?,?)', [
    'tiny',
    `__CHATBOX_CHUNKED_VALUE_V1__:g:${value.length}:${value.length}`,
  ])
  bytes.length = 0
  expect(await text(await storage.openBackupValue('tiny'))).toBe(value)
  expect(Math.max(...bytes)).toBeLessThan(384 * 1024)
})
it('retains the previous snapshot on transaction failure and cleans interrupted stream chunks', async () => {
  const { storage, db, failNext } = await fixture()
  await storage.writeStream('old', chunks('original'))
  await storage.writeStream('new', chunks('replacement'))
  failNext()
  await expect(storage.copyItem('new', 'old')).rejects.toThrow('quota')
  expect(await text(await storage.openBackupValue('old'))).toBe('original')
  await expect(
    storage.writeStream(
      'interrupted',
      (async function* () {
        yield 'partial'
        throw new Error('canceled')
      })()
    )
  ).rejects.toThrow('canceled')
  expect(await storage.openBackupValue('interrupted')).toBeNull()
  expect(await db.query('SELECT * FROM key_value_chunks WHERE key = ?', ['interrupted'])).toEqual([])
})
it('publishes mobile resource pointers only after native content and preserves data on replacement failure', async () => {
  const { storage, db } = await fixture()
  const values = new Map<string, unknown>()
  let fail = false
  const store = {
    keys: async () => [...values.keys()],
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      if (fail) throw new Error('quota')
      values.set(key, value)
    },
    removeItem: async (key: string) => {
      values.delete(key)
    },
  } as unknown as LocalForage
  const blobs = mobileBackupBlobs(store, storage)
  const value = '\ufeff🙂'.repeat(40000)
  await blobs.streams.write('picture:qa', chunks(value))
  expect(await blobs.get('picture:qa')).toBe(value)
  let streamed = ''
  for await (const part of (await blobs.streams.read('picture:qa'))!) streamed += part
  expect(streamed).toBe(value)
  fail = true
  await expect(blobs.set('picture:qa', 'new')).rejects.toThrow('quota')
  expect(await blobs.get('picture:qa')).toBe(value)
  await expect(blobs.streams.write('failed', chunks('body'))).rejects.toThrow('quota')
  fail = false
  await blobs.remove('picture:qa')
  expect(await db.query('SELECT key FROM key_value')).toEqual([])
  expect(await db.query('SELECT key FROM key_value_chunks')).toEqual([])
})

it('accepts a protocol-limit base64 resource without retaining its encoded body', async () => {
  let storedCharacters = 0
  let allTransactional = true
  const connection = {
    execute: async () => {},
    query: async () => ({ values: [] }),
    executeSet: async (batch: Array<{ statement: string; values: Array<string | number> }>, transaction: boolean) => {
      allTransactional &&= transaction
      for (const statement of batch) {
        if (statement.statement.startsWith('INSERT INTO key_value_chunks'))
          storedCharacters += String(statement.values[3]).length
      }
    },
  }
  const storage = new __test__.SQLiteStorage(connection as unknown as SQLiteDBConnection)
  const encodedLength = Math.ceil((512 * 1024 ** 2) / 3) * 4
  const block = 'A'.repeat(16384)
  await storage.writeStream(
    'large-image',
    (async function* () {
      yield 'data:image/png;base64,'
      for (let offset = 0; offset < encodedLength; offset += block.length)
        yield block.slice(0, Math.min(block.length, encodedLength - offset))
    })()
  )
  expect(storedCharacters).toBe(encodedLength + 'data:image/png;base64,'.length)
  expect(allTransactional).toBe(true)
}, 30000)
