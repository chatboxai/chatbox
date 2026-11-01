import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { encodeSessionTree } from './encode'
import type { MessageRow, SessionTree } from './types'

function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

function makeSession(overrides: Partial<Session>): Session {
  return { id: 'session-1', name: 'Session', messages: [], ...overrides }
}

function encode(session: Session): SessionTree {
  const result = encodeSessionTree(session, { activeThreadId: 'thread-active', now: 1_000 })
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return result.tree
}

function structure(tree: SessionTree, threadId = 'thread-active') {
  return tree.messages
    .filter((row) => row.threadId === threadId)
    .map((row) => ({
      id: row.messageId,
      parent: row.parentMessageId,
      active: row.activeChildId,
      siblingOrder: row.siblingOrder,
      branch: row.branchId,
    }))
}

function row(tree: SessionTree, messageId: string): MessageRow {
  const found = tree.messages.find((candidate) => candidate.messageId === messageId)
  if (!found) {
    throw new Error(`no row for ${messageId}`)
  }
  return found
}

describe('encodeSessionTree', () => {
  test('maps a linear conversation onto a single chain', () => {
    const tree = encode(
      makeSession({
        threadName: 'Current',
        messages: [message('u1'), message('a1', 'assistant'), message('u2'), message('a2', 'assistant')],
      })
    )

    expect(structure(tree)).toEqual([
      { id: 'u1', parent: null, active: 'a1', siblingOrder: 0, branch: null },
      { id: 'a1', parent: 'u1', active: 'u2', siblingOrder: 1, branch: null },
      { id: 'u2', parent: 'a1', active: 'a2', siblingOrder: 2, branch: null },
      { id: 'a2', parent: 'u2', active: null, siblingOrder: 3, branch: null },
    ])
    expect(tree.threads).toEqual([
      {
        sessionId: 'session-1',
        threadId: 'thread-active',
        threadOrder: -1,
        name: 'Current',
        createdAt: 0,
        rootMessageId: 'u1',
        activeLeafMessageId: 'a2',
        compactionPoints: [],
      },
    ])
    expect(tree.session).toMatchObject({ id: 'session-1', activeThreadId: 'thread-active', storageFormat: 'rows' })
    expect(tree.session).not.toHaveProperty('messages')
    expect(tree.session).not.toHaveProperty('threadName')
  })

  test('derives kind, status and timestamps from the message', () => {
    const tree = encode(
      makeSession({
        messages: [
          { ...message('u1'), timestamp: 10, updatedAt: 20 },
          { ...summaryMessage('s1'), timestamp: 30 },
          { ...message('a1', 'assistant'), generating: true },
        ],
      })
    )

    expect(row(tree, 'u1')).toMatchObject({ kind: 'message', status: 'settled', createdAt: 10, updatedAt: 20 })
    expect(row(tree, 's1')).toMatchObject({ kind: 'summary', status: 'settled', createdAt: 30, updatedAt: 30 })
    expect(row(tree, 'a1')).toMatchObject({ kind: 'message', status: 'generating', createdAt: 0, updatedAt: 0 })
  })

  test('uses a stable sentinel for legacy messages without timestamps', () => {
    const session = makeSession({ messages: [message('legacy')] })
    const first = encodeSessionTree(session, { activeThreadId: 'thread-active', now: 1_000 })
    const second = encodeSessionTree(session, { activeThreadId: 'thread-active', now: 2_000 })
    if (!first.ok || !second.ok) throw new Error('session did not encode')

    expect(first.tree.messages[0]).toMatchObject({ createdAt: 0, updatedAt: 0 })
    expect(second.tree.messages[0]).toMatchObject({ createdAt: 0, updatedAt: 0 })
    expect(second.tree.threads[0].createdAt).toBe(0)
  })

  test('turns saved branches into siblings, with the active branch at its list position', () => {
    const tree = encode(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: {
            position: 1,
            createdAt: 5,
            lists: [
              { id: 'list-first', messages: [message('alt-1', 'assistant')] },
              { id: 'list-active', messages: [] },
              { id: 'list-last', messages: [message('alt-2', 'assistant'), message('alt-2-reply')] },
            ],
          },
        },
      })
    )

    expect(structure(tree)).toEqual([
      { id: 'u1', parent: null, active: 'a1', siblingOrder: 0, branch: null },
      { id: 'alt-1', parent: 'u1', active: null, siblingOrder: 1, branch: 'list-first' },
      { id: 'a1', parent: 'u1', active: null, siblingOrder: 2, branch: 'list-active' },
      { id: 'alt-2', parent: 'u1', active: 'alt-2-reply', siblingOrder: 3, branch: 'list-last' },
      { id: 'alt-2-reply', parent: 'alt-2', active: null, siblingOrder: 4, branch: null },
    ])
    expect(tree.threads[0].activeLeafMessageId).toBe('a1')
  })

  test('nests a fork whose pivot lives inside a saved branch', () => {
    const tree = encode(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'outer-active', messages: [] },
              { id: 'outer-saved', messages: [message('inner-pivot', 'assistant'), message('inner-tail')] },
            ],
          },
          'inner-pivot': {
            position: 1,
            createdAt: 6,
            lists: [
              { id: 'inner-saved', messages: [message('inner-alt')] },
              { id: 'inner-active', messages: [] },
            ],
          },
        },
      })
    )

    expect(structure(tree)).toEqual([
      { id: 'u1', parent: null, active: 'a1', siblingOrder: 0, branch: null },
      { id: 'a1', parent: 'u1', active: null, siblingOrder: 1, branch: 'outer-active' },
      { id: 'inner-pivot', parent: 'u1', active: 'inner-tail', siblingOrder: 2, branch: 'outer-saved' },
      { id: 'inner-alt', parent: 'inner-pivot', active: null, siblingOrder: 3, branch: 'inner-saved' },
      { id: 'inner-tail', parent: 'inner-pivot', active: null, siblingOrder: 4, branch: 'inner-active' },
    ])
  })

  test('encodes forks that live inside an archived thread', () => {
    const tree = encode(
      makeSession({
        messages: [],
        threads: [
          {
            id: 'thread-old',
            name: 'Earlier',
            createdAt: 7,
            messages: [message('t-u1'), message('t-a1', 'assistant')],
          },
        ],
        messageForksHash: {
          't-u1': {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'thread-active-branch', messages: [] },
              { id: 'thread-saved-branch', messages: [message('t-alt', 'assistant')] },
            ],
          },
        },
      })
    )

    expect(structure(tree, 'thread-old')).toEqual([
      { id: 't-u1', parent: null, active: 't-a1', siblingOrder: 0, branch: null },
      { id: 't-a1', parent: 't-u1', active: null, siblingOrder: 1, branch: 'thread-active-branch' },
      { id: 't-alt', parent: 't-u1', active: null, siblingOrder: 2, branch: 'thread-saved-branch' },
    ])
    expect(tree.threads.map((thread) => [thread.threadId, thread.threadOrder, thread.rootMessageId])).toEqual([
      ['thread-active', -1, null],
      ['thread-old', 0, 't-u1'],
    ])
  })

  test('keeps summaries anchored to a pivot in the shared prefix', () => {
    const tree = encode(
      makeSession({
        messages: [message('u1'), summaryMessage('s1'), message('a1', 'assistant')],
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

    expect(structure(tree)).toEqual([
      { id: 'u1', parent: null, active: 's1', siblingOrder: 0, branch: null },
      { id: 's1', parent: 'u1', active: 'a1', siblingOrder: 1, branch: null },
      { id: 'a1', parent: 's1', active: null, siblingOrder: 2, branch: 'list-active' },
      { id: 'alt', parent: 's1', active: null, siblingOrder: 3, branch: 'list-saved' },
    ])
  })

  test('keeps a summary inside a branch tail as an ordinary chain node', () => {
    const tree = encode(
      makeSession({
        messages: [message('u1'), message('a1', 'assistant')],
        messageForksHash: {
          u1: {
            position: 0,
            createdAt: 5,
            lists: [
              { id: 'list-active', messages: [] },
              { id: 'list-saved', messages: [message('alt', 'assistant'), summaryMessage('alt-s'), message('alt-u')] },
            ],
          },
        },
      })
    )

    expect(structure(tree)).toEqual([
      { id: 'u1', parent: null, active: 'a1', siblingOrder: 0, branch: null },
      { id: 'a1', parent: 'u1', active: null, siblingOrder: 1, branch: 'list-active' },
      { id: 'alt', parent: 'u1', active: 'alt-s', siblingOrder: 2, branch: 'list-saved' },
      { id: 'alt-s', parent: 'alt', active: 'alt-u', siblingOrder: 3, branch: null },
      { id: 'alt-u', parent: 'alt-s', active: null, siblingOrder: 4, branch: null },
    ])
    expect(row(tree, 'alt-s').kind).toBe('summary')
  })

  test('leaves the branch point without an active child when the selected branch is empty', () => {
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

    expect(structure(tree)).toEqual([
      { id: 'u1', parent: null, active: null, siblingOrder: 0, branch: null },
      { id: 'alt', parent: 'u1', active: null, siblingOrder: 1, branch: 'list-saved' },
    ])
    expect(tree.threads[0].activeLeafMessageId).toBe('u1')
  })

  test('emits an empty active thread row alongside archived threads', () => {
    const tree = encode(
      makeSession({
        messages: [],
        threads: [{ id: 'thread-old', name: 'Earlier', createdAt: 7, messages: [message('t-u1')] }],
      })
    )

    expect(tree.threads[0]).toMatchObject({
      threadId: 'thread-active',
      threadOrder: -1,
      name: null,
      createdAt: 1_000,
      rootMessageId: null,
      activeLeafMessageId: null,
    })
    expect(structure(tree, 'thread-old')).toEqual([
      { id: 't-u1', parent: null, active: null, siblingOrder: 0, branch: null },
    ])
  })

  test('keeps an explicit empty active thread name distinct from a missing name', () => {
    expect(encode(makeSession({ threadName: '' })).threads[0].name).toBe('')
    expect(encode(makeSession({})).threads[0].name).toBeNull()
  })

  test('rejects an archived thread id that collides with the active thread id', () => {
    const result = encodeSessionTree(
      makeSession({ threads: [{ id: 'thread-active', name: 'Earlier', createdAt: 7, messages: [] }] }),
      { activeThreadId: 'thread-active', now: 1_000 }
    )

    expect(result).toEqual({
      ok: false,
      reason: 'archived thread thread-active collides with the active thread id',
    })
  })
})
