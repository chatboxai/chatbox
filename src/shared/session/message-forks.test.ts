import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../types'
import {
  buildCreateForkPatch,
  buildCreateInactiveForkPatch,
  buildDeleteForkPatch,
  buildSaveAndResendForkPatch,
  buildSwitchForkToPatch,
  findMessageContext,
  findMessageLocation,
  findMessageSourceThread,
  forkTailStartIndex,
} from './message-forks'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

let identitySequence = 0
const identity = {
  createId: () => `test-fork-${++identitySequence}`,
  now: () => 1,
}

describe('buildSaveAndResendForkPatch', () => {
  test('versions the edited message under its predecessor', () => {
    const before = [message('user-1', 'user'), message('assistant-1', 'assistant')]
    const original = message('user-2', 'user')
    const oldReply = message('assistant-2', 'assistant')
    const replacement = message('user-2-edited', 'user')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [...before, original, oldReply],
    }

    const patch = buildSaveAndResendForkPatch(session, original.id, replacement, identity)

    expect(patch?.messages).toEqual([...before, replacement])
    const fork = patch?.messageForksHash?.['assistant-1']
    expect(fork?.position).toBe(1)
    expect(fork?.lists).toHaveLength(2)
    expect(fork?.lists[0].messages).toEqual([original, oldReply])
    expect(fork?.lists[1].messages).toEqual([])
  })

  test('keeps anchored summaries in the shared prefix and pivots past them', () => {
    const reply = message('assistant-1', 'assistant')
    const summary = summaryMessage('summary-1')
    const original = message('user-2', 'user')
    const oldReply = message('assistant-2', 'assistant')
    const replacement = message('user-2-edited', 'user')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('user-1', 'user'), reply, summary, original, oldReply],
    }

    const patch = buildSaveAndResendForkPatch(session, original.id, replacement, identity)

    // The pivot is the reply, never the summary (deleting the summary must not
    // orphan the fork), and the summary stays in the shared prefix.
    expect(patch?.messages?.map((m) => m.id)).toEqual(['user-1', 'assistant-1', 'summary-1', 'user-2-edited'])
    const fork = patch?.messageForksHash?.['assistant-1']
    expect(fork?.lists[0].messages).toEqual([original, oldReply])
    expect(patch?.messageForksHash?.['summary-1']).toBeUndefined()
  })

  test('appends a branch to an existing fork at the pivot', () => {
    const pivot = message('assistant-1', 'assistant')
    const original = message('user-2', 'user')
    const oldReply = message('assistant-2', 'assistant')
    const existingAlternative = message('assistant-alt', 'assistant')
    const replacement = message('user-2-edited', 'user')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('user-1', 'user'), pivot, original, oldReply],
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

    const patch = buildSaveAndResendForkPatch(session, original.id, replacement, identity)
    const fork = patch?.messageForksHash?.[pivot.id]

    expect(patch?.messages?.at(-1)).toEqual(replacement)
    expect(fork?.position).toBe(2)
    expect(fork?.lists.map((list) => list.messages)).toEqual([[original, oldReply], [existingAlternative], []])
  })

  test('versions a message inside an archived thread', () => {
    const threadPrefix = [message('thread-user', 'user'), message('thread-reply', 'assistant')]
    const original = message('thread-user-2', 'user')
    const oldReply = message('thread-reply-2', 'assistant')
    const replacement = message('thread-user-2-edited', 'user')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('active-user', 'user')],
      threads: [
        {
          id: 'thread-1',
          name: 'Thread',
          createdAt: 1,
          messages: [...threadPrefix, original, oldReply],
        },
      ],
    }

    const patch = buildSaveAndResendForkPatch(session, original.id, replacement, identity)

    expect(patch?.messages).toBeUndefined()
    expect(patch?.threads?.[0].messages).toEqual([...threadPrefix, replacement])
    expect(patch?.messageForksHash?.['thread-reply']?.lists[0].messages).toEqual([original, oldReply])
  })

  test('returns null for a conversation-first message', () => {
    const original = message('user-1', 'user')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [original, message('assistant-1', 'assistant')],
    }

    expect(buildSaveAndResendForkPatch(session, original.id, message('edited', 'user'), identity)).toBeNull()
  })

  test('returns null when only summaries precede the target', () => {
    const original = message('user-1', 'user')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [summaryMessage('summary-1'), original, message('assistant-1', 'assistant')],
    }

    expect(buildSaveAndResendForkPatch(session, original.id, message('edited', 'user'), identity)).toBeNull()
  })

  test('returns null for a summary target', () => {
    const summary = summaryMessage('summary-1')
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('user-1', 'user'), summary],
    }

    expect(buildSaveAndResendForkPatch(session, summary.id, message('edited', 'assistant'), identity)).toBeNull()
  })
})

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

    const patch = buildCreateInactiveForkPatch(session, pivot.id, [candidate], identity)

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

    const patch = buildCreateInactiveForkPatch(session, pivot.id, [candidate], identity)
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
      buildCreateInactiveForkPatch(
        session,
        pivot.id,
        [{ ...message('assistant-candidate', 'assistant'), generating: true }],
        identity
      )
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

describe('buildDeleteForkPatch', () => {
  test('prunes nested fork entries whose parent branch was deleted', () => {
    const rootPivot = message('root-pivot', 'user')
    const removedReply = message('removed-reply', 'assistant')
    const nestedPivot = message('nested-pivot', 'user')
    const nestedReply = message('nested-reply', 'assistant')
    const keptReply = message('kept-reply', 'assistant')
    const session: Session = {
      id: 'session-delete-nested',
      name: 'Session',
      messages: [rootPivot, removedReply, nestedPivot],
      messageForksHash: {
        [rootPivot.id]: {
          position: 0,
          lists: [
            { id: 'root-current', messages: [] },
            { id: 'root-saved', messages: [keptReply] },
          ],
          createdAt: 1,
        },
        [nestedPivot.id]: {
          position: 0,
          lists: [
            { id: 'nested-current', messages: [] },
            { id: 'nested-saved', messages: [nestedReply] },
          ],
          createdAt: 2,
        },
      },
    }

    const patch = buildDeleteForkPatch(session, rootPivot.id)

    expect(patch?.messages?.map((item) => item.id)).toEqual([rootPivot.id, keptReply.id])
    expect(patch?.messageForksHash?.[rootPivot.id]).toBeDefined()
    expect(patch?.messageForksHash?.[nestedPivot.id]).toBeUndefined()
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

  test('switches a fork whose active tail lives inside another saved branch', () => {
    const outerPivot = message('outer-pivot', 'user')
    const currentReply = message('current-reply', 'assistant')
    const innerPivot = message('inner-pivot', 'user')
    const innerSavedReply = message('inner-saved-reply', 'assistant')
    const session: Session = {
      id: 'nested-switch',
      name: 'Session',
      messages: [outerPivot, currentReply],
      messageForksHash: {
        [outerPivot.id]: {
          position: 0,
          lists: [
            { id: 'outer-active', messages: [] },
            { id: 'outer-saved', messages: [innerPivot] },
          ],
          createdAt: 1,
        },
        [innerPivot.id]: {
          position: 0,
          lists: [
            { id: 'inner-active', messages: [] },
            { id: 'inner-saved', messages: [innerSavedReply] },
          ],
          createdAt: 2,
        },
      },
    }

    const patch = buildSwitchForkToPatch(session, innerPivot.id, 1)

    expect(patch?.messageForksHash?.[outerPivot.id].lists[1].messages).toEqual([innerPivot, innerSavedReply])
    expect(patch?.messageForksHash?.[innerPivot.id]).toBeUndefined()
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

    const patch = buildCreateForkPatch(session, pivot.id, identity)

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

    const patch = buildCreateInactiveForkPatch(session, pivot.id, [candidate], identity)

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

    expect(buildCreateInactiveForkPatch(session, pivot.id, [candidate], identity)).toBeNull()
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

describe('searchMessageContext path reconstruction', () => {
  test('resolves the owning thread for a branch saved under an archived thread', () => {
    const threadUser = message('thread-user', 'user')
    const threadReply = message('thread-reply', 'assistant')
    const alternativeReply = message('thread-alternative', 'assistant')
    const session: Session = {
      id: 'session-12',
      name: 'Session',
      messages: [message('active-user', 'user')],
      threads: [
        {
          id: 'thread-1',
          name: 'Thread',
          createdAt: 1,
          messages: [threadUser, threadReply],
        },
      ],
      messageForksHash: {
        [threadUser.id]: {
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
    expect(context?.list.map((m) => m.id)).toEqual([threadUser.id, alternativeReply.id])
    expect(findMessageSourceThread(session, alternativeReply.id)?.id).toBe('thread-1')
    expect(findMessageSourceThread(session, threadReply.id)?.id).toBe('thread-1')
  })

  test('ignores branches whose pivot is no longer reachable', () => {
    const orphanReply = message('orphan-reply', 'assistant')
    const session: Session = {
      id: 'session-13',
      name: 'Session',
      messages: [message('user-1', 'user'), message('assistant-1', 'assistant')],
      messageForksHash: {
        'deleted-pivot': {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'orphan', messages: [orphanReply] },
          ],
          createdAt: 1,
        },
      },
    }

    expect(findMessageContext(session, orphanReply.id)).toBeNull()
    expect(findMessageSourceThread(session, orphanReply.id)).toBeNull()
  })

  test('stays fast when a long conversation has many fork points', () => {
    // Regression guard: every Reply Again (Below) leaves a fork entry behind,
    // so long conversations accumulate dozens of pivots. The previous
    // top-down expansion re-explored shared prefixes per pivot subset
    // (~2^pivots contexts), freezing the UI on the next inactive-branch
    // lookup; the pivot-chain walk stays linear.
    const messages: Message[] = []
    const messageForksHash: NonNullable<Session['messageForksHash']> = {}
    for (let turn = 0; turn < 60; turn++) {
      const user = message(`user-${turn}`, 'user')
      const reply = message(`assistant-${turn}`, 'assistant')
      messages.push(user, reply)
      messageForksHash[user.id] = {
        position: 0,
        lists: [
          { id: `active-${turn}`, messages: [] },
          { id: `saved-${turn}`, messages: [message(`alternative-${turn}`, 'assistant')] },
        ],
        createdAt: turn,
      }
    }
    const inactiveCandidate = message('inactive-candidate', 'assistant')
    messageForksHash['user-59'].lists.push({ id: 'candidate', messages: [inactiveCandidate] })
    const session: Session = { id: 'session-14', name: 'Session', messages, messageForksHash }

    const startedAt = performance.now()
    const context = findMessageContext(session, inactiveCandidate.id)
    const elapsedMs = performance.now() - startedAt

    expect(context?.list.map((m) => m.id).slice(-2)).toEqual(['user-59', inactiveCandidate.id])
    expect(context?.index).toBe(context ? context.list.length - 1 : -1)
    expect(elapsedMs).toBeLessThan(1_000)
  })

  test('reconstructs deeply nested branch chains without re-expanding prefixes', () => {
    // fork branch -> nested fork branch -> ... five levels deep
    const rootUser = message('chain-root', 'user')
    const rootReply = message('chain-root-reply', 'assistant')
    const session: Session = {
      id: 'session-15',
      name: 'Session',
      messages: [rootUser, rootReply],
      messageForksHash: {},
    }
    const forksHash = session.messageForksHash as NonNullable<Session['messageForksHash']>
    let pivotId = rootUser.id
    const expectedPath = [rootUser.id]
    for (let depth = 0; depth < 5; depth++) {
      const branchReply = message(`chain-reply-${depth}`, 'assistant')
      const branchUser = message(`chain-user-${depth}`, 'user')
      forksHash[pivotId] = {
        position: 0,
        lists: [
          { id: `chain-active-${depth}`, messages: [] },
          { id: `chain-saved-${depth}`, messages: [branchReply, branchUser] },
        ],
        createdAt: depth,
      }
      expectedPath.push(branchReply.id, branchUser.id)
      pivotId = branchUser.id
    }

    const deepest = `chain-user-4`
    const context = findMessageContext(session, deepest)

    expect(context?.list.map((m) => m.id)).toEqual(expectedPath)
    expect(context?.list[context.index]?.id).toBe(deepest)
  })
})
