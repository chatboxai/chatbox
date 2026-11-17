import { describe, expect, it, vi } from 'vitest'
import { SessionRowConflictError } from '../ports/session-row-store'
import { DEFAULT_TRANSCRIPT_PAGE_BYTES } from '../ports/session-transcript-source'
import { transcriptFixture } from '../ports/testing/session-transcript-contract'
import type { MessageRow } from '../session/session-tree/types'
import { readBranchMessagesPage } from './session-branch-reader'
import { transcriptThread, type TranscriptMessageMetadata } from './session-transcript-read'

function fixture(sizes: number[]) {
  const snapshot = transcriptFixture()
  const inactive = snapshot.rows.messages.find((row) => row.messageId === 'inactive')!
  const bodies = new Map<string, MessageRow>()
  const metadata = new Map<string, TranscriptMessageMetadata>()
  for (const [index, payloadBytes] of sizes.entries()) {
    const messageId = `branch-${index}`
    const row: MessageRow = {
      ...inactive,
      messageId,
      parentMessageId: index ? `branch-${index - 1}` : inactive.parentMessageId,
      activeChildId: index + 1 < sizes.length ? `branch-${index + 1}` : null,
      message: { id: messageId, role: 'assistant', contentParts: [] },
    }
    bodies.set(messageId, row)
    const { message: _message, ...relation } = row
    metadata.set(messageId, { ...relation, selected: false, payloadBytes })
  }
  const reader = {
    thread: vi.fn(async (id: string) => {
      const thread = snapshot.rows.threads.find((item) => item.threadId === id)
      return thread ? transcriptThread(thread) : null
    }),
    message: vi.fn(async (id: string) => metadata.get(id) ?? null),
    payloads: vi.fn(async (ids: string[]) => ids.map((id) => bodies.get(id)!)),
  }
  const commit = { record: snapshot.record, revision: 1 }
  return { reader, commit, metadata, bodies }
}

describe('bounded branch body reads', () => {
  it.each([20, 50])('pages an inactive local path at host limit %s', async (limit) => {
    const { reader, commit } = fixture(Array.from({ length: limit + 2 }, () => 1))
    const request = { sessionId: 'transcript', firstMessageId: 'branch-0', limit }
    const first = await readBranchMessagesPage(request, commit, reader)
    expect(first.messages).toHaveLength(limit)
    expect(first.nextCursor?.messageId).toBe(`branch-${limit - 1}`)
    const second = await readBranchMessagesPage({ ...request, cursor: first.nextCursor! }, commit, reader)
    expect(second.messages.map((row) => row.messageId)).toEqual([`branch-${limit}`, `branch-${limit + 1}`])
    expect(second.nextCursor).toBeNull()
    expect(reader.payloads.mock.calls.map(([ids]) => ids.length)).toEqual([limit, 2])
    expect(Object.hasOwn(first, 'textTokens')).toBe(false)
  })

  it('uses metadata to stop before hydrating a row beyond the byte budget', async () => {
    const { reader, commit } = fixture([6, 5, 4])
    const request = { sessionId: 'transcript', firstMessageId: 'branch-0', limit: 50, maxBytes: 10 }
    const first = await readBranchMessagesPage(request, commit, reader)
    expect(first.payloadBytes).toBe(6)
    expect(reader.payloads).toHaveBeenLastCalledWith(['branch-0'])
    const second = await readBranchMessagesPage({ ...request, cursor: first.nextCursor! }, commit, reader)
    expect(second.messages.map((row) => row.messageId)).toEqual(['branch-1', 'branch-2'])
    expect(second.payloadBytes).toBe(9)
    expect(second.nextCursor).toBeNull()
  })

  it('reads an oversized message alone and continues from the consumed row', async () => {
    const { reader, commit } = fixture([DEFAULT_TRANSCRIPT_PAGE_BYTES + 1, 10])
    const request = { sessionId: 'transcript', firstMessageId: 'branch-0', limit: 20 }
    const first = await readBranchMessagesPage(request, commit, reader)
    expect(first.messages).toHaveLength(1)
    expect(first.payloadBytes).toBe(DEFAULT_TRANSCRIPT_PAGE_BYTES + 1)
    const second = await readBranchMessagesPage({ ...request, cursor: first.nextCursor! }, commit, reader)
    expect(second.messages.map((row) => row.messageId)).toEqual(['branch-1'])
    expect(reader.payloads.mock.calls).toEqual([[['branch-0']], [['branch-1']]])
  })

  it('rejects stale revision and cursor scope changes before reading metadata', async () => {
    const { reader, commit } = fixture([1, 1])
    const request = { sessionId: 'transcript', firstMessageId: 'branch-0', limit: 1 }
    const first = await readBranchMessagesPage(request, commit, reader)
    reader.message.mockClear()
    await expect(
      readBranchMessagesPage({ ...request, cursor: first.nextCursor! }, { ...commit, revision: 2 }, reader)
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    for (const change of [{ limit: 2 }, { maxBytes: 5 }, { firstMessageId: 'branch-1' }, { sessionId: 'other' }]) {
      await expect(
        readBranchMessagesPage({ ...request, ...change, cursor: first.nextCursor! }, commit, reader)
      ).rejects.toThrow('Branch cursor does not match')
    }
    expect(reader.message).not.toHaveBeenCalled()
  })

  it.each(['parent', 'thread', 'cycle'] as const)('rejects %s corruption without hydrating a page', async (kind) => {
    const { reader, commit, metadata } = fixture([1, 1])
    if (kind === 'parent') metadata.get('branch-1')!.parentMessageId = 'unrelated'
    if (kind === 'thread') metadata.get('branch-1')!.threadId = 'active'
    if (kind === 'cycle') metadata.get('branch-1')!.activeChildId = 'branch-0'
    await expect(
      readBranchMessagesPage({ sessionId: 'transcript', firstMessageId: 'branch-0', limit: 20 }, commit, reader)
    ).rejects.toThrow()
    expect(reader.payloads).not.toHaveBeenCalled()
  })

  it('rejects missing, reordered, or foreign body results', async () => {
    for (const kind of ['missing', 'reordered', 'foreign'] as const) {
      const { reader, commit, bodies } = fixture([1, 1])
      const rows = [...bodies.values()]
      reader.payloads.mockResolvedValue(
        kind === 'missing' ? [] : kind === 'reordered' ? rows.reverse() : [{ ...rows[0], threadId: 'active' }, rows[1]]
      )
      await expect(
        readBranchMessagesPage({ sessionId: 'transcript', firstMessageId: 'branch-0', limit: 20 }, commit, reader)
      ).rejects.toThrow('Branch payload selection is incomplete')
    }
  })
})
