import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../types'
import {
  buildCreateForkPatch,
  buildCreateInactiveForkPatch,
  buildSwitchForkToPatch,
  findMessageContext,
  findMessageLocation,
  forkTailStartIndex,
} from './message-forks'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

describe('buildCreateInactiveForkPatch', () => {
  test('adds an alternative without changing the active conversation', () => {
    const pivot = message('user-1', 'user')
    const currentReply = message('assistant-current', 'assistant')
    const candidate = { ...message('assistant-candidate', 'assistant'), generating: true }
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [pivot, currentReply],
    }

    const patch = buildCreateInactiveForkPatch(session, pivot.id, [candidate])

    expect(patch?.messages).toEqual(session.messages)
    const fork = patch?.messageForksHash?.[pivot.id]
    expect(fork?.position).toBe(0)
    expect(fork?.lists).toHaveLength(2)
    expect(fork?.lists[0].messages).toEqual([])
    expect(fork?.lists[1].messages).toEqual([candidate])
    expect(session.messageForksHash).toBeUndefined()
  })

  test('appends concurrent candidates to an existing fork', () => {
    const pivot = message('user-1', 'user')
    const currentReply = message('assistant-current', 'assistant')
    const existingAlternative = message('assistant-alt', 'assistant')
    const candidate = { ...message('assistant-candidate', 'assistant'), generating: true }
    const session: Session = {
      id: 'session-2',
      name: 'Session',
      messages: [pivot, currentReply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'existing', messages: [existingAlternative] },
          ],
          createdAt: 1,
        },
      },
    }

    const patch = buildCreateInactiveForkPatch(session, pivot.id, [candidate])
    const fork = patch?.messageForksHash?.[pivot.id]

    expect(patch?.messages).toEqual(session.messages)
    expect(fork?.position).toBe(0)
    expect(fork?.lists.map((list) => list.messages)).toEqual([[], [existingAlternative], [candidate]])
  })

  test('does not create an empty active branch for an unanswered prompt', () => {
    const pivot = message('user-1', 'user')
    const session: Session = {
      id: 'session-3',
      name: 'Session',
      messages: [pivot],
    }

    expect(
      buildCreateInactiveForkPatch(session, pivot.id, [
        { ...message('assistant-candidate', 'assistant'), generating: true },
      ])
    ).toBeNull()
  })

  test('reconstructs context for messages in nested saved branches', () => {
    const rootUser = message('root-user', 'user')
    const currentReply = message('current-reply', 'assistant')
    const alternativeReply = message('alternative-reply', 'assistant')
    const nestedUser = message('nested-user', 'user')
    const nestedReply = message('nested-reply', 'assistant')
    const session: Session = {
      id: 'session-4',
      name: 'Session',
      messages: [rootUser, currentReply],
      messageForksHash: {
        [rootUser.id]: {
          position: 0,
          lists: [
            { id: 'root-current', messages: [] },
            { id: 'root-alternative', messages: [alternativeReply, nestedUser] },
          ],
          createdAt: 1,
        },
        [nestedUser.id]: {
          position: 0,
          lists: [
            { id: 'nested-current', messages: [] },
            { id: 'nested-alternative', messages: [nestedReply] },
          ],
          createdAt: 2,
        },
      },
    }

    expect(findMessageLocation(session, nestedReply.id)?.list).toEqual([nestedReply])
    expect(findMessageContext(session, nestedReply.id)?.list).toEqual([
      rootUser,
      alternativeReply,
      nestedUser,
      nestedReply,
    ])
  })
})

describe('buildSwitchForkToPatch', () => {
  test('switches directly to the selected saved branch', () => {
    const pivot = message('user-1', 'user')
    const currentReply = message('assistant-current', 'assistant')
    const alternativeReply = message('assistant-alternative', 'assistant')
    const selectedReply = message('assistant-selected', 'assistant')
    const selectedFollowUp = message('user-follow-up', 'user')
    const session: Session = {
      id: 'session-5',
      name: 'Session',
      messages: [pivot, currentReply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'alternative', messages: [alternativeReply] },
            { id: 'selected', messages: [selectedReply, selectedFollowUp] },
          ],
          createdAt: 1,
        },
      },
    }

    const patch = buildSwitchForkToPatch(session, pivot.id, 2)

    expect(patch?.messages).toEqual([pivot, selectedReply, selectedFollowUp])
    expect(patch?.messageForksHash?.[pivot.id]).toMatchObject({
      position: 2,
      lists: [
        { id: 'current', messages: [currentReply] },
        { id: 'alternative', messages: [alternativeReply] },
        { id: 'selected', messages: [] },
      ],
    })
  })

  test('ignores the active branch and invalid positions', () => {
    const pivot = message('user-1', 'user')
    const currentReply = message('assistant-current', 'assistant')
    const session: Session = {
      id: 'session-6',
      name: 'Session',
      messages: [pivot, currentReply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'alternative', messages: [message('assistant-alternative', 'assistant')] },
          ],
          createdAt: 1,
        },
      },
    }

    expect(buildSwitchForkToPatch(session, pivot.id, 0)).toBeNull()
    expect(buildSwitchForkToPatch(session, pivot.id, 2)).toBeNull()
    expect(buildSwitchForkToPatch(session, pivot.id, 0.5)).toBeNull()
  })
})

describe('compaction summaries anchored to the fork pivot', () => {
  // Layout: the pivot is a compaction boundary, so its summary sits right
  // after it. The summary covers the shared prefix and must stay in it.
  const pivot = message('user-1', 'user')
  const summary = summaryMessage('summary-1')
  const currentReply = message('assistant-current', 'assistant')

  test('forkTailStartIndex skips summaries anchored to the pivot', () => {
    expect(forkTailStartIndex([pivot, summary, currentReply], 0)).toBe(2)
    expect(forkTailStartIndex([pivot, currentReply], 0)).toBe(1)
    expect(forkTailStartIndex([pivot, summary], 0)).toBe(2)
  })

  test('creating a fork keeps the anchored summary in the shared prefix', () => {
    const session: Session = {
      id: 'session-7',
      name: 'Session',
      messages: [pivot, summary, currentReply],
    }

    const patch = buildCreateForkPatch(session, pivot.id)

    expect(patch?.messages).toEqual([pivot, summary])
    const fork = patch?.messageForksHash?.[pivot.id]
    expect(fork?.lists[0].messages).toEqual([currentReply])
    expect(fork?.lists[1].messages).toEqual([])
  })

  test('switching branches does not move the anchored summary', () => {
    const alternativeReply = message('assistant-alternative', 'assistant')
    const session: Session = {
      id: 'session-8',
      name: 'Session',
      messages: [pivot, summary, currentReply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'alternative', messages: [alternativeReply] },
          ],
          createdAt: 1,
        },
      },
    }

    const patch = buildSwitchForkToPatch(session, pivot.id, 1)

    expect(patch?.messages).toEqual([pivot, summary, alternativeReply])
    expect(patch?.messageForksHash?.[pivot.id]).toMatchObject({
      position: 1,
      lists: [
        { id: 'current', messages: [currentReply] },
        { id: 'alternative', messages: [] },
      ],
    })
  })

  test('an inactive fork on the boundary still counts the summary as shared prefix', () => {
    const candidate = { ...message('assistant-candidate', 'assistant'), generating: true }
    const session: Session = {
      id: 'session-9',
      name: 'Session',
      messages: [pivot, summary, currentReply],
    }

    const patch = buildCreateInactiveForkPatch(session, pivot.id, [candidate])

    expect(patch?.messages).toEqual(session.messages)
    expect(patch?.messageForksHash?.[pivot.id]?.lists[1].messages).toEqual([candidate])
  })

  test('a compacted boundary with only its summary is treated as unanswered', () => {
    // [pivot, summary] and nothing else: there is no active answer to fork
    // from, matching the bare-user-message rule.
    const candidate = { ...message('assistant-candidate', 'assistant'), generating: true }
    const session: Session = {
      id: 'session-10',
      name: 'Session',
      messages: [pivot, summary],
    }

    expect(buildCreateInactiveForkPatch(session, pivot.id, [candidate])).toBeNull()
  })

  test('findMessageContext reconstructs branch paths with the summary in the prefix', () => {
    const alternativeReply = message('assistant-alternative', 'assistant')
    const session: Session = {
      id: 'session-11',
      name: 'Session',
      messages: [pivot, summary, currentReply],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'alternative', messages: [alternativeReply] },
          ],
          createdAt: 1,
        },
      },
    }

    const context = findMessageContext(session, alternativeReply.id)

    expect(context?.list.map((m) => m.id)).toEqual([pivot.id, summary.id, alternativeReply.id])
  })
})
