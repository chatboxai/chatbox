import { describe, expect, it } from 'vitest'
import { convertLegacyTreeToRowFormat } from '../application/session/compatibility/row-format'
import { toBackupMessage, toBackupSession, toBackupThread } from '../backup-v3/schema'
import type { BackupBusinessRecord, BackupMessage, BackupSession, BackupWorkspace } from '../backup-v3/types'
import type { ByteSink } from '../io'
import { decodeSessionTree, encodeSessionTree } from '../session/session-tree'
import type { Message, Session } from '../types/session'
import { createLegacySessionWriter } from './session'

const decoder = new TextDecoder()
function combine(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, bytes) => sum + bytes.length, 0))
  let offset = 0
  for (const bytes of parts) {
    result.set(bytes, offset)
    offset += bytes.length
  }
  return result
}
class Workspace implements BackupWorkspace {
  files = new Map<string, Uint8Array>()
  readSizes: number[] = []
  aborted = 0
  closedSources = 0
  async createFile(name: string): Promise<ByteSink> {
    const parts: Uint8Array[] = []
    return {
      write: async (bytes) => {
        parts.push(bytes.slice())
      },
      close: async () => {
        this.files.set(name, combine(parts))
      },
      abort: async () => {
        this.aborted++
        parts.length = 0
      },
    }
  }
  async openFile(name: string) {
    const bytes = this.files.get(name)
    if (!bytes) throw new Error('Missing file')
    return {
      size: bytes.length,
      readBytes: async (offset: number, length: number) => {
        this.readSizes.push(length)
        return bytes.slice(offset, offset + length)
      },
      close: async () => {
        this.closedSources++
      },
    }
  }
  async put(): Promise<boolean> {
    throw new Error('No workspace index is needed')
  }
  async get(): Promise<string | null> {
    throw new Error('No workspace index is needed')
  }
  async *entries(): AsyncIterable<{ key: string; value: string }> {
    throw new Error('No workspace index is needed')
  }
  async dispose() {}
}
function output() {
  const parts: Uint8Array[] = []
  let closed = false
  const sink: ByteSink = {
    write: async (bytes) => {
      parts.push(bytes.slice())
    },
    close: async () => {
      closed = true
    },
    abort: async () => {
      parts.length = 0
    },
  }
  return { sink, parts, closed: () => closed, read: () => JSON.parse(decoder.decode(combine(parts))) as Session }
}
const message = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
})
function records(session: Session) {
  const encoded = encodeSessionTree(session, { activeThreadId: `${session.id}-active`, now: 1 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const tree = convertLegacyTreeToRowFormat(encoded.tree, encoded.normalized.messageForksHash)
  const decoded = decodeSessionTree(tree)
  if (!decoded.ok) throw new Error(decoded.reason)
  return {
    header: toBackupSession(tree.session),
    rows: [
      ...tree.threads.map((thread) => ({ type: 'thread' as const, thread: toBackupThread(thread) })),
      ...[...tree.messages].reverse().map((row) => ({ type: 'message' as const, message: toBackupMessage(row) })),
    ],
    expected: decoded.session,
  }
}
async function exportSession(session: Session) {
  const fixture = records(session)
  const workspace = new Workspace()
  const writer = await createLegacySessionWriter({ session: fixture.header, workspace, fileName: 'body' })
  for (const row of fixture.rows) await writer.append(row)
  const result = output()
  await writer.write(result.sink)
  return { ...result, workspace, expected: fixture.expected }
}
function fixture(empty = false): Session {
  return {
    id: 'conversation',
    name: 'Unicode 你好 😀',
    threadName: '',
    messages: [
      message('pivot'),
      { ...message('summary', 'assistant'), isSummary: true },
      ...(!empty ? [message('answer', 'assistant')] : []),
    ],
    threads: [
      { id: 'old-b', name: 'Second', createdAt: 2, messages: [message('old-b-root')] },
      { id: 'old-a', name: 'First', createdAt: 1, messages: [] },
    ],
    compactionPoints: [{ summaryMessageId: 'summary', boundaryMessageId: 'pivot', createdAt: 9 }],
    messageForksHash: {
      pivot: {
        position: 1,
        createdAt: 7,
        lists: [
          { id: 'alternative', messages: [message('alt-user'), message('alt-answer', 'assistant')] },
          { id: 'selected', messages: [] },
        ],
      },
      'alt-user': {
        position: 0,
        createdAt: 8,
        lists: [
          { id: 'nested-selected', messages: [] },
          { id: 'nested-alternative', messages: [message('nested', 'assistant')] },
        ],
      },
    },
  }
}
describe('streaming V2 conversation export', () => {
  it.each([false, true])('preserves thread order, nested branches, summaries and empty selection %s', async (empty) => {
    const result = await exportSession(fixture(empty))
    expect(result.read()).toEqual(result.expected)
    expect(result.read().messageForksHash?.pivot.position).toBe(1)
    expect(result.read().threads?.map((thread) => thread.id)).toEqual(['old-b', 'old-a'])
    expect(result.closed()).toBe(false)
    expect(result.workspace.closedSources).toBe(1)
  })

  it('keeps an empty conversation and an absent active thread name', async () => {
    const result = await exportSession({ id: 'empty', name: 'Empty', messages: [] })
    expect(result.read()).toEqual({ id: 'empty', name: 'Empty', messages: [] })
  })

  it('preserves historical frozen prompt context', async () => {
    const session: Session = {
      id: 'snapshots',
      name: 'Snapshots',
      messages: [],
      threads: [
        {
          id: 'history',
          name: 'History',
          createdAt: 1,
          messages: [],
          sessionPromptContextSnapshot: {
            version: 1,
            capturedAt: 1,
            soul: '',
            memories: [],
            workspaceInstructions: '',
            workspaceDirectories: [],
          },
        },
      ],
    }
    const result = await exportSession(session)
    expect(result.read().threads?.[0].sessionPromptContextSnapshot).toEqual(
      session.threads?.[0].sessionPromptContextSnapshot
    )
  })

  it('serializes bodies on append and reads large Unicode bodies in bounded byte ranges', async () => {
    const fixture = records({
      id: 'large',
      name: 'Large',
      messages: [{ ...message('large-body'), contentParts: [{ type: 'text', text: '你好😀'.repeat(30_000) }] }],
    })
    const workspace = new Workspace()
    const writer = await createLegacySessionWriter({ session: fixture.header, workspace, fileName: 'payload' })
    for (const row of fixture.rows) await writer.append(row)
    const row = fixture.rows.find((item) => item.type === 'message')
    if (row?.type !== 'message') throw new Error('Missing message')
    row.message.message.contentParts = [{ type: 'text', text: 'mutated after append' }]
    const result = output()
    await writer.write(result.sink)
    expect(result.read().messages[0].contentParts).toEqual([{ type: 'text', text: '你好😀'.repeat(30_000) }])
    expect(Math.max(...workspace.readSizes)).toBeLessThanOrEqual(64 * 1024)
    expect(result.parts.every((part) => part.length <= 64 * 1024)).toBe(true)
  })

  it('projects remote images to legacy pictures without duplicating existing URLs', async () => {
    const remote: Message & { pictures: Array<{ url: string }> } = {
      ...message('remote'),
      pictures: [{ url: 'https://example.test/existing.png' }],
      contentParts: [
        { type: 'image', storageKey: '', url: 'https://example.test/existing.png' },
        { type: 'image', storageKey: '', url: 'https://example.test/new.png' },
        { type: 'image', storageKey: 'picture:local' },
      ],
    }
    const result = await exportSession({ id: 'images', name: 'Images', messages: [remote] })
    expect(result.read().messages[0]).toMatchObject({
      pictures: [{ url: 'https://example.test/existing.png' }, { url: 'https://example.test/new.png' }],
      contentParts: [{ type: 'image', storageKey: 'picture:local' }],
    })
  })

  it.each(['cycle', 'orphan', 'wrong-thread', 'invalid-child'] as const)(
    'rejects %s without producing JSON',
    async (problem) => {
      const fixture = records({ id: 'invalid', name: 'Invalid', messages: [message('root'), message('leaf')] })
      const entries = fixture.rows.filter(
        (item): item is Extract<BackupBusinessRecord, { type: 'message' }> => item.type === 'message'
      )
      const root = entries.find((item) => item.message.messageId === 'root')!.message
      const leaf = entries.find((item) => item.message.messageId === 'leaf')!.message
      if (problem === 'cycle') {
        root.parentMessageId = 'leaf'
        leaf.activeChildId = 'root'
      }
      if (problem === 'orphan') {
        root.activeChildId = null
        leaf.parentMessageId = null
      }
      if (problem === 'wrong-thread') leaf.threadId = 'missing'
      if (problem === 'invalid-child') root.activeChildId = 'missing'
      const workspace = new Workspace()
      const writer = await createLegacySessionWriter({ session: fixture.header, workspace, fileName: 'payload' })
      for (const row of fixture.rows) await writer.append(row)
      const result = output()
      await expect(writer.write(result.sink)).rejects.toThrow()
      expect(result.parts).toEqual([])
      expect(workspace.aborted).toBe(1)
    }
  )

  it('cancels unfinished staging and closes an opened source on an output failure', async () => {
    const fixture = records({ id: 'cancel', name: 'Cancel', messages: [message('root')] })
    const workspace = new Workspace()
    const controller = new AbortController()
    const writer = await createLegacySessionWriter({
      session: fixture.header,
      workspace,
      fileName: 'canceled',
      signal: controller.signal,
    })
    for (const row of fixture.rows) await writer.append(row)
    controller.abort()
    await expect(writer.write(output().sink)).rejects.toMatchObject({ name: 'AbortError' })
    expect(workspace.aborted).toBe(1)
    const failed = await createLegacySessionWriter({ session: fixture.header, workspace, fileName: 'failed' })
    for (const row of fixture.rows) await failed.append(row)
    await expect(
      failed.write({
        ...output().sink,
        write: async () => {
          throw new Error('Disk full')
        },
      })
    ).rejects.toThrow('Disk full')
    expect(workspace.closedSources).toBe(1)
  })

  it('handles deeply nested alternative branches without recursive traversal', async () => {
    const header: BackupSession = { id: 'deep', name: 'Deep', activeThreadId: 'thread' }
    const writer = await createLegacySessionWriter({ session: header, workspace: new Workspace(), fileName: 'deep' })
    await writer.append({
      type: 'thread',
      thread: {
        sessionId: 'deep',
        threadId: 'thread',
        seq: -1,
        name: null,
        createdAt: 1,
        rootMessageId: 'p0',
        compactionPoints: [],
      },
    })
    const count = 3_000
    const append = (id: string, parent: string | null, child: string | null, seq: number, branchId: string | null) => {
      const row: BackupMessage = {
        sessionId: 'deep',
        threadId: 'thread',
        messageId: id,
        parentMessageId: parent,
        activeChildId: child,
        seq,
        branchId,
        kind: 'message',
        createdAt: 1,
        updatedAt: 1,
        message: message(id),
      }
      return writer.append({ type: 'message', message: row })
    }
    for (let index = 0; index < count; index++) {
      await append(`p${index}`, index ? `p${index - 1}` : null, `a${index}`, 1, index ? `saved${index - 1}` : null)
      await append(`a${index}`, `p${index}`, null, 0, `selected${index}`)
    }
    await append(`p${count}`, `p${count - 1}`, null, 1, `saved${count - 1}`)
    const result = output()
    await writer.write(result.sink)
    expect(Object.keys(result.read().messageForksHash ?? {})).toHaveLength(count)
    expect(result.read().messageForksHash?.[`p${count - 1}`].lists[1].messages[0].id).toBe(`p${count}`)
  }, 20_000)
})
