import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { encodeSessionTree } from './encode'
import type { SessionTree } from './types'
import { validateSessionTree } from './validate'

function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

const source: Session = {
  id: 'session-1',
  name: 'Session',
  messages: [message('u1'), summaryMessage('s1'), message('a1', 'assistant')],
  compactionPoints: [{ summaryMessageId: 's1', boundaryMessageId: 'u1', createdAt: 1 }],
  threads: [{ id: 'thread-old', name: 'Earlier', createdAt: 7, messages: [message('t-u1')] }],
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
}

function buildTree(): SessionTree {
  const result = encodeSessionTree(source, { activeThreadId: 'thread-active', now: 1_000 })
  if (!result.ok) {
    throw new Error(result.reason)
  }
  return structuredClone(result.tree)
}

function rowOf(tree: SessionTree, messageId: string) {
  const row = tree.messages.find((candidate) => candidate.messageId === messageId)
  if (!row) {
    throw new Error(`no row for ${messageId}`)
  }
  return row
}

function reasonFor(mutate: (tree: SessionTree) => void): string {
  const tree = buildTree()
  mutate(tree)
  const result = validateSessionTree(tree)
  return result.ok ? '' : result.reason
}

describe('validateSessionTree', () => {
  test('accepts an encoded tree', () => {
    expect(validateSessionTree(buildTree())).toEqual({ ok: true })
  })

  test('rejects a session whose active thread has no row', () => {
    expect(
      reasonFor((tree) => {
        tree.session.activeThreadId = 'thread-missing'
      })
    ).toBe('active thread thread-missing has no thread row')
  })

  test('rejects an active thread that is not marked with siblingOrder -1', () => {
    expect(
      reasonFor((tree) => {
        tree.threads[0].threadOrder = 2
      })
    ).toBe('active thread thread-active has siblingOrder 2, expected -1')
  })

  test('rejects threads that reuse a siblingOrder', () => {
    expect(
      reasonFor((tree) => {
        tree.threads[1].threadOrder = -1
      })
    ).toBe('thread thread-old reuses siblingOrder -1')
  })

  test('rejects duplicate message rows', () => {
    expect(reasonFor((tree) => tree.messages.push(structuredClone(tree.messages[0])))).toBe('duplicate message row u1')
  })

  test('rejects a message whose thread has no row', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 'a1').threadId = 'thread-gone'
      })
    ).toBe('message a1 references unknown thread thread-gone')
  })

  test('rejects a missing parent', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 's1').parentMessageId = 'nobody'
      })
    ).toBe('message s1 references missing parent nobody')
  })

  test('rejects a parent in another thread', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 's1').parentMessageId = 't-u1'
      })
    ).toBe('message s1 has parent t-u1 in thread thread-old')
  })

  test('rejects a parent cycle', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 'u1').parentMessageId = 'a1'
      })
    ).toBe('message u1 sits on a parent cycle')
  })

  test('rejects a message whose ancestors form a cycle it does not sit on', () => {
    expect(
      reasonFor((tree) => {
        const leaf = {
          ...structuredClone(rowOf(tree, 'a1')),
          messageId: 'leaf-x',
          parentMessageId: 'a1',
          activeChildId: null,
          siblingOrder: 99,
        }
        rowOf(tree, 'u1').parentMessageId = 'a1'
        tree.messages.unshift(leaf)
      })
    ).toBe('message leaf-x sits on a parent cycle')
  })

  test('rejects a child whose siblingOrder does not follow its parent', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 's1').siblingOrder = 0
      })
    ).toBe('message s1 has siblingOrder 0, which does not follow its parent siblingOrder 0')
  })

  test('rejects an active child that is not a child', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 'a1').activeChildId = 'alt'
      })
    ).toBe('message a1 points at active child alt, which is not one of its children')
  })

  test('rejects a thread with more than one root', () => {
    expect(
      reasonFor((tree) => {
        tree.messages.push({
          ...structuredClone(rowOf(tree, 'u1')),
          messageId: 'second-root',
          parentMessageId: null,
          activeChildId: null,
          siblingOrder: 99,
        })
      })
    ).toBe('thread thread-active has 2 roots, expected 1')
  })

  test('rejects a thread whose named root is not the root row', () => {
    expect(
      reasonFor((tree) => {
        tree.threads[0].rootMessageId = 'a1'
      })
    ).toBe('thread thread-active names root a1 but its root row is u1')
  })

  test('rejects an unreachable active leaf', () => {
    expect(
      reasonFor((tree) => {
        tree.threads[0].activeLeafMessageId = 'alt'
      })
    ).toBe('thread thread-active names active leaf alt but its active path ends at a1')
  })

  test('rejects an empty thread that names a root', () => {
    expect(
      reasonFor((tree) => {
        tree.messages = tree.messages.filter((row) => row.threadId !== 'thread-old')
      })
    ).toBe('empty thread thread-old names a root or an active leaf')
  })

  test('rejects a compaction point outside its thread', () => {
    expect(
      reasonFor((tree) => {
        tree.threads[0].compactionPoints[0].boundaryMessageId = 't-u1'
      })
    ).toBe('thread thread-active compacts at boundary t-u1, which is not one of its messages')
  })

  test('rejects a compaction point whose summary is not a summary message', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 's1').kind = 'message'
      })
    ).toBe('compaction summary s1 is not a summary message')
  })

  test('rejects rows that belong to another session', () => {
    expect(
      reasonFor((tree) => {
        rowOf(tree, 'a1').sessionId = 'session-2'
      })
    ).toBe('message a1 belongs to session session-2')
  })
})
