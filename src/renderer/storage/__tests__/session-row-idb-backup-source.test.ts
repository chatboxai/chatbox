import { expect, it, vi } from 'vitest'
import { jsonUtf8Chunks, toLogicalBackupRow } from '@chatbox/core/backup'
import { contextSnapshot } from '../../../../packages/chatbox-core/src/persistence/session-context-read.test-support'
import { prepareIndexedDBBackupMessage } from '../session-row-idb-backup-source'

const messageRow = (text: string) =>
  contextSnapshot({
    id: 'bounded',
    name: 'Bounded',
    messages: [{ id: 'body', role: 'user', contentParts: [{ type: 'text', text }] }],
  }).rows.messages[0]

it.each(['a'.repeat(65536), '🙂中\n\\"\ud800'.repeat(2500)])(
  'uses exact encoded record boundaries for escaped and Unicode messages (%#)',
  async (text) => {
    const row = messageRow(text)
    const size = new TextEncoder().encode(JSON.stringify(toLogicalBackupRow({ kind: 'message', message: row }))).length
    for (const limit of [size, size - 1]) {
      const source = vi.fn(async function* () {
        yield* jsonUtf8Chunks(row.message)
      })
      for await (const result of prepareIndexedDBBackupMessage(row, limit, source)) {
        if (result.kind !== 'message') throw new Error('Expected message')
        expect(Boolean(result.payload)).toBe(limit < size)
        if (result.payload?.chunks) {
          const decoder = new TextDecoder()
          let text = ''
          for await (const chunk of result.payload.chunks()) text += decoder.decode(chunk, { stream: true })
          text += decoder.decode()
          expect(JSON.parse(text)).toEqual(row.message)
        } else expect(result.message).toEqual(row)
      }
      expect(source).toHaveBeenCalledTimes(1)
    }
  }
)

it('stops probing at the bounded prefix and resumes without rereading the source', async () => {
  const row = messageRow('a'.repeat(1024 * 1024))
  let pulled = 0
  let closed = false
  const source = vi.fn(async function* () {
    try {
      for (const chunk of jsonUtf8Chunks(row.message)) {
        pulled += chunk.length
        yield chunk
      }
    } finally {
      closed = true
    }
  })
  for await (const result of prepareIndexedDBBackupMessage(row, 128 * 1024, source)) {
    expect(pulled).toBeLessThan(144 * 1024)
    expect(closed).toBe(false)
    if (result.kind !== 'message' || !result.payload?.chunks) throw new Error('Missing payload')
    let emitted = 0
    for await (const chunk of result.payload.chunks()) emitted += chunk.length
    expect(emitted).toBe(new TextEncoder().encode(JSON.stringify(row.message)).length)
    expect(pulled).toBe(emitted)
  }
  expect(source).toHaveBeenCalledTimes(1)
  expect(closed).toBe(true)
})

it('closes a suspended source when export stops before consuming the payload', async () => {
  const row = messageRow('x'.repeat(200_000))
  let closed = false
  const source = async function* () {
    try {
      yield* jsonUtf8Chunks(row.message)
    } finally {
      closed = true
    }
  }
  for await (const result of prepareIndexedDBBackupMessage(row, 128 * 1024, source)) {
    expect(result.kind).toBe('message')
    break
  }
  expect(closed).toBe(true)
})

it('honors cancellation during the prefix probe and closes its source', async () => {
  const row = messageRow('x'.repeat(65536))
  const controller = new AbortController()
  let closed = false
  const source = async function* () {
    try {
      controller.abort()
      yield new Uint8Array(100)
    } finally {
      closed = true
    }
  }
  const rows = prepareIndexedDBBackupMessage(row, 128 * 1024, source, controller.signal)
  await expect(rows.next()).rejects.toThrow()
  expect(closed).toBe(true)
})

it('propagates a small stored payload read failure instead of exporting its projection', async () => {
  const { message, ...metadata } = messageRow('small')
  const source = async function* () {
    yield new TextEncoder().encode(JSON.stringify(message))
    throw new Error('Incomplete stored payload')
  }
  const rows = prepareIndexedDBBackupMessage(
    { ...metadata, payload: { id: 'stored', size: 1000, count: 2 } },
    128 * 1024,
    source
  )
  await expect(rows.next()).rejects.toThrow('Incomplete stored payload')
})
