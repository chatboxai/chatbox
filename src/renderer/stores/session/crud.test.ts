import type { Session, SessionMetaRecord } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  generationRuntimeMock,
  sessionsMock,
  sessionQueryBridgeMock,
  clearQueueMock,
  metaStorageMock,
  getMetaStorageMock,
} = vi.hoisted(() => {
  const metaStorageMock = {
    update: vi.fn().mockResolvedValue(undefined),
  }
  return {
    generationRuntimeMock: {
      clearSessionStop: vi.fn(),
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
      listSessionsMeta: vi.fn(),
      updateSessionListData: vi.fn(),
    },
    clearQueueMock: vi.fn(),
    metaStorageMock,
    getMetaStorageMock: vi.fn().mockResolvedValue(metaStorageMock),
  }
})

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
vi.mock('../sessionHelpers', () => ({
  getMetaStorage: getMetaStorageMock,
  initEmptyChatSession: vi.fn(),
}))
vi.mock('./message-queue', () => ({ clearQueue: clearQueueMock }))

import { deleteAllArchivedSessions, deleteSession, deleteSessions, reorderSessions } from './crud'

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
    expect(generationRuntimeMock.clearSessionStop).toHaveBeenCalledWith('session-1')
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

function metaRecord(id: string, overrides: Partial<SessionMetaRecord> = {}): SessionMetaRecord {
  return {
    id,
    name: `Session ${id}`,
    sortOrder: 0,
    createdAt: 0,
    ...overrides,
  }
}

describe('reorderSessions', () => {
  beforeEach(() => {
    getMetaStorageMock.mockClear()
    metaStorageMock.update.mockClear()
    sessionQueryBridgeMock.updateSessionListData.mockReset()
    sessionQueryBridgeMock.updateSessionListData.mockReturnValue(undefined)
  })

  it('drops cross-group drags (pinned onto unpinned) without persisting', async () => {
    // The guard moved out of SessionList into the store: dragging a pinned
    // session onto a regular one must not move anything or touch storage.
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([
      metaRecord('pinned', { starred: true, sortOrder: 3000 }),
      metaRecord('regular', { sortOrder: 2000 }),
    ])

    await reorderSessions('pinned', 'regular')

    expect(metaStorageMock.update).not.toHaveBeenCalled()
    expect(sessionQueryBridgeMock.updateSessionListData).not.toHaveBeenCalled()
  })

  it('drops cross-group drags (unfiled onto another folder) without persisting', async () => {
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([
      metaRecord('unfiled', { sortOrder: 3000 }),
      metaRecord('foldered', { folderId: 'folder-a', sortOrder: 2000 }),
      metaRecord('other-folder', { folderId: 'folder-b', sortOrder: 1000 }),
    ])

    await reorderSessions('unfiled', 'foldered')
    await reorderSessions('foldered', 'other-folder')

    expect(metaStorageMock.update).not.toHaveBeenCalled()
    expect(sessionQueryBridgeMock.updateSessionListData).not.toHaveBeenCalled()
  })

  it('drops same-position drags without listing or persisting', async () => {
    await reorderSessions('session-1', 'session-1')

    expect(sessionQueryBridgeMock.listSessionsMeta).not.toHaveBeenCalled()
    expect(metaStorageMock.update).not.toHaveBeenCalled()
  })

  it('drops drags whose sessions are missing from the meta list', async () => {
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([metaRecord('session-1')])

    await reorderSessions('session-1', 'missing')

    expect(metaStorageMock.update).not.toHaveBeenCalled()
  })

  it('persists a fractional sortOrder between same-group neighbors', async () => {
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([
      metaRecord('pinned-1', { starred: true, sortOrder: 3000 }),
      metaRecord('pinned-2', { starred: true, sortOrder: 2500 }),
      metaRecord('pinned-3', { starred: true, sortOrder: 2000 }),
      // Different groups: must not influence the pinned group's neighbor math.
      metaRecord('regular-1', { sortOrder: 5000 }),
    ])

    // Moving pinned-3 onto pinned-2's slot lands it between pinned-1 and pinned-2.
    await reorderSessions('pinned-3', 'pinned-2')

    expect(metaStorageMock.update).toHaveBeenCalledTimes(1)
    expect(metaStorageMock.update).toHaveBeenCalledWith('pinned-3', { sortOrder: 2750 })
    expect(sessionQueryBridgeMock.updateSessionListData).toHaveBeenCalledTimes(1)
  })

  it('persists a reorder within the same folder without leaking other groups', async () => {
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([
      metaRecord('folder-a-1', { folderId: 'folder-a', sortOrder: 3000 }),
      metaRecord('folder-a-2', { folderId: 'folder-a', sortOrder: 2500 }),
      metaRecord('folder-a-3', { folderId: 'folder-a', sortOrder: 2000 }),
      metaRecord('folder-b-1', { folderId: 'folder-b', sortOrder: 9000 }),
      metaRecord('pinned-1', { starred: true, sortOrder: 8000 }),
    ])

    await reorderSessions('folder-a-3', 'folder-a-2')

    expect(metaStorageMock.update).toHaveBeenCalledTimes(1)
    expect(metaStorageMock.update).toHaveBeenCalledWith('folder-a-3', { sortOrder: 2750 })
  })

  it('moves to the top of the group when there is no session above', async () => {
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([
      metaRecord('top', { sortOrder: 3000 }),
      metaRecord('bottom', { sortOrder: 2000 }),
    ])

    await reorderSessions('bottom', 'top')

    expect(metaStorageMock.update).toHaveBeenCalledWith('bottom', { sortOrder: 4000 })
  })

  it('moves to the bottom of the group when there is no session below', async () => {
    sessionQueryBridgeMock.listSessionsMeta.mockResolvedValue([
      metaRecord('top', { sortOrder: 3000 }),
      metaRecord('bottom', { sortOrder: 2000 }),
    ])

    await reorderSessions('top', 'bottom')

    expect(metaStorageMock.update).toHaveBeenCalledWith('top', { sortOrder: 1000 })
  })
})
