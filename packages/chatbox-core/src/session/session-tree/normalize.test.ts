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

  test('rejects unreachable fork entries that still own messages', () => {
    const result = normalizeSessionV1(
      makeSession({
        messages: [message('u1')],
        messageForksHash: {
          orphan: {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'list-active', messages: [] },
              { id: 'list-saved', messages: [message('ghost', 'assistant')] },
            ],
          },
        },
      })
    )

    expect(result).toEqual({ ok: false, reason: 'unreachable fork orphan contains messages' })
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

  test('reports duplicate message ids', () => {
    expect(normalizeSessionV1(makeSession({ messages: [message('u1'), message('u1')] }))).toEqual({
      ok: false,
      reason: 'duplicate message id u1',
    })
  })

  test('reports a fork pivoted on a summary message', () => {
    expect(
      normalizeSessionV1(
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
    ).toEqual({ ok: false, reason: 'fork pivot s1 is a summary message' })
  })

  test('reports an out-of-range active position', () => {
    expect(
      normalizeSessionV1(
        makeSession({
          messages: [message('u1')],
          messageForksHash: {
            u1: { position: 3, createdAt: 5, lists: [{ id: 'list-active', messages: [] }] },
          },
        })
      )
    ).toEqual({ ok: false, reason: 'fork u1 has out-of-range position 3' })
  })

  test('reports an active branch that stores messages', () => {
    expect(
      normalizeSessionV1(
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
    ).toEqual({ ok: false, reason: 'fork u1 stores messages in its active branch' })
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
