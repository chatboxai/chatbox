import { describe, expect, test } from 'vitest'
import type { SessionRows } from '../../ports/session-row-store'
import type { Message, Session } from '../../types/session'
import { diffSessionRows } from './diff'
import type { MessageRow } from './types'
import { verifySessionTreeRoundTrip } from './verify'

function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}

function linearSession(messages: Message[]): Session {
  return { id: 'session-1', name: 'Session', threadName: 'Current', messages }
}

/** A conversation with three saved branches at `u1`; `position` selects the live one. */
function forkedSession(position: number): Session {
  const branches: Message[][] = [
    [message('alt-1', 'assistant')],
    [message('a1', 'assistant')],
    [message('alt-2', 'assistant'), message('alt-2-reply')],
  ]
  return {
    ...linearSession([message('u1'), ...branches[position]]),
    messageForksHash: {
      u1: {
        position,
        createdAt: 5,
        lists: branches.map((branch, index) => ({
          id: `list-${index}`,
          messages: index === position ? [] : branch,
        })),
      },
    },
  }
}

function rowsOf(session: Session): SessionRows {
  const result = verifySessionTreeRoundTrip(session, { activeThreadId: 'thread-active', now: 1_000 })
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return { sessionId: result.tree.session.id, threads: result.tree.threads, messages: result.tree.messages }
}

/** One session's rows holding a single message row built around `payload`. */
function rowsWith(payload: Message, overrides: Partial<MessageRow>): SessionRows {
  return {
    sessionId: 'session-1',
    threads: [
      {
        sessionId: 'session-1',
        threadId: 'thread-active',
        seq: -1,
        name: 'Current',
        createdAt: 1_000,
        rootMessageId: payload.id,
        activeLeafMessageId: payload.id,
        compactionPoints: [],
      },
    ],
    messages: [
      {
        sessionId: 'session-1',
        threadId: 'thread-active',
        messageId: payload.id,
        parentMessageId: null,
        activeChildId: null,
        seq: 0,
        kind: 'message',
        status: 'settled',
        createdAt: 1_000,
        updatedAt: 1_000,
        branchId: null,
        message: payload,
        ...overrides,
      },
    ],
  }
}

function messageIds(rows: { messageId: string }[]): string[] {
  return rows.map((row) => row.messageId)
}

function threadIds(rows: { threadId: string }[]): string[] {
  return rows.map((row) => row.threadId)
}

describe('diffSessionRows', () => {
  test('upserts every row when there is no previous snapshot', () => {
    const rows = rowsOf(forkedSession(1))

    const diff = diffSessionRows(null, rows)

    expect(diff.sessionId).toBe('session-1')
    expect(diff.threads).toEqual({ upsert: rows.threads, delete: [] })
    expect(diff.messages).toEqual({ upsert: rows.messages, delete: [] })
  })

  test('produces an empty diff for an unchanged snapshot', () => {
    const diff = diffSessionRows(rowsOf(forkedSession(1)), rowsOf(forkedSession(1)))

    expect(diff).toEqual({
      sessionId: 'session-1',
      threads: { upsert: [], delete: [] },
      messages: { upsert: [], delete: [] },
    })
  })

  test('upserts only the rows an appended message touches', () => {
    const previous = rowsOf(linearSession([message('u1'), message('a1', 'assistant')]))
    const next = rowsOf(linearSession([message('u1'), message('a1', 'assistant'), message('u2')]))

    const diff = diffSessionRows(previous, next)

    expect(messageIds(diff.messages.upsert)).toEqual(['a1', 'u2'])
    expect(diff.messages.delete).toEqual([])
    expect(threadIds(diff.threads.upsert)).toEqual(['thread-active'])
  })

  test('upserts a row whose message payload changed', () => {
    const previous = rowsOf(forkedSession(1))
    const next = rowsOf({
      ...forkedSession(1),
      messages: [{ ...message('u1'), contentParts: [{ type: 'text', text: 'edited' }] }, message('a1', 'assistant')],
    })

    const diff = diffSessionRows(previous, next)

    expect(messageIds(diff.messages.upsert)).toEqual(['u1'])
    expect(diff.messages.delete).toEqual([])
    expect(diff.threads).toEqual({ upsert: [], delete: [] })
  })

  test('deletes rows that the next snapshot dropped', () => {
    const previous = rowsOf(linearSession([message('u1'), message('a1', 'assistant'), message('u2')]))
    const next = rowsOf(linearSession([message('u1'), message('a1', 'assistant')]))

    const diff = diffSessionRows(previous, next)

    expect(diff.messages.delete).toEqual(['u2'])
    expect(messageIds(diff.messages.upsert)).toEqual(['a1'])
    expect(threadIds(diff.threads.upsert)).toEqual(['thread-active'])
  })

  test('touches only the branch point and its thread row when the active branch changes', () => {
    const previous = rowsOf(forkedSession(1))
    const next = rowsOf(forkedSession(0))

    const diff = diffSessionRows(previous, next)

    expect(messageIds(diff.messages.upsert)).toEqual(['u1'])
    expect(diff.messages.delete).toEqual([])
    expect(threadIds(diff.threads.upsert)).toEqual(['thread-active'])
    expect(diff.threads.delete).toEqual([])
    expect(previous.messages.find((row) => row.messageId === 'u1')?.activeChildId).toBe('a1')
    expect(diff.messages.upsert[0].activeChildId).toBe('alt-1')
    expect(previous.threads[0].activeLeafMessageId).toBe('a1')
    expect(diff.threads.upsert[0].activeLeafMessageId).toBe('alt-1')
  })

  test('deletes a removed thread together with its messages', () => {
    const previous = rowsOf({
      ...forkedSession(1),
      threads: [{ id: 'thread-old', name: 'Earlier', createdAt: 7, messages: [message('t-u1')] }],
    })
    const next = rowsOf(forkedSession(1))

    const diff = diffSessionRows(previous, next)

    expect(diff.threads.delete).toEqual(['thread-old'])
    expect(diff.messages.delete).toEqual(['t-u1'])
    expect(diff.threads.upsert).toEqual([])
    expect(diff.messages.upsert).toEqual([])
  })

  test('compares rows that share a message object without reading its payload', () => {
    let payloadReads = 0
    const shared = message('u1')
    Object.defineProperty(shared, 'contentParts', {
      enumerable: true,
      configurable: true,
      get() {
        payloadReads += 1
        return []
      },
    })
    const previous = rowsWith(shared, { activeChildId: null })
    const next = rowsWith(shared, { activeChildId: null })

    expect(diffSessionRows(previous, next).messages).toEqual({ upsert: [], delete: [] })
    expect(payloadReads).toBe(0)
  })

  test('upserts a shared-message row whose structural fields changed', () => {
    const shared = message('u1')
    const previous = rowsWith(shared, { activeChildId: null })
    const next = rowsWith(shared, { activeChildId: 'a1' })

    const diff = diffSessionRows(previous, next)

    expect(messageIds(diff.messages.upsert)).toEqual(['u1'])
    expect(diff.messages.upsert[0].message).toBe(shared)
  })

  test('is deterministic for repeated calls on the same input', () => {
    const previous = rowsOf(forkedSession(1))
    const next = rowsOf(forkedSession(2))

    expect(diffSessionRows(previous, next)).toEqual(diffSessionRows(previous, next))
  })
})
