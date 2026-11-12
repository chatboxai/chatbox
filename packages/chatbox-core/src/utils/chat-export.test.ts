import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '../testing/InMemorySessionRepository'
import { createMessage } from '../types'
import type { Message, Session } from '../types/session'
import { openSessionChatExport, formatSessionAsJson, formatChatAsMarkdown, formatChatAsTxt } from './chat-export'

async function source(session: Session) {
  const repository = new InMemorySessionRepository()
  await repository.seedSession(session)
  const reader = await openSessionChatExport(repository.rowStore, repository, session.id)
  if (!reader) throw new Error('Missing export source')
  return { repository, reader }
}

async function exportThreads(session: Session, archived: boolean, branches = false) {
  const { reader } = await source(session)
  const output: Array<{ name: string; messages: Message[] }> = []
  for await (const thread of reader.formattedThreads(archived, branches)) {
    const messages: Message[] = []
    for await (const message of thread.messages) messages.push(message)
    output.push({ name: thread.name, messages })
  }
  return output
}

function message(id: string, role: 'user' | 'assistant', text: string): Message {
  const result = createMessage(role, text)
  result.id = id
  return result
}

function messageTexts(thread: { messages: Message[] }): string[] {
  return thread.messages.map((item) => item.contentParts.find((part) => part.type === 'text')?.text ?? '')
}

describe('row chat export', () => {
  it('uses the session title for an unnamed active thread', async () => {
    const session: Session = {
      id: 'unnamed',
      name: 'Session title',
      threadName: '',
      messages: [message('question', 'user', 'Hello')],
      threads: [{ id: 'archive', name: '', createdAt: 1, messages: [] }],
    }
    expect((await exportThreads(session, false)).map((thread) => thread.name)).toEqual(['Session title'])
    expect((await exportThreads(session, true, true)).map((thread) => thread.name)).toEqual(['', 'Session title'])
  })

  it('reconstructs saved and active fork branches in branch order', async () => {
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

    expect((await exportThreads(session, false)).map((thread) => messageTexts(thread))).toEqual([
      ['question', 'active'],
    ])

    const threads = await exportThreads(session, false, true)

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

  it('expands nested forks without mixing sibling paths', async () => {
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

    const threads = await exportThreads(session, false, true)

    expect(threads.map((thread) => messageTexts(thread))).toEqual([
      ['outer question', 'outer active'],
      ['outer question', 'inner question', 'inner active'],
      ['outer question', 'inner question', 'inner saved'],
    ])
  })

  it('only includes archived thread branches for all-thread export', async () => {
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

    expect((await exportThreads(session, false, true)).map((thread) => thread.name)).toEqual(['Session'])
    expect((await exportThreads(session, true, true)).map((thread) => thread.name)).toEqual([
      'Archived (Branch 1/2)',
      'Archived (Branch 2/2)',
      'Session',
    ])
  })
})

it('encodes JSON from singleton payload reads and round trips summary forks and thread metadata', async () => {
  const summary = { ...message('summary', 'assistant', 'Summary'), isSummary: true }
  const session: Session = {
    id: 'json',
    name: 'JSON',
    threadName: 'Active',
    messages: [message('pivot', 'user', 'Question'), summary],
    threads: [{ id: 'archive', name: 'Archived', createdAt: 12, messages: [message('archived', 'user', 'Earlier')] }],
    messageForksHash: {
      pivot: {
        position: 1,
        createdAt: 45,
        lists: [
          { id: 'saved', messages: [message('answer', 'assistant', 'Saved')] },
          { id: 'empty', messages: [] },
        ],
      },
    },
  }
  const { reader, repository } = await source(session)
  const read = vi.spyOn(repository.rowStore, 'readMessages')
  const encoded = JSON.parse(await formatSessionAsJson(reader)) as Session
  expect(encoded).toMatchObject(session)
  expect(read.mock.calls.every(([request]) => request.messageIds.length === 1)).toBe(true)
  const restored = new InMemorySessionRepository()
  await restored.seedSession(encoded)
  expect((await restored.inspectSession(session.id))?.messageForksHash).toEqual(session.messageForksHash)
})

it('streams large paths with bounded metadata pages and preserves text formats', async () => {
  const session: Session = {
    id: 'large',
    name: 'Large',
    messages: Array.from({ length: 301 }, (_, i) => message('m' + i, i % 2 ? 'assistant' : 'user', 'text' + i)),
  }
  const { reader, repository } = await source(session)
  const metadata = vi.spyOn(repository.rowStore, 'readMessageRelationsPage')
  const bodies = vi.spyOn(repository.rowStore, 'readMessages')
  expect(await formatChatAsMarkdown(session.name, reader.formattedThreads(false))).toContain('text300')
  expect(await formatChatAsTxt(session.name, reader.formattedThreads(false))).toContain('▶ ASSISTANT')
  expect(metadata.mock.calls.every(([request]) => request.limit <= 100)).toBe(true)
  expect(bodies.mock.calls.every(([request]) => request.messageIds.length === 1)).toBe(true)
  expect(bodies).toHaveBeenCalledTimes(602)
})

it('rejects a changed source instead of exporting a mixed revision', async () => {
  const session: Session = { id: 'revision', name: 'Before', messages: [message('m', 'user', 'text')] }
  const { reader, repository } = await source(session)
  await repository.seedSession({ ...session, name: 'After' })
  await expect(formatSessionAsJson(reader)).rejects.toThrow()
})

it('keeps paged fork options and hidden pivots in the JSON output', async () => {
  const marker = { ...message('marker', 'user', ''), isForkMarker: true }
  const session: Session = {
    id: 'fork-pages',
    name: 'Paged forks',
    messages: [marker],
    messageForksHash: {
      marker: {
        createdAt: 10,
        position: 101,
        lists: [
          ...Array.from({ length: 101 }, (_, index) => ({
            id: `branch-${index}`,
            messages: [message(`answer-${index}`, 'assistant', String(index))],
          })),
          { id: 'empty', messages: [] },
        ],
      },
    },
  }
  const { reader } = await source(session)
  const output = JSON.parse(await formatSessionAsJson(reader)) as Session
  expect(output.messages[0].isForkMarker).toBe(true)
  expect(output.messageForksHash?.marker.lists).toHaveLength(102)
  expect(output.messageForksHash?.marker.position).toBe(101)
  expect(output.messageForksHash?.marker.lists[100].messages[0].id).toBe('answer-100')
})
