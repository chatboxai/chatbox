import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../types'
import {
  countCancellableGeneratingAssistantMessages,
  getCurrentConversationMessages,
  getGenerationControlMessages,
  getReachableSessionMessages,
  isCancellableGeneratingAssistantMessage,
} from './generation-state'

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'message-id',
    role: overrides.role ?? 'assistant',
    contentParts: overrides.contentParts ?? [],
    ...overrides,
  }
}

describe('generation state', () => {
  it('counts only assistant replies that are generating and cancellable in the current runtime', () => {
    const messages = [
      message({ id: 'active-current', generating: true }),
      message({ id: 'active-history', generating: true }),
      message({ id: 'stale-history', generating: true }),
      message({ id: 'finished', generating: false }),
      message({ id: 'user', role: 'user', generating: true }),
    ]
    const activeIds = new Set(['active-current', 'active-history', 'finished', 'user'])

    expect(countCancellableGeneratingAssistantMessages(messages, activeIds)).toBe(2)
    expect(isCancellableGeneratingAssistantMessage(messages[0], true)).toBe(true)
    expect(isCancellableGeneratingAssistantMessage(messages[2], false)).toBe(false)
  })

  it('includes reachable fork replies but excludes historical threads', () => {
    const pivot = message({ id: 'pivot', role: 'user' })
    const currentReply = message({ id: 'current' })
    const alternative = message({ id: 'alternative', generating: true })
    const nestedPivot = message({ id: 'nested-pivot', role: 'user' })
    const nestedAlternative = message({ id: 'nested-alternative' })
    const historical = message({ id: 'historical', generating: true })
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [pivot, currentReply],
      threads: [{ id: 'thread-1', name: 'History', createdAt: 1, messages: [historical] }],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current-list', messages: [] },
            { id: 'alternative-list', messages: [alternative, nestedPivot] },
          ],
          createdAt: 1,
        },
        [nestedPivot.id]: {
          position: 0,
          lists: [
            { id: 'nested-current', messages: [] },
            { id: 'nested-alternative', messages: [nestedAlternative] },
          ],
          createdAt: 2,
        },
      },
    }

    expect(getCurrentConversationMessages(session).map((item) => item.id)).toEqual([
      'pivot',
      'current',
      'alternative',
      'nested-pivot',
      'nested-alternative',
    ])
  })

  it('controls generation from runtime-cancellable historical threads and forks without reviving stale flags', () => {
    const currentPivot = message({ id: 'current-pivot', role: 'user' })
    const currentPlaceholder = message({ id: 'current-placeholder', generating: true })
    const historicalPivot = message({ id: 'historical-pivot', role: 'user' })
    const historicalRuntime = message({ id: 'historical-runtime', generating: true })
    const historicalStale = message({ id: 'historical-stale', generating: true })
    const historicalFinished = message({ id: 'historical-finished', generating: false })
    const historicalForkRuntime = message({ id: 'historical-fork-runtime', generating: true })
    const session: Session = {
      id: 'session-2',
      name: 'Session',
      messages: [currentPivot, currentPlaceholder],
      threads: [
        {
          id: 'thread-1',
          name: 'History',
          createdAt: 1,
          messages: [historicalPivot, historicalRuntime, historicalStale, historicalFinished],
        },
      ],
      messageForksHash: {
        [historicalPivot.id]: {
          position: 0,
          lists: [
            { id: 'historical-current', messages: [] },
            { id: 'historical-alternative', messages: [historicalForkRuntime] },
          ],
          createdAt: 2,
        },
      },
    }

    const activeIds = new Set(['historical-runtime', 'historical-finished', 'historical-fork-runtime'])
    const controlledIds = getGenerationControlMessages(session, activeIds).map((item) => item.id)

    expect(controlledIds).toEqual([
      'current-pivot',
      'current-placeholder',
      'historical-runtime',
      'historical-fork-runtime',
    ])
    expect(
      countCancellableGeneratingAssistantMessages(getGenerationControlMessages(session, activeIds), activeIds)
    ).toBe(2)
  })

  it('excludes nested fork data after its parent branch becomes unreachable', () => {
    const rootPivot = message({ id: 'root-pivot', role: 'user' })
    const nestedPivot = message({ id: 'nested-pivot', role: 'user' })
    const nestedReply = message({ id: 'nested-reply', generating: true })
    const session: Session = {
      id: 'session-3',
      name: 'Session',
      messages: [rootPivot],
      messageForksHash: {
        [nestedPivot.id]: {
          position: 0,
          lists: [
            { id: 'nested-current', messages: [] },
            { id: 'nested-saved', messages: [nestedReply] },
          ],
          createdAt: 1,
        },
      },
    }

    expect(getReachableSessionMessages(session).map((item) => item.id)).toEqual(['root-pivot'])
  })
})
