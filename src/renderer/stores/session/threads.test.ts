import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompactionPoint, Message, Session } from '@shared/types'

const { getSessionMock, updateSessionMock, updateSessionWithMessagesMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  updateSessionWithMessagesMock: vi.fn(),
}))

const { copySessionMock, switchCurrentSessionMock } = vi.hoisted(() => ({
  copySessionMock: vi.fn(),
  switchCurrentSessionMock: vi.fn(),
}))

const { uuidQueue, uuidv4Mock } = vi.hoisted(() => {
  const queue: string[] = []
  let autoId = 0
  const mock = vi.fn(() => {
    if (queue.length > 0) {
      return queue.shift()!
    }
    autoId += 1
    return `auto-uuid-${autoId}`
  })
  return { uuidQueue: queue, uuidv4Mock: mock }
})

vi.mock('uuid', () => ({
  v4: uuidv4Mock,
}))

vi.mock('../chatStore', () => ({
  getSession: getSessionMock,
  updateSession: updateSessionMock,
  updateSessionWithMessages: updateSessionWithMessagesMock,
}))

vi.mock('../scrollActions', () => ({
  scrollToBottom: vi.fn(),
}))

vi.mock('@/hooks/dom', () => ({
  focusMessageInput: vi.fn(),
}))

vi.mock('./crud', () => ({
  _copySession: copySessionMock,
  switchCurrentSession: switchCurrentSessionMock,
}))

import { moveCurrentThreadToConversations, removeCurrentThread, switchThread } from './threads'

function createMessage(id: string, role: Message['role'] = 'assistant'): Message {
  return {
    id,
    role,
    contentParts: [{ type: 'text', text: id }],
  }
}

function createCompactionPoint(summaryMessageId: string, boundaryMessageId: string): CompactionPoint {
  return {
    summaryMessageId,
    boundaryMessageId,
    createdAt: 1,
  }
}

describe('session thread durability', () => {
  beforeEach(() => {
    uuidQueue.length = 0
    uuidv4Mock.mockReset()
    getSessionMock.mockReset()
    updateSessionMock.mockReset()
    updateSessionWithMessagesMock.mockReset()
    copySessionMock.mockReset()
    switchCurrentSessionMock.mockReset()
  })

  it('switchThread preserves archived compaction points and restores the target thread boundary', async () => {
    uuidQueue.push('archived-thread')

    const currentBoundary = createMessage('current-boundary', 'user')
    const currentSummary = createMessage('current-summary', 'assistant')
    currentSummary.isSummary = true
    const targetBoundary = createMessage('target-boundary', 'user')
    const targetSummary = createMessage('target-summary', 'assistant')
    targetSummary.isSummary = true

    const currentCompactionPoints = [createCompactionPoint(currentSummary.id, currentBoundary.id)]
    const targetCompactionPoints = [createCompactionPoint(targetSummary.id, targetBoundary.id)]

    const session: Session = {
      id: 'session-1',
      name: 'Session',
      threadName: 'Current thread',
      messages: [currentBoundary, currentSummary],
      compactionPoints: currentCompactionPoints,
      threads: [
        {
          id: 'thread-1',
          name: 'Target thread',
          createdAt: 1,
          messages: [targetBoundary, targetSummary],
          compactionPoints: targetCompactionPoints,
        },
      ],
    }

    let updatedSession: Session | undefined
    getSessionMock.mockResolvedValue(session)
    updateSessionWithMessagesMock.mockImplementation(async (_sessionId, updater) => {
      const result = typeof updater === 'function' ? updater(session) : updater
      updatedSession = result as Session
      return result
    })

    await switchThread(session.id, 'thread-1')

    expect(updatedSession).toBeDefined()
    expect(updatedSession!.messages.map((message) => message.id)).toEqual([targetBoundary.id, targetSummary.id])
    expect(updatedSession!.compactionPoints).toEqual(targetCompactionPoints)
    expect(updatedSession!.threads).toHaveLength(1)
    expect(updatedSession!.threads?.[0]).toMatchObject({
      id: 'archived-thread',
      name: 'Current thread',
      compactionPoints: currentCompactionPoints,
    })
  })

  it('removeCurrentThread restores the last archived thread compaction points', async () => {
    const archivedBoundary = createMessage('archived-boundary', 'user')
    const archivedSummary = createMessage('archived-summary', 'assistant')
    archivedSummary.isSummary = true
    const archivedCompactionPoints = [createCompactionPoint(archivedSummary.id, archivedBoundary.id)]

    const session: Session = {
      id: 'session-2',
      name: 'Session',
      threadName: 'Current thread',
      messages: [createMessage('current-1', 'user')],
      compactionPoints: [createCompactionPoint('current-summary', 'current-boundary')],
      threads: [
        {
          id: 'thread-2',
          name: 'Archived thread',
          createdAt: 1,
          messages: [archivedBoundary, archivedSummary],
          compactionPoints: archivedCompactionPoints,
        },
      ],
    }

    let updatedSession: Session | undefined
    getSessionMock.mockResolvedValue(session)
    updateSessionMock.mockImplementation(async (_sessionId, updater) => {
      updatedSession = updater as Session
      return updater
    })

    await removeCurrentThread(session.id)

    expect(updatedSession).toBeDefined()
    expect(updatedSession!.messages.map((message) => message.id)).toEqual([archivedBoundary.id, archivedSummary.id])
    expect(updatedSession!.threadName).toBe('Archived thread')
    expect(updatedSession!.compactionPoints).toEqual(archivedCompactionPoints)
  })

  it('moveCurrentThreadToConversations copies the active compaction points into the new session', async () => {
    const currentBoundary = createMessage('current-boundary', 'user')
    const currentSummary = createMessage('current-summary', 'assistant')
    currentSummary.isSummary = true
    const currentCompactionPoints = [createCompactionPoint(currentSummary.id, currentBoundary.id)]

    const session: Session = {
      id: 'session-3',
      name: 'Session',
      threadName: 'Current thread',
      messages: [currentBoundary, currentSummary],
      compactionPoints: currentCompactionPoints,
    }

    getSessionMock.mockResolvedValue(session)
    copySessionMock.mockResolvedValue({ id: 'copied-session' })

    await moveCurrentThreadToConversations(session.id)

    expect(copySessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Current thread',
        messages: session.messages,
        compactionPoints: currentCompactionPoints,
      })
    )
    expect(switchCurrentSessionMock).toHaveBeenCalledWith('copied-session')
  })
})
