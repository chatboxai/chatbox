import { describe, expect, test } from 'vitest'
import { getReachableSessionMessages } from '../../session/generation-state'
import { buildSaveAndResendForkPatch, buildSwitchForkToPatch } from '../../session/message-forks'
import { decodeSessionTree, verifySessionTreeRoundTrip } from '../../session/session-tree'
import type { Message, Session } from '../../types/session'
import { applyMessageRemoval } from './message-tree'

function message(id: string, role: Message['role'] = 'assistant'): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }] }
}

function fork(position: number, ...branches: string[][]): NonNullable<Session['messageForksHash']>[string] {
  return {
    position,
    createdAt: 1,
    lists: branches.map((ids, index) => ({ id: `branch-${index}`, messages: ids.map((id) => message(id)) })),
  }
}

function remove(session: Session, id: string): Session {
  const before = structuredClone(session)
  const updated = applyMessageRemoval(session, session.id, id, () => 'new-root')
  expect(session).toEqual(before)
  const expectedMessages = getReachableSessionMessages(session).filter((entry) => entry.id !== id)
  const actualMessages = getReachableSessionMessages(updated).filter((entry) => entry.id !== 'new-root')
  expect(actualMessages.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    expectedMessages.sort((a, b) => a.id.localeCompare(b.id))
  )
  const result = verifySessionTreeRoundTrip(updated, { activeThreadId: 'active-thread', now: 1 })
  expect(result.ok, result.ok ? '' : result.reason).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  const decoded = decodeSessionTree(result.tree)
  if (!decoded.ok) throw new Error(decoded.reason)
  return decoded.session
}

function switchTo(session: Session, pivot: string, position: number): Session {
  const patch = buildSwitchForkToPatch(session, pivot, position)
  expect(patch).not.toBeNull()
  return { ...session, ...patch }
}

function ids(session: Session): string[] {
  return session.messages.map(({ id }) => id)
}

function issueSession(): Session {
  return {
    id: 'issue-3918',
    name: 'Message deletion',
    messages: [message('1', 'user'), message('2'), message('5', 'user'), message('6')],
    messageForksHash: { '2': fork(1, ['3', '4'], []) },
  }
}

describe('applyMessageRemoval', () => {
  test('keeps both Save & Resend branches switchable after deleting their predecessor and reloading', () => {
    const initial: Session = {
      id: 'issue-3918',
      name: 'Message deletion',
      messages: [message('1', 'user'), message('2'), message('3', 'user'), message('4')],
    }
    let sequence = 0
    const patch = buildSaveAndResendForkPatch(initial, '3', message('5', 'user'), {
      createId: () => `id-${++sequence}`,
      now: () => 1,
    })
    const edited = { ...initial, ...patch }
    edited.messages = [...edited.messages, message('6')]
    const updated = remove(edited, '2')
    expect(ids(updated)).toEqual(['1', '5', '6'])
    expect(updated.messageForksHash?.['2']).toBeUndefined()
    expect(ids(switchTo(updated, '1', 0))).toEqual(['1', '3', '4'])
    expect(ids(switchTo(switchTo(updated, '1', 0), '1', 1))).toEqual(['1', '5', '6'])
  })

  test('merges into the parent alongside its existing alternatives and preserves nested forks', () => {
    const session = issueSession()
    session.messageForksHash = {
      ...session.messageForksHash,
      '1': fork(1, ['before'], [], ['after']),
      '3': fork(0, [], ['nested']),
    }
    const updated = remove(session, '2')
    expect(updated.messageForksHash?.['1'].position).toBe(2)
    expect(ids(switchTo(updated, '1', 0))).toEqual(['1', 'before'])
    const old = switchTo(updated, '1', 1)
    expect(ids(old)).toEqual(['1', '3', '4'])
    expect(ids(switchTo(old, '3', 1))).toEqual(['1', '3', 'nested'])
    expect(ids(switchTo(updated, '1', 3))).toEqual(['1', 'after'])
  })

  test.each([0, 2])('promotes a pivot at the head of saved branch %i without switching the active branch', (index) => {
    const branches = [['left'], [], ['right']]
    branches[index] = ['2', '5', '6']
    const session: Session = {
      ...issueSession(),
      messages: [message('1'), message('active')],
      messageForksHash: { '1': fork(1, ...branches), '2': fork(1, ['3', '4'], []) },
    }
    const updated = remove(session, '2')
    expect(ids(updated)).toEqual(['1', 'active'])
    expect(updated.messageForksHash?.['1'].position).toBe(index === 0 ? 2 : 1)
    expect(ids(switchTo(updated, '1', index))).toEqual(['1', '3', '4'])
    expect(ids(switchTo(updated, '1', index + 1))).toEqual(['1', '5', '6'])
  })

  test('promotes a pivot within a saved branch to its local predecessor', () => {
    const session: Session = {
      ...issueSession(),
      messages: [message('root'), message('active')],
      messageForksHash: { root: fork(0, [], ['1', '2', '5', '6']), '2': fork(1, ['3', '4'], []) },
    }
    const updated = remove(session, '2')
    const saved = switchTo(updated, 'root', 1)
    expect(ids(saved)).toEqual(['root', '1', '5', '6'])
    expect(ids(switchTo(saved, '1', 0))).toEqual(['root', '1', '3', '4'])
  })

  test('preserves branches in archived threads', () => {
    const session = issueSession()
    session.threads = [{ id: 'archived', name: 'Earlier', createdAt: 1, messages: session.messages }]
    session.messages = [message('current')]
    const updated = remove(session, '2')
    expect(ids(updated)).toEqual(['current'])
    expect(updated.threads?.[0].messages.map(({ id }) => id)).toEqual(['1', '5', '6'])
    expect(switchTo(updated, '1', 0).threads?.[0].messages.map(({ id }) => id)).toEqual(['1', '3', '4'])
  })

  test('keeps root alternatives reachable through an empty system message', () => {
    const session = issueSession()
    session.messages = session.messages.slice(1)
    const updated = remove(session, '2')
    expect(updated.messages[0]).toEqual({ id: 'new-root', role: 'system', contentParts: [] })
    expect(ids(updated)).toEqual(['new-root', '5', '6'])
    expect(ids(switchTo(updated, 'new-root', 0))).toEqual(['new-root', '3', '4'])
  })

  test('keeps anchored summaries scoped to their subtree when the parent has other branches', () => {
    const session = issueSession()
    const summary = { ...message('summary'), isSummary: true }
    session.messages.splice(2, 0, summary)
    session.compactionPoints = [{ summaryMessageId: 'summary', boundaryMessageId: '2', createdAt: 1 }]
    session.messageForksHash = { ...session.messageForksHash, '1': fork(0, [], ['other']) }
    const updated = remove(session, '2')
    expect(ids(updated)).toEqual(['1', 'new-root', 'summary', '5', '6'])
    expect(updated.compactionPoints?.[0].boundaryMessageId).toBe('new-root')
    expect(ids(switchTo(updated, 'new-root', 0))).toEqual(['1', 'new-root', 'summary', '3', '4'])
    expect(ids(switchTo(updated, '1', 1))).toEqual(['1', 'other'])
  })

  test('keeps a summary anchor inside a saved branch', () => {
    const session: Session = {
      ...issueSession(),
      messages: [message('root'), message('active')],
      messageForksHash: { root: fork(0, [], ['2', 'summary', '5', '6']), '2': fork(1, ['3', '4'], []) },
    }
    const savedSummary = session.messageForksHash?.root.lists[1].messages[1]
    if (savedSummary) savedSummary.isSummary = true
    const updated = remove(session, '2')
    const saved = switchTo(updated, 'root', 1)
    expect(ids(saved)).toEqual(['root', 'new-root', 'summary', '5', '6'])
    expect(ids(switchTo(saved, 'new-root', 0))).toEqual(['root', 'new-root', 'summary', '3', '4'])
  })

  test.each(['active', 'archived', 'saved'] as const)(
    'loads a remaining branch when deleting the last active reply in %s',
    (container) => {
      const session: Session = {
        id: 'session',
        name: 'Delete reply',
        messages: [message('pivot'), message('reply')],
        messageForksHash: { pivot: fork(0, [], ['other']) },
      }
      if (container === 'archived') {
        session.threads = [{ id: 'archived', name: 'Earlier', createdAt: 1, messages: session.messages }]
        session.messages = [message('current')]
      } else if (container === 'saved') {
        session.messageForksHash = { ...session.messageForksHash, root: fork(0, [], ['pivot', 'reply']) }
        session.messages = [message('root'), message('current')]
      }
      const updated = remove(session, 'reply')
      expect(updated.messageForksHash?.pivot).toBeUndefined()
      const messages =
        container === 'active'
          ? updated.messages
          : container === 'archived'
            ? updated.threads?.[0].messages
            : updated.messageForksHash?.root.lists[1].messages
      expect(messages?.map(({ id }) => id)).toEqual(['pivot', 'other'])
    }
  )

  test('drops an empty saved branch and keeps the active selection', () => {
    const session: Session = {
      id: 'session',
      name: 'Delete saved reply',
      messages: [message('pivot'), message('active')],
      messageForksHash: { pivot: fork(1, ['reply'], [], ['other']) },
    }
    const updated = remove(session, 'reply')
    expect(ids(updated)).toEqual(['pivot', 'active'])
    expect(updated.messageForksHash?.pivot.position).toBe(0)
    expect(ids(switchTo(updated, 'pivot', 1))).toEqual(['pivot', 'other'])
  })

  test('deletes a summary while retaining its pivot and alternatives', () => {
    const session = issueSession()
    session.messages.splice(2, 0, { ...message('summary'), isSummary: true })
    session.compactionPoints = [{ summaryMessageId: 'summary', boundaryMessageId: '2', createdAt: 1 }]
    const updated = remove(session, 'summary')
    expect(updated.compactionPoints).toBeUndefined()
    expect(ids(switchTo(updated, '2', 0))).toEqual(['1', '2', '3', '4'])
  })
})
