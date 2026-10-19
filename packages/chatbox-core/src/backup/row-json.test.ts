import type { Message, Session } from '@shared/types'
import { expect, it, vi } from 'vitest'
import { convertLegacyTreeToRowFormat } from '../application/session/compatibility/row-format'
import { encodeSessionTree } from '../session/session-tree/encode'
import { exportBackupArchive } from './export-backup'
import { jsonUtf8Blocks } from './json-stream'
import { encodeRowJson, RowJsonLayout, SingleFileBudgetError } from './row-json'
import type { BackupRow } from './session-port'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'

const message = (id: string, extra: Partial<Message> = {}): Message => ({
  id,
  role: 'user',
  contentParts: [{ type: 'text', text: id }],
  ...extra,
})
const fixture: Session = {
  id: 's',
  name: 'Rows',
  threadName: 'Current',
  messages: [message('pivot'), message('summary', { role: 'assistant', isSummary: true })],
  threads: [{ id: 'archive', name: 'Archived', createdAt: 11, messages: [message('old')] }],
  messageForksHash: {
    pivot: {
      position: 1,
      createdAt: 12,
      lists: [
        { id: 'a', messages: [message('a'), message('nested'), message('selected')] },
        { id: 'empty', messages: [] },
        { id: 'b', messages: [message('b')] },
      ],
    },
    nested: {
      position: 0,
      createdAt: 13,
      lists: [
        { id: 'selected', messages: [] },
        { id: 'other', messages: [message('other')] },
      ],
    },
  },
}
function source(value: Session = fixture) {
  const encoded = encodeSessionTree(value, { activeThreadId: 'active', now: 0 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const tree = convertLegacyTreeToRowFormat(encoded.tree, value.messageForksHash)
  const snapshot = { record: tree.session, rows: { threads: tree.threads, messages: tree.messages } }
  return {
    snapshot,
    rows: (async function* (): AsyncGenerator<BackupRow> {
      yield { kind: 'header', record: snapshot.record }
      for (const thread of snapshot.rows.threads) yield { kind: 'thread', thread }
      // Metadata order does not define paths or fork ancestry.
      for (const row of [...snapshot.rows.messages].reverse()) yield { kind: 'message', message: row }
    })(),
  }
}
it('encodes selected empty branches, archived threads and nested inactive forks directly from rows', async () => {
  const result = await encodeRowJson(source().rows, 's', 64 * 1024, true)
  const decoded: Session = JSON.parse(new TextDecoder().decode(result.bytes))
  expect(decoded.messages.map((row) => row.id)).toEqual(['pivot', 'summary'])
  expect(decoded.threads?.[0]).toMatchObject(fixture.threads![0])
  expect(decoded.messageForksHash?.pivot).toEqual(fixture.messageForksHash!.pivot)
  expect(decoded.messageForksHash?.nested).toEqual(fixture.messageForksHash!.nested)
  expect(decoded.threadName).toBe('Current')
  expect(result.counts).toEqual({ threads: 2, messages: 8 })
  expect(result.header).not.toHaveProperty('messages')
  expect(result.header).not.toHaveProperty('storageFormat')
  const measured = await encodeRowJson(source().rows, 's', result.size, false)
  expect(measured.bytes).toBeUndefined()
  expect(measured.size).toBe(result.size)
  await expect(encodeRowJson(source().rows, 's', result.size - 1, true)).rejects.toBeInstanceOf(SingleFileBudgetError)
})
it('retains header resource references and removes only transient attachment state', async () => {
  const value: Session = {
    id: 's',
    name: 'S',
    assistantAvatarKey: 'avatar',
    backgroundImage: { type: 'storage-key', storageKey: 'background' },
    messages: [
      message('m', {
        files: [
          {
            id: 'f',
            name: 'file.txt',
            fileType: 'text/plain',
            storageKey: 'file',
            localPath: '/private/file',
            sessionAttachmentId: 3,
          },
        ],
      }),
    ],
  }
  const encoded = await encodeRowJson(source(value).rows, 's', 4096, true)
  const decoded: Session = JSON.parse(new TextDecoder().decode(encoded.bytes))
  expect(decoded.messages[0].files?.[0]).toEqual({
    id: 'f',
    name: 'file.txt',
    fileType: 'text/plain',
    storageKey: 'file',
  })
  expect(encoded.references.map((reference) => reference.storageKey).sort()).toEqual(['avatar', 'background', 'file'])
})
it('closes an oversized payload stream at the single-file byte budget', async () => {
  const { snapshot } = source({ id: 's', name: 'S', messages: [message('m')] })
  let read = 0,
    closed = false
  const rows = (async function* (): AsyncGenerator<BackupRow> {
    yield { kind: 'header', record: snapshot.record }
    for (const thread of snapshot.rows.threads) yield { kind: 'thread', thread }
    yield {
      kind: 'message',
      message: snapshot.rows.messages[0],
      payload: {
        chunks: async function* () {
          try {
            for (const block of jsonUtf8Blocks(
              message('m', { contentParts: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024) }] })
            )) {
              read++
              yield block
            }
          } finally {
            closed = true
          }
        },
      },
    }
  })()
  await expect(encodeRowJson(rows, 's', 4096, true)).rejects.toBeInstanceOf(SingleFileBudgetError)
  expect(closed).toBe(true)
  expect(read).toBeLessThan(4)
})
it('rejects disconnected rows and selected edges that cross parents', async () => {
  const { snapshot } = source()
  const layout = new RowJsonLayout('s')
  layout.add({ kind: 'header', record: snapshot.record })
  for (const thread of snapshot.rows.threads) layout.add({ kind: 'thread', thread })
  for (const row of snapshot.rows.messages)
    layout.add({ kind: 'message', message: row.messageId === 'pivot' ? { ...row, activeChildId: 'other' } : row })
  expect(() => [...layout.parts()]).toThrow('Invalid backup selected child')
})
it('requires the host row source before starting a conversation export writer', async () => {
  const writeArchive = vi.fn(async () => ({ boundedMemory: true }))
  await expect(
    exportBackupArchive({
      storage: new MemoryStorage(),
      metaStorage: new MemoryMetaStorage(),
      exportItems: ['conversations'],
      includeKeys: false,
      application: { version: 'test', platform: 'test' },
      writeArchive,
    })
  ).rejects.toThrow('Conversation backup requires a row source')
  expect(writeArchive).not.toHaveBeenCalled()
})
