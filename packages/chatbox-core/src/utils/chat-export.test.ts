import { describe, expect, it } from 'vitest'
import { createMessage } from '../types'
import type { Message, Session } from '../types/session'
import { buildSessionExportThreads, type ExportableThread } from './chat-export'

function message(id: string, role: 'user' | 'assistant', text: string): Message {
  const result = createMessage(role, text)
  result.id = id
  return result
}

function messageTexts(thread: ExportableThread): string[] {
  return thread.messages.map((item) => item.contentParts.find((part) => part.type === 'text')?.text ?? '')
}

describe('buildSessionExportThreads', () => {
  it('reconstructs saved and active fork branches in branch order', () => {
    const pivot = message('pivot', 'user', 'question')
    const session: Session = {
      id: 'session',
      name: 'Session',
      messages: [pivot, message('active', 'assistant', 'active')],
      messageForksHash: {
        [pivot.id]: {
          position: 2,
          createdAt: 1,
          lists: [
            { id: 'one', messages: [message('one-answer', 'assistant', 'one')] },
            { id: 'two', messages: [message('two-answer', 'assistant', 'two')] },
            { id: 'active', messages: [] },
          ],
        },
      },
    }

    expect(buildSessionExportThreads(session, false).map((thread) => messageTexts(thread))).toEqual([
      ['question', 'active'],
    ])

    const threads = buildSessionExportThreads(session, false, true)

    expect(threads.map((thread) => thread.name)).toEqual([
      'Session (Branch 1/3)',
      'Session (Branch 2/3)',
      'Session (Branch 3/3)',
    ])
    expect(threads.map((thread) => messageTexts(thread))).toEqual([
      ['question', 'one'],
      ['question', 'two'],
      ['question', 'active'],
    ])
  })

  it('expands nested forks without mixing sibling paths', () => {
    const outerPivot = message('outer-pivot', 'user', 'outer question')
    const innerPivot = message('inner-pivot', 'user', 'inner question')
    const session: Session = {
      id: 'session',
      name: 'Nested',
      messages: [outerPivot, message('outer-active', 'assistant', 'outer active')],
      messageForksHash: {
        [outerPivot.id]: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'outer-active-list', messages: [] },
            {
              id: 'outer-saved-list',
              messages: [innerPivot, message('inner-active', 'assistant', 'inner active')],
            },
          ],
        },
        [innerPivot.id]: {
          position: 0,
          createdAt: 2,
          lists: [
            { id: 'inner-active-list', messages: [] },
            { id: 'inner-saved-list', messages: [message('inner-saved', 'assistant', 'inner saved')] },
          ],
        },
      },
    }

    const threads = buildSessionExportThreads(session, false, true)

    expect(threads.map((thread) => messageTexts(thread))).toEqual([
      ['outer question', 'outer active'],
      ['outer question', 'inner question', 'inner active'],
      ['outer question', 'inner question', 'inner saved'],
    ])
  })

  it('only includes archived thread branches for all-thread export', () => {
    const archivedPivot = message('archived-pivot', 'user', 'archived question')
    const session: Session = {
      id: 'session',
      name: 'Session',
      messages: [message('current-question', 'user', 'current question')],
      threads: [
        {
          id: 'archived',
          name: 'Archived',
          createdAt: 1,
          messages: [archivedPivot, message('archived-active', 'assistant', 'archived active')],
        },
      ],
      messageForksHash: {
        [archivedPivot.id]: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'archived-active-list', messages: [] },
            { id: 'archived-saved-list', messages: [message('archived-saved', 'assistant', 'archived saved')] },
          ],
        },
      },
    }

    expect(buildSessionExportThreads(session, false, true).map((thread) => thread.name)).toEqual(['Session'])
    expect(buildSessionExportThreads(session, true, true).map((thread) => thread.name)).toEqual([
      'Archived (Branch 1/2)',
      'Archived (Branch 2/2)',
      'Session',
    ])
  })
})
