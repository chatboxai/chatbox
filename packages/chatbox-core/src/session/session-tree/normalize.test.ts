import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { normalizeSessionV1 } from './normalize'

function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

function makeSession(overrides: Partial<Session>): Session {
  return { id: 'session-1', name: 'Session', messages: [], ...overrides }
}

function normalize(session: Session): Session {
  const result = normalizeSessionV1(session)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.session
}

describe('normalizeSessionV1', () => {
  test('drops saved branches with no messages and shifts the active position', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: {
            position: 2,
            createdAt: 5,
            lists: [
              { id: 'list-empty', messages: [] },
              { id: 'list-saved', messages: [message('alt', 'assistant')] },
              { id: 'list-active', messages: [] },
            ],
          },
        },
      })
    )

    expect(normalized.messageForksHash?.u1).toEqual({
      position: 1,
      createdAt: 5,
      lists: [
        { id: 'list-saved', messages: [expect.objectContaining({ id: 'alt' })] },
        { id: 'list-active', messages: [] },
      ],
    })
  })

  test('drops unreachable fork entries together with their saved messages', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          orphan: {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'list-active', messages: [] },
              // An id that also exists on the visible path must not count as a duplicate.
              { id: 'list-saved', messages: [message('ghost', 'assistant'), message('a1', 'assistant')] },
            ],
          },
          ghost: {
            position: 0,
            createdAt: 6,
            lists: [
              { id: 'nested-active', messages: [] },
              { id: 'nested-saved', messages: [message('nested', 'user')] },
            ],
          },
        },
      })
    )

    expect(normalized.messages.map((item) => item.id)).toEqual(['u1', 'a1'])
    expect(normalized).not.toHaveProperty('messageForksHash')
  })

  test('drops empty fork entries whose pivot is unreachable', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1')],
        messageForksHash: {
          orphan: {
            position: 0,
            createdAt: 5,
            lists: [{ id: 'list-active', messages: [] }],
          },
        },
      })
    )

    expect(normalized.messageForksHash).toBeUndefined()
  })

  test('drops fork entries that leave nothing to switch between', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: { position: 0, createdAt: 5, lists: [{ id: 'list-active', messages: [] }] },
        },
      })
    )

    expect(normalized.messageForksHash).toBeUndefined()
  })

  test('moves an empty active branch to the end of the branch list', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1')],
        messageForksHash: {
          u1: {
            position: 1,
            createdAt: 5,
            lists: [
              { id: 'list-a', messages: [message('alt-a', 'assistant')] },
              { id: 'list-active', messages: [] },
              { id: 'list-b', messages: [message('alt-b', 'assistant')] },
            ],
          },
        },
      })
    )

    expect(normalized.messageForksHash?.u1.position).toBe(2)
    expect(normalized.messageForksHash?.u1.lists.map((list) => list.id)).toEqual(['list-a', 'list-b', 'list-active'])
  })

  test('drops compaction points that no longer describe a summary in their thread', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), summaryMessage('s1')],
        compactionPoints: [
          { summaryMessageId: 's1', boundaryMessageId: 'u1', createdAt: 1 },
          { summaryMessageId: 'u1', boundaryMessageId: 'u1', createdAt: 2 },
          { summaryMessageId: 's1', boundaryMessageId: 'gone', createdAt: 3 },
        ],
      })
    )

    expect(normalized.compactionPoints).toEqual([{ summaryMessageId: 's1', boundaryMessageId: 'u1', createdAt: 1 }])
  })

  test('reduces empty optional containers to absent while preserving an explicit empty thread name', () => {
    const normalized = normalize(
      makeSession({ messages: [], threads: [], threadName: '', messageForksHash: {}, compactionPoints: [] })
    )

    expect(normalized).toEqual({ id: 'session-1', name: 'Session', messages: [], threadName: '' })
  })

  test('gives a later duplicate message id a derived id', () => {
    const normalized = normalize(makeSession({ messages: [message('u1'), message('u1')] }))
    expect(normalized.messages.map((item) => item.id)).toEqual(['u1', 'u1~dup'])
  })

  test('moves a fork pivoted on a summary to the preceding message', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), summaryMessage('s1'), message('a1', 'assistant')],
        messageForksHash: {
          s1: {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'list-active', messages: [] },
              { id: 'list-saved', messages: [message('alt', 'assistant')] },
            ],
          },
        },
      })
    )
    expect(normalized.messages.map((item) => item.id)).toEqual(['u1', 's1', 'a1'])
    expect(Object.keys(normalized.messageForksHash ?? {})).toEqual(['u1'])
    expect(normalized.messageForksHash?.u1).toMatchObject({
      position: 0,
      lists: [{ id: 'list-active' }, { id: 'list-saved' }],
    })
  })

  test('points an out-of-range position at the empty placeholder', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: {
            position: 3,
            createdAt: 5,
            lists: [
              { id: 'list-saved', messages: [message('alt', 'assistant')] },
              { id: 'list-active', messages: [] },
            ],
          },
        },
      })
    )
    expect(normalized.messageForksHash?.u1).toMatchObject({ position: 1 })
    expect(normalized.messages.map((item) => item.id)).toEqual(['u1', 'a1'])
  })

  test('moves messages stored in the active branch placeholder to a saved branch', () => {
    const normalized = normalize(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'list-active', messages: [message('stranded', 'assistant')] },
              { id: 'list-saved', messages: [message('alt', 'assistant')] },
            ],
          },
        },
      })
    )
    expect(normalized.messages.map((item) => item.id)).toEqual(['u1', 'a1'])
    expect(normalized.messageForksHash?.u1).toMatchObject({
      position: 0,
      lists: [
        { id: 'list-active', messages: [] },
        { id: 'list-saved', messages: [expect.objectContaining({ id: 'alt' })] },
        { id: 'u1~residual', messages: [expect.objectContaining({ id: 'stranded' })] },
      ],
    })
  })

  test('is idempotent', () => {
    const session = makeSession({
      messages: [message('u1'), message('a1', 'assistant')],
      threads: [{ id: 'thread-old', name: 'Earlier', createdAt: 7, messages: [message('t-u1')] }],
      messageForksHash: {
        u1: {
          position: 2,
          createdAt: 5,
          lists: [
            { id: 'list-empty', messages: [] },
            { id: 'list-saved', messages: [message('alt', 'assistant')] },
            { id: 'list-active', messages: [] },
          ],
        },
      },
    })

    const once = normalize(session)
    expect(normalize(once)).toEqual(once)
  })
})
