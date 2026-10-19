import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generationRuntimeMock, sessionsMock, sessionQueryBridgeMock, clearQueueMock } = vi.hoisted(() => ({
  generationRuntimeMock: {
    clearSessionStop: vi.fn(),
    beginSessionStop: vi.fn(),
    getActiveMessageIds: vi.fn((_sessionId: string) => new Set<string>()),
    requestAbort: vi.fn(),
  },
  sessionsMock: {
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteSessions: vi.fn().mockResolvedValue(undefined),
    listArchivedSessionsMeta: vi.fn().mockResolvedValue([]),
    listSessionFolders: vi.fn().mockResolvedValue([]),
    moveSessionToFolder: vi.fn().mockResolvedValue(undefined),
  },
  sessionQueryBridgeMock: {
    getCachedHeader: vi.fn(),
    listSessionsMeta: vi.fn().mockResolvedValue([]),
    updateSessionListData: vi.fn(),
  },
  clearQueueMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { BackupOperationCoordinator } = await import('@chatbox/core/backup')
  return {
    rendererApplication: {
      backupOperations: new BackupOperationCoordinator(),
      generationRuntime: generationRuntimeMock,
      sessions: sessionsMock,
      sessionQueryBridge: sessionQueryBridgeMock,
    },
  }
})
vi.mock('@/platform', () => ({ default: { isDesktopLike: false } }))
vi.mock('@/router', () => ({ router: { navigate: vi.fn() }, navigateToDynamicPath: vi.fn() }))
vi.mock('@/storage/SessionMetaStorage', () => ({ sortSessionRecords: vi.fn((records: unknown) => records) }))
vi.mock('../atoms', () => ({}))
vi.mock('../scrollActions', () => ({}))
vi.mock('../sessionActivityStore', () => ({ clearSessionActivity: vi.fn() }))
vi.mock('../sessionHelpers', () => ({ getMetaStorage: vi.fn(), initEmptyChatSession: vi.fn() }))
vi.mock('./message-queue', () => ({ clearQueue: clearQueueMock }))
vi.mock('../uiStore', () => ({ uiStore: { getState: () => ({ collapsedSessionFolderIds: [] }) } }))

import type { SessionMetaRecord } from '@shared/types'
import { getMetaStorage } from '../sessionHelpers'
import { deleteAllArchivedSessions, deleteSession, deleteSessions, reorderSessions } from './crud'

beforeEach(() => {
  vi.clearAllMocks()
  generationRuntimeMock.getActiveMessageIds.mockReturnValue(new Set<string>())
})

describe('deleteSession', () => {
  it('fences the session and aborts registered generation preparations before the repository delete', async () => {
    generationRuntimeMock.getActiveMessageIds.mockReturnValue(new Set(['streaming-1', 'placeholder-2']))

    await deleteSession('session-1')

    // Preparing generations must be stopped before the conversation is deleted.
    expect(generationRuntimeMock.beginSessionStop).toHaveBeenCalledWith('session-1', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-1', 'streaming-1', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-1', 'placeholder-2', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledTimes(2)
    const lastAbortOrder = Math.max(...generationRuntimeMock.requestAbort.mock.invocationCallOrder)
    expect(lastAbortOrder).toBeLessThan(sessionsMock.deleteSession.mock.invocationCallOrder[0])
    expect(clearQueueMock).toHaveBeenCalledWith('session-1')
    expect(generationRuntimeMock.clearSessionStop).toHaveBeenCalledWith('session-1')
  })

  it('still deletes when the session surface is not cached', async () => {
    generationRuntimeMock.getActiveMessageIds.mockReturnValue(new Set(['streaming-1']))

    await deleteSession('session-1')

    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-1', 'streaming-1', 'session-deleted')
    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledTimes(1)
    expect(sessionsMock.deleteSession).toHaveBeenCalledWith('session-1')
  })

  it('never fetches the session surface to scan for placeholders', async () => {
    await deleteSession('session-1')

    expect(sessionQueryBridgeMock.getCachedHeader).not.toHaveBeenCalled()
  })
})

describe('deleteSessions', () => {
  it('aborts in-flight generations of every session before the bulk delete', async () => {
    generationRuntimeMock.getActiveMessageIds.mockImplementation((sessionId: string) =>
      sessionId === 'session-2' ? new Set(['streaming-2']) : new Set<string>()
    )

    await deleteSessions(['session-1', 'session-2'])

    expect(generationRuntimeMock.requestAbort).toHaveBeenCalledWith('session-2', 'streaming-2', 'session-deleted')
    expect(sessionQueryBridgeMock.getCachedHeader).not.toHaveBeenCalled()
    expect(sessionsMock.deleteSessions).toHaveBeenCalledWith(['session-1', 'session-2'])
    expect(clearQueueMock).toHaveBeenCalledWith('session-1')
    expect(clearQueueMock).toHaveBeenCalledWith('session-2')
    expect(generationRuntimeMock.clearSessionStop).toHaveBeenCalledWith('session-1')
    expect(generationRuntimeMock.clearSessionStop).toHaveBeenCalledWith('session-2')
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

describe('reorderSessions', () => {
  const record = (id: string, sortOrder: number, folderId: string): SessionMetaRecord => ({
    id,
    name: id,
    sortOrder,
    createdAt: sortOrder,
    folderId,
  })

  it('places a chat dropped at the end of the loaded rows before the next stored chat of that folder', async () => {
    const loaded = [record('a1', 100, 'A'), record('a2', 90, 'A'), record('b1', 80, 'B')]
    const stored = [...loaded, record('b2', 70, 'B'), record('b3', 60, 'B')]
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue(loaded)
    sessionsMock.listSessionFolders.mockResolvedValue([
      { id: 'A', name: 'A' },
      { id: 'B', name: 'B' },
    ])
    vi.mocked(getMetaStorage).mockResolvedValue({
      getAll: () => Promise.resolve(stored),
    } as unknown as Awaited<ReturnType<typeof getMetaStorage>>)

    await reorderSessions('a2', 'b1')

    expect(sessionsMock.moveSessionToFolder).toHaveBeenCalledWith('a2', 'B', 75)
  })
})
