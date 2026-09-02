import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generationRuntimeMock, sessionsMock, sessionQueryBridgeMock, clearQueueMock } = vi.hoisted(() => ({
  generationRuntimeMock: {
    getActiveMessageIds: vi.fn((_sessionId: string) => new Set<string>()),
    requestAbort: vi.fn(),
  },
  sessionsMock: {
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteSessions: vi.fn().mockResolvedValue(undefined),
    listArchivedSessionsMeta: vi.fn().mockResolvedValue([]),
  },
  sessionQueryBridgeMock: {
    getCachedSession: vi.fn((_sessionId: string) => null as Session | null | undefined),
    getSession: vi.fn().mockResolvedValue(null),
  },
  clearQueueMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    generationRuntime: generationRuntimeMock,
    sessions: sessionsMock,
    sessionQueryBridge: sessionQueryBridgeMock,
  },
}))
vi.mock('@/platform', () => ({ default: { isDesktopLike: false } }))
vi.mock('@/router', () => ({ router: { navigate: vi.fn() }, navigateToDynamicPath: vi.fn() }))
vi.mock('@/storage/SessionMetaStorage', () => ({ sortSessionRecords: vi.fn((records: unknown) => records) }))
vi.mock('../atoms', () => ({}))
vi.mock('../scrollActions', () => ({}))
vi.mock('../sessionActivityStore', () => ({ clearSessionActivity: vi.fn() }))
vi.mock('../sessionHelpers', () => ({ getMetaStorage: vi.fn(), initEmptyChatSession: vi.fn() }))
vi.mock('./message-queue', () => ({ clearQueue: clearQueueMock }))

import { deleteAllArchivedSessions, deleteSession, deleteSessions } from './crud'

function sessionFixture(id: string): Session {
  return {
    id,
    name: 'Session',
    messages: [
      { id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'hi' }] },
      { id: 'streaming-1', role: 'assistant', contentParts: [], generating: true },
      { id: 'placeholder-2', role: 'assistant', contentParts: [], generating: true },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  generationRuntimeMock.getActiveMessageIds.mockReturnValue(new Set<string>())
  sessionQueryBridgeMock.getCachedSession.mockReturnValue(null)
})

describe('deleteSession', () => {
  it('aborts registered runtimes and generating placeholders before the repository delete', async () => {
    generationRuntimeMock.getActiveMessageIds.mockReturnValue(new Set(['streaming-1']))
    sessionQueryBridgeMock.getCachedSession.mockReturnValue(sessionFixture('session-1'))

    await deleteSession('session-1')

    // A generation still preparing its request must never dispatch a billable
    // provider call for a deleted conversation: registered runtimes get a real
    // abort, unregistered placeholders a pendingAbort tombstone.
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-1', 'streaming-1', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-1', 'placeholder-2', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledTimes(2)
    const lastAbortOrder = Math.max(...generationRuntimeMock.requestAbort.mock.invocationCallOrder)
    expect(lastAbortOrder).toBeLessThan(sessionsMock.deleteSession.mock.invocationCallOrder[0])
    expect(clearQueueMock).toHaveBeenCalledWith('session-1')
  })

  it('still deletes when the session surface is not cached', async () => {
    generationRuntimeMock.getActiveMessageIds.mockReturnValue(new Set(['streaming-1']))
    sessionQueryBridgeMock.getCachedSession.mockReturnValue(undefined)

    await deleteSession('session-1')

    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-1', 'streaming-1', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledTimes(1)
    expect(sessionsMock.deleteSession).toHaveBeenCalledWith('session-1')
  })

  it('never fetches the session surface to scan for placeholders', async () => {
    await deleteSession('session-1')

    // Fetching would pull the full message list into the query cache; bulk
    // deletion does this once per session and keeps every one of them resident
    // until the deletion completes.
    expect(sessionQueryBridgeMock.getSession).not.toHaveBeenCalled()
  })
})

describe('deleteSessions', () => {
  it('aborts in-flight generations of every session before the bulk delete', async () => {
    generationRuntimeMock.getActiveMessageIds.mockImplementation((sessionId: string) =>
      sessionId === 'session-2' ? new Set(['streaming-2']) : new Set<string>()
    )

    await deleteSessions(['session-1', 'session-2'])

    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-2', 'streaming-2', 'session-deleted')
    expect(sessionQueryBridgeMock.getSession).not.toHaveBeenCalled()
    expect(sessionsMock.deleteSessions).toHaveBeenCalledWith(['session-1', 'session-2'])
    expect(clearQueueMock).toHaveBeenCalledWith('session-1')
    expect(clearQueueMock).toHaveBeenCalledWith('session-2')
  })
})

describe('deleteAllArchivedSessions', () => {
  it('deletes every archived session through the bulk delete path', async () => {
    sessionsMock.listArchivedSessionsMeta.mockResolvedValue([{ id: 'archived-1' }, { id: 'archived-2' }])

    await deleteAllArchivedSessions()

    expect(sessionsMock.deleteSessions).toHaveBeenCalledWith(['archived-1', 'archived-2'])
    expect(clearQueueMock).toHaveBeenCalledWith('archived-1')
    expect(clearQueueMock).toHaveBeenCalledWith('archived-2')
  })

  it('does nothing when there are no archived sessions', async () => {
    sessionsMock.listArchivedSessionsMeta.mockResolvedValue([])

    await deleteAllArchivedSessions()

    expect(sessionsMock.deleteSessions).not.toHaveBeenCalled()
  })
})
