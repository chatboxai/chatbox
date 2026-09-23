import type { SessionFolder, SessionMetaRecord } from '@shared/types'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const queryClient = new QueryClient()

const {
  getAllIncludingHiddenMock,
  getMetaStorageMock,
  listAllSessionsMetaMock,
  removeCollapsedFolderMock,
  setItemNowMock,
  storageGetItemMock,
  updateSessionMock,
} = vi.hoisted(() => ({
  getAllIncludingHiddenMock: vi.fn(),
  getMetaStorageMock: vi.fn(),
  listAllSessionsMetaMock: vi.fn(),
  removeCollapsedFolderMock: vi.fn(),
  setItemNowMock: vi.fn(),
  storageGetItemMock: vi.fn(),
  updateSessionMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    get queryClient() {
      return queryClient
    },
    sessions: {
      listAllSessionsMeta: listAllSessionsMetaMock,
      updateSession: updateSessionMock,
    },
  },
}))

vi.mock('./sessionHelpers', () => ({
  getMetaStorage: getMetaStorageMock,
}))

vi.mock('@/storage', () => ({
  default: {
    getItem: storageGetItemMock,
    setItemNow: setItemNowMock,
  },
}))

vi.mock('./uiStore', () => ({
  uiStore: { getState: () => ({ removeCollapsedFolder: removeCollapsedFolderMock }) },
}))

import { deleteFolder } from './sessionFolders'

const folderA: SessionFolder = { id: 'folder-a', name: 'Folder A', sortOrder: 2000, createdAt: 1 }

function meta(id: string, overrides: Partial<SessionMetaRecord> = {}): SessionMetaRecord {
  return { id, name: `Session ${id}`, sortOrder: 1, createdAt: 1, ...overrides }
}

describe('deleteFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // listFolders() short-circuits on the query cache, so reset it per test.
    queryClient.clear()
    storageGetItemMock.mockResolvedValue([folderA])
    setItemNowMock.mockResolvedValue(undefined)
    getMetaStorageMock.mockResolvedValue({ getAllIncludingHidden: getAllIncludingHiddenMock })
    updateSessionMock.mockResolvedValue(undefined)
  })

  test('clears folderId on hidden (archived) members via getAllIncludingHidden', async () => {
    // listAllSessionsMeta pages with hidden=0 filtering, so the archived member
    // would be missed by it — deleteFolder must sweep the hidden-inclusive list.
    const visibleMember = meta('visible-member', { folderId: 'folder-a' })
    const hiddenMember = meta('hidden-member', { folderId: 'folder-a', hidden: true, archivedAt: 123 })
    const nonMember = meta('non-member', { folderId: 'folder-b' })
    const unfiled = meta('unfiled')
    getAllIncludingHiddenMock.mockResolvedValue([visibleMember, hiddenMember, nonMember, unfiled])
    listAllSessionsMetaMock.mockResolvedValue([visibleMember, unfiled])

    await deleteFolder('folder-a')

    // The sweep reads the hidden-inclusive repository list, not the paged API.
    expect(getMetaStorageMock).toHaveBeenCalledTimes(1)
    expect(getAllIncludingHiddenMock).toHaveBeenCalledTimes(1)
    expect(listAllSessionsMetaMock).not.toHaveBeenCalled()

    // Both the visible and the archived member get their folderId cleared.
    expect(updateSessionMock).toHaveBeenCalledTimes(2)
    expect(updateSessionMock).toHaveBeenCalledWith('visible-member', { folderId: undefined })
    expect(updateSessionMock).toHaveBeenCalledWith('hidden-member', { folderId: undefined })

    // The folder blob is persisted without the deleted folder, and its
    // collapsed state is cleaned up.
    expect(setItemNowMock).toHaveBeenCalledWith('session-folders', [])
    expect(removeCollapsedFolderMock).toHaveBeenCalledWith('folder-a')
  })

  test('keeps other folders and skips sessions filed elsewhere', async () => {
    const folderB: SessionFolder = { id: 'folder-b', name: 'Folder B', sortOrder: 1000, createdAt: 2 }
    storageGetItemMock.mockResolvedValue([folderA, folderB])
    const otherMember = meta('other-member', { folderId: 'folder-b' })
    getAllIncludingHiddenMock.mockResolvedValue([otherMember])

    await deleteFolder('folder-a')

    expect(updateSessionMock).not.toHaveBeenCalled()
    expect(setItemNowMock).toHaveBeenCalledWith('session-folders', [folderB])
  })
})
