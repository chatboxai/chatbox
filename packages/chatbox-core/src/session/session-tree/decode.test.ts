import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { decodeSessionTree } from './decode'
import { encodeSessionTree } from './encode'
import type { SessionTree } from './types'

function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}

function makeSession(overrides: Partial<Session>): Session {
  return { id: 'session-1', name: 'Session', messages: [], ...overrides }
}

function encode(session: Session): SessionTree {
  const result = encodeSessionTree(session, { activeThreadId: 'thread-active', now: 1_000 })
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return structuredClone(result.tree)
}

function decode(tree: SessionTree): Session {
  const result = decodeSessionTree(tree)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.session
}

const forkedSession = makeSession({
  messages: [message('u1'), message('a1', 'assistant')],
  messageForksHash: {
    u1: {
      position: 0,
      createdAt: 5,
      lists: [
        { id: 'list-active', messages: [] },
        { id: 'list-saved', messages: [message('alt', 'assistant')] },
      ],
    },
  },
})

describe('decodeSessionTree', () => {
  test('keeps an explicit empty active thread name distinct from a missing name', () => {
    expect(decode(encode(makeSession({ threadName: '' })))).toHaveProperty('threadName', '')
    expect(decode(encode(makeSession({})))).not.toHaveProperty('threadName')
  })

  test('rebuilds the active path and the saved branches', () => {
    const decoded = decode(encode(forkedSession))

    expect(decoded.messages.map((entry) => entry.id)).toEqual(['u1', 'a1'])
    expect(decoded.messageForksHash?.u1.position).toBe(0)
    expect(decoded.messageForksHash?.u1.lists.map((list) => [list.id, list.messages.map((m) => m.id)])).toEqual([
      ['list-active', []],
      ['list-saved', ['alt']],
    ])
  })

  test('preserves the fork creation time carried by the session record', () => {
    const tree = encode(forkedSession)
    for (const row of tree.messages) {
      row.createdAt = row.messageId === 'alt' ? 40 : 90
    }

    expect(decode(tree).messageForksHash?.u1.createdAt).toBe(5)
  })

  test('derives the fork creation time when reading an older row record', () => {
    const tree = encode(forkedSession)
    delete tree.session.forkCreatedAt
    for (const row of tree.messages) {
      row.createdAt = row.messageId === 'alt' ? 40 : 90
    }

    expect(decode(tree).messageForksHash?.u1.createdAt).toBe(40)
  })

  test('generates branch ids for heads that carry none and for the empty branch', () => {
    const tree = encode(
      makeSession({
        messages: [message('u1')],
        messageForksHash: {
          u1: {
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
    for (const row of tree.messages) {
      row.branchId = null
    }

    expect(decode(tree).messageForksHash?.u1).toMatchObject({
      position: 1,
      lists: [{ id: 'fork_list_alt' }, { id: 'fork_list_empty_u1', messages: [] }],
    })
  })

  test('reports a thread whose active leaf disagrees with its rows', () => {
    const tree = encode(forkedSession)
    tree.threads[0].activeLeafMessageId = 'alt'

    expect(decodeSessionTree(tree)).toEqual({
      ok: false,
      reason: 'thread thread-active names active leaf alt but its active path ends at a1',
    })
  })

  test('reports rows that no thread can reach', () => {
    const tree = encode(forkedSession)
    tree.messages.push({ ...tree.messages[0], messageId: 'detached', parentMessageId: null, activeChildId: null })

    expect(decodeSessionTree(tree)).toEqual({
      ok: false,
      reason: '1 message rows are unreachable from their thread',
    })
  })

  test('reports a branch point with no non-summary ancestor', () => {
    const tree = encode(forkedSession)
    for (const row of tree.messages) {
      if (row.messageId === 'u1') {
        row.kind = 'summary'
      }
    }

    expect(decodeSessionTree(tree)).toEqual({
      ok: false,
      reason: 'branch point u1 has no non-summary ancestor',
    })
  })

  test('reports a missing active thread row', () => {
    const tree = encode(forkedSession)
    tree.session.activeThreadId = 'thread-missing'

    expect(decodeSessionTree(tree)).toEqual({
      ok: false,
      reason: 'active thread thread-missing has no thread row',
    })
  })
})
