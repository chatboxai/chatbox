import type { CompactionPoint, Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, updateSessionWithMessagesMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateSessionWithMessagesMock: vi.fn(),
}))

vi.mock('../chatStore', () => ({
  getSession: getSessionMock,
  updateSession: vi.fn(),
  updateSessionWithMessages: updateSessionWithMessagesMock,
}))
vi.mock('../scrollActions', () => ({ scrollToBottom: vi.fn() }))
vi.mock('@/hooks/dom', () => ({ focusMessageInput: vi.fn() }))
vi.mock('./crud', () => ({ _copySession: vi.fn(), switchCurrentSession: vi.fn() }))
vi.mock('uuid', () => ({ v4: () => 'new-thread-id' }))

import { compressAndCreateThread, refreshContextAndCreateNewThread, removeCurrentThread, switchThread } from './threads'

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: 'assistant', contentParts: [], ...overrides }
}

function point(summaryMessageId: string, boundaryMessageId: string): CompactionPoint {
  return { summaryMessageId, boundaryMessageId, createdAt: 1000 }
}

const activePoint = point('summary-active', 'a1')
const threadPoint = point('summary-thread', 'a0')

function testSession(): Session {
  return {
    id: 'session-1',
    name: 'Test',
    messages: [message('u1', { role: 'user' }), message('a1'), message('summary-active', { isSummary: true })],
    compactionPoints: [activePoint],
    threads: [
      {
        id: 'thread-1',
        name: 'archived',
        createdAt: 500,
        messages: [message('u0', { role: 'user' }), message('a0'), message('summary-thread', { isSummary: true })],
        compactionPoints: [threadPoint],
      },
    ],
  }
}

function updatedSession(): Session {
  expect(updateSessionWithMessagesMock).toHaveBeenCalledTimes(1)
  const arg = updateSessionWithMessagesMock.mock.calls[0][1] as Session | ((s: Session) => Session)
  // Thread transfers must use functional updaters so they read the update
  // queue's current session, not a possibly stale getSession() snapshot.
  expect(typeof arg).toBe('function')
  return (arg as (s: Session) => Session)(testSession())
}

// Compaction points must travel with their message list across every
// archive/restore flow, or the send path (which reads only
// session.compactionPoints) loses the compaction after a thread restore.
describe('thread flows carry compaction points with their messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue(testSession())
    updateSessionWithMessagesMock.mockResolvedValue(undefined)
  })

  it('switchThread swaps session and thread compaction points', async () => {
    await switchThread('session-1', 'thread-1')

    const updated = updatedSession()
    expect(updated.compactionPoints).toEqual([threadPoint])
    const archived = updated.threads?.find((t) => t.id === 'new-thread-id')
    expect(archived?.compactionPoints).toEqual([activePoint])
  })

  it('refreshContextAndCreateNewThread archives the points and clears the session ones', async () => {
    await refreshContextAndCreateNewThread('session-1')

    const updated = updatedSession()
    expect(updated.compactionPoints).toBeUndefined()
    const archived = updated.threads?.find((t) => t.id === 'new-thread-id')
    expect(archived?.compactionPoints).toEqual([activePoint])
  })

  it('removeCurrentThread restores the last thread with its compaction points', async () => {
    await removeCurrentThread('session-1')

    const updated = updatedSession()
    expect(updated.messages.map((m) => m.id)).toEqual(['u0', 'a0', 'summary-thread'])
    expect(updated.compactionPoints).toEqual([threadPoint])
  })

  it('removeCurrentThread cancels a generating reply in the discarded current thread', async () => {
    const cancel = vi.fn()
    const generating = message('active-reply', { generating: true, cancel })
    getSessionMock.mockResolvedValue({ ...testSession(), messages: [message('u1', { role: 'user' }), generating] })

    await removeCurrentThread('session-1')

    expect(cancel).toHaveBeenCalledOnce()
    const updater = updateSessionWithMessagesMock.mock.calls[0][1] as (session: Session) => Session
    const updated = updater({ ...testSession(), messages: [message('u1', { role: 'user' }), generating] })
    expect(updated.messages.some((item) => item.id === generating.id)).toBe(false)
  })

  it.each([
    ['switchThread', () => switchThread('session-1', 'thread-1')],
    ['refreshContextAndCreateNewThread', () => refreshContextAndCreateNewThread('session-1')],
    ['removeCurrentThread', () => removeCurrentThread('session-1')],
    ['compressAndCreateThread', () => compressAndCreateThread('session-1', 'Summary')],
  ])('cancels a generating inactive fork reply before %s replaces the current conversation', async (_name, run) => {
    const cancel = vi.fn()
    const pivot = message('fork-pivot', { role: 'user' })
    const forkReply = message('fork-reply', { generating: true, cancel })
    getSessionMock.mockResolvedValue({
      ...testSession(),
      messages: [pivot],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'current', messages: [] },
            { id: 'inactive', messages: [forkReply] },
          ],
          createdAt: 1,
        },
      },
    })

    await run()

    expect(cancel).toHaveBeenCalledOnce()
  })

  it('removeCurrentThread clears compaction points when no thread remains', async () => {
    getSessionMock.mockResolvedValue({ ...testSession(), threads: [] })

    await removeCurrentThread('session-1')

    expect(updateSessionWithMessagesMock).toHaveBeenCalledTimes(1)
    const updater = updateSessionWithMessagesMock.mock.calls[0][1] as (s: Session) => Session
    expect(updater({ ...testSession(), threads: [] }).compactionPoints).toBeUndefined()
  })

  it('archives a compaction that committed after the snapshot was taken', async () => {
    // getSession returned a stale snapshot (no compaction yet); by the time
    // the queued updater runs, the compaction commit has landed. The transfer
    // must archive the queue's newer state, not the snapshot.
    getSessionMock.mockResolvedValue({ ...testSession(), messages: [message('u1', { role: 'user' })] })

    await refreshContextAndCreateNewThread('session-1')

    const updater = updateSessionWithMessagesMock.mock.calls[0][1] as (s: Session) => Session
    const updated = updater(testSession())
    const archived = updated.threads?.find((t) => t.id === 'new-thread-id')
    expect(archived?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'summary-active'])
    expect(archived?.compactionPoints).toEqual([activePoint])
    expect(updated.compactionPoints).toBeUndefined()
  })
})
