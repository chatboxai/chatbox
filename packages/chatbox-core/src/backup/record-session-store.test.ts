import type { Session } from '@shared/types'
import { expect, it, vi } from 'vitest'
import { InMemorySessionRecordStore } from '../persistence/memory-session-record-store'
import { InMemorySessionRowStore } from '../persistence/memory-session-row-store'
import { openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { recordBackupSource } from './record-session-store'
import { DEFAULT_BACKUP_PAGE_LIMITS, type BackupRow, type BackupSessionStore } from './session-port'
import { openSqlBackupValue } from './sql-value-file'

const legacy: Session = {
  id: 's',
  name: 'Legacy',
  messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'streamed🙂' }] }],
}
async function readRows(source: BackupSessionStore, threadId?: string) {
  const result: BackupRow[] = []
  for await (const row of source.iterateBackupRows('s', DEFAULT_BACKUP_PAGE_LIMITS, undefined, threadId))
    result.push(row)
  return result
}
function rawRecords() {
  const records = new InMemorySessionRecordStore()
  const read = vi.spyOn(records, 'getRecord').mockRejectedValue(new Error('Whole-value JSON reads are forbidden'))
  return { records, read }
}

it.each([false, true])('streams a chunked legacy record with unpublished rows=%s', async (unpublished) => {
  const database = openNodeSessionRowDatabase()
  try {
    const raw = JSON.stringify(legacy)
    const split = Math.floor(raw.length / 2)
    await database.executeBatch([
      { sql: 'CREATE TABLE key_value (key TEXT PRIMARY KEY, value TEXT)', params: [] },
      { sql: 'CREATE TABLE key_value_chunks (key TEXT, generation TEXT, chunk_index INTEGER, value TEXT)', params: [] },
      {
        sql: 'INSERT INTO key_value VALUES (?, ?)',
        params: ['session:s', `__CHATBOX_CHUNKED_VALUE_V1__:g:2:${raw.length}`],
      },
      { sql: 'INSERT INTO key_value_chunks VALUES (?, ?, ?, ?)', params: ['session:s', 'g', 0, raw.slice(0, split)] },
      { sql: 'INSERT INTO key_value_chunks VALUES (?, ?, ?, ?)', params: ['session:s', 'g', 1, raw.slice(split)] },
    ])
    const rows = new InMemorySessionRowStore()
    if (unpublished) {
      const snapshot = contextSnapshot({ ...legacy, name: 'Unpublished candidate' })
      delete snapshot.record.rowAuthority
      await rows.writeRows(snapshot)
    }
    const { records, read } = rawRecords()
    const source = recordBackupSource(rows, records, {
      listSessionIds: async () => ['s'],
      open: (id) => openSqlBackupValue(database, `session:${id}`),
    })
    const exported = await readRows(source)
    expect(exported[0]).toMatchObject({ kind: 'header', record: { name: 'Legacy' } })
    const message = exported.find((row) => row.kind === 'message')
    if (message?.kind !== 'message' || !message.payload?.chunks) throw new Error('Missing streamed body')
    let body = ''
    const decoder = new TextDecoder()
    for await (const chunk of message.payload.chunks()) body += decoder.decode(chunk, { stream: true })
    body += decoder.decode()
    expect(JSON.parse(body)).toEqual(legacy.messages[0])
    expect(read).not.toHaveBeenCalled()
  } finally {
    database.close()
  }
})

it('exports published rows before opening stale or corrupt raw JSON', async () => {
  const rows = new InMemorySessionRowStore()
  const snapshot = contextSnapshot({ ...legacy, name: 'Published' })
  snapshot.record.rowAuthority = 1
  await rows.writeRows(snapshot)
  const { records, read } = rawRecords()
  const open = vi.fn().mockRejectedValue(new Error('Corrupt external projection'))
  const source = recordBackupSource(rows, records, { listSessionIds: async () => ['s'], open })
  expect((await readRows(source))[0]).toMatchObject({ kind: 'header', record: { name: 'Published' } })
  expect(await source.readLegacySession?.('s', 1024)).toBeNull()
  expect(open).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})

it('recognizes a released raw rows marker and preserves thread filtering', async () => {
  const rows = new InMemorySessionRowStore()
  const snapshot = contextSnapshot({ ...legacy, name: 'Published rows' })
  delete snapshot.record.rowAuthority
  await rows.writeRows(snapshot)
  const { records, read } = rawRecords()
  const source = recordBackupSource(rows, records, {
    listSessionIds: async () => ['s'],
    open: async () => new Blob([JSON.stringify(snapshot.record)]),
  })
  expect((await readRows(source, snapshot.record.activeThreadId))[0]).toMatchObject({
    kind: 'header',
    record: { name: 'Published rows' },
  })
  expect(await source.readLegacySession?.('s', 1024 * 1024)).toBeNull()
  expect(read).not.toHaveBeenCalled()
})

it.each([
  ['incomplete', '{"id":"s","messages":['],
  ['missing', '{"id":"s","storageFormat":"rows"}'],
  ['storage key', '{"id":"other","storageFormat":"rows"}'],
])('rejects %s raw data instead of substituting an unpublished candidate', async (reason, raw) => {
  const rows = new InMemorySessionRowStore()
  const { records, read } = rawRecords()
  const source = recordBackupSource(rows, records, {
    listSessionIds: async () => ['s'],
    open: async () => new Blob([raw]),
  })
  await expect(readRows(source)).rejects.toThrow(reason)
  expect(read).not.toHaveBeenCalled()
})
