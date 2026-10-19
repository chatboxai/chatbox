import { describe, expect, it } from 'vitest'
import { decodeSessionTree, validateSessionTree, verifySessionTreeRoundTrip } from '../../../session/session-tree'
import type { Message, Session } from '../../../types/session'
import { convertLegacyTreeToRowFormat } from './row-format'

const message = (id: string, role: Message['role'] = 'assistant'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
})

function converted(empty = false) {
  const session: Session = {
    id: 'session',
    type: 'chat',
    name: 'Branches',
    messages: [
      message('user', 'user'),
      { ...message('summary'), isSummary: true },
      ...(!empty ? [message('active')] : []),
    ],
    threads: [{ id: 'history', name: 'History', createdAt: 1, messages: [message('historical-user', 'user')] }],
    messageForksHash: {
      user: {
        createdAt: 42,
        position: 1,
        lists: [
          { id: 'saved', messages: [message('alternative')] },
          { id: 'current', messages: [] },
        ],
      },
    },
  }
  const verified = verifySessionTreeRoundTrip(session, { activeThreadId: session.id, now: 1 })
  if (!verified.ok) throw new Error(verified.reason)
  return {
    original: verified.session,
    tree: convertLegacyTreeToRowFormat(verified.tree, verified.session.messageForksHash),
  }
}

describe('row format conversion boundary', () => {
  it('moves global topology data into local rows and summarizes each selected thread', () => {
    const { tree } = converted()
    expect(tree.session).toMatchObject({ rowFormatVersion: 3, rowAuthority: 1 })
    for (const field of ['forkCreatedAt', 'contextReadProjection', 'topologyFingerprint', 'presentation']) {
      expect(tree.session).not.toHaveProperty(field)
    }
    expect(tree.messages.find((row) => row.messageId === 'user')?.forkCreatedAt).toBe(42)
    expect(
      tree.messages
        .filter((row) => row.selected)
        .map((row) => row.messageId)
        .sort()
    ).toEqual(['active', 'historical-user', 'summary', 'user'])
    expect(tree.threads.find((thread) => thread.seq === -1)?.summary).toMatchObject({
      messageCount: 3,
      userMessageCount: 1,
      assistantMessageCount: 2,
      lastUserMessageId: 'user',
      lastNonSummaryMessageId: 'active',
      lastSummaryMessageId: 'summary',
    })
    expect(tree.threads.find((thread) => thread.threadId === 'history')?.summary?.messageCount).toBe(1)
  })

  it('round trips sibling labels independently of parent ordering', () => {
    const { original, tree } = converted()
    const ranks = new Map<string | null, number>()
    for (const row of tree.messages) {
      const rank = ranks.get(row.parentMessageId) ?? 0
      row.seq = rank
      ranks.set(row.parentMessageId, rank + 1)
    }
    expect(validateSessionTree(tree)).toEqual({ ok: true })
    expect(decodeSessionTree(tree)).toEqual({ ok: true, session: original })
  })

  it('retains the identity of an empty active branch after a shared summary', () => {
    const { tree, original } = converted(true)
    const point = tree.messages.find((row) => row.messageId === 'summary')
    expect(point).toMatchObject({ activeChildId: null, pendingBranchId: 'current' })
    expect(decodeSessionTree(tree)).toEqual({ ok: true, session: original })
  })

  it('retains cycle rejection even though path labels need not increase', () => {
    const { tree } = converted()
    const user = tree.messages.find((row) => row.messageId === 'user')
    if (!user) throw new Error('Missing user')
    user.parentMessageId = 'summary'
    expect(validateSessionTree(tree)).toMatchObject({ ok: false, reason: expect.stringContaining('parent cycle') })
  })

  it.each([0, 1])('keeps an empty branch at sibling position %s', (position) => {
    const { tree } = converted(true)
    const alternative = tree.messages.find((row) => row.messageId === 'alternative')
    if (!alternative) throw new Error('Missing branch')
    tree.messages.push({
      ...alternative,
      messageId: 'other',
      message: message('other'),
      branchId: 'other-branch',
      seq: 2,
    })
    const lists = [
      { id: 'saved', messages: [message('alternative')] },
      { id: 'other-branch', messages: [message('other')] },
    ]
    lists.splice(position, 0, { id: 'current', messages: [] })
    const result = convertLegacyTreeToRowFormat(tree, { user: { createdAt: 42, lists, position } })
    expect(validateSessionTree(result)).toEqual({ ok: true })
    const decoded = decodeSessionTree(result)
    if (!decoded.ok) throw new Error(decoded.reason)
    expect(decoded.session.messageForksHash?.user.position).toBe(position)
    expect(decoded.session.messageForksHash?.user.lists.map((branch) => branch.id)).toEqual(
      lists.map((branch) => branch.id)
    )
  })
})
