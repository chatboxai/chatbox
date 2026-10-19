import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../types'
import { buildSwitchForkToPatch, findMessageLocation, forkTailStartIndex } from './message-forks'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [] }
}

function summaryMessage(id: string): Message {
  return { ...message(id, 'assistant'), isSummary: true }
}

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
})

describe('historical message location', () => {
  test('locates root, archived and saved branch inputs', () => {
    const root = message('root', 'user')
    const archived = message('archived', 'assistant')
    const saved = message('saved', 'assistant')
    const session: Session = {
      id: 's',
      name: '',
      messages: [root],
      threads: [{ id: 't', name: '', createdAt: 1, messages: [archived] }],
      messageForksHash: {
        root: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'current', messages: [] },
            { id: 'saved', messages: [saved] },
          ],
        },
      },
    }
    for (const value of [root, archived, saved]) {
      const location = findMessageLocation(session, value.id)
      expect(location?.list[location.index]).toBe(value)
    }
    expect(findMessageLocation(session, 'missing')).toBeNull()
  })
})
