import { QueryKeys } from '@chatbox/react/query'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  flush: vi.fn(async () => {}),
  settings: vi.fn(async () => {}),
  copilots: vi.fn(async () => {}),
  list: vi.fn(async () => ({ items: [{ id: 'restored', name: 'Restored' }], total: 1, nextCursor: null })),
  archived: vi.fn(async () => ({ items: [{ id: 'archived' }], total: 1, nextCursor: null })),
}))

vi.mock('@/adapters/RendererStoragePersistence', () => ({ flushRendererStorageWrites: mocks.flush }))
vi.mock('@/stores/copilotStore', () => ({ reloadCopilotState: mocks.copilots }))
vi.mock('./renderer-application', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    rendererApplication: {
      settings: { reloadFromStorage: mocks.settings },
      queryClient: client,
      sessions: { listSessionsMetaPage: mocks.list, listArchivedSessionsMetaPage: mocks.archived },
      sessionQueryBridge: {
        resetSessionList: (page: unknown) =>
          client.setQueryData(QueryKeys.ChatSessionsList, { pages: [page], pageParams: [0] }),
        resetArchivedSessionList: (page: unknown) =>
          client.setQueryData(QueryKeys.ArchivedChatSessionsList, { pages: [page], pageParams: [0] }),
      },
    },
  }
})

import { backupRequiresRestart, refreshBackupState } from './backup-restore-state'
import { rendererApplication } from './renderer-application'

beforeEach(() => {
  rendererApplication.queryClient.clear()
  vi.clearAllMocks()
})

test('session restore refreshes mounted list observers without reloading unrelated state', async () => {
  const client = rendererApplication.queryClient
  client.setQueryData(QueryKeys.ChatSessionsList, {
    pages: [{ items: [{ id: 'stale' }], total: 200, nextCursor: 50 }],
    pageParams: [0],
  })
  client.setQueryData(QueryKeys.ArchivedChatSessionsList, {
    pages: [{ items: [], total: 0, nextCursor: null }],
    pageParams: [0],
  })
  client.setQueryData(QueryKeys.ChatSessionSettings('restored'), { model: 'stale-model' })
  const unrelated = { authenticated: true }
  client.setQueryData(['license'], unrelated)
  const observer = new QueryObserver(client, { queryKey: QueryKeys.ChatSessionsList, enabled: false })
  const listener = vi.fn()
  const unsubscribe = observer.subscribe(listener)
  try {
    expect(await refreshBackupState({ data: {} })).toBe(false)
    expect(observer.getCurrentResult().data).toEqual({
      pages: [{ items: [{ id: 'restored', name: 'Restored' }], total: 1, nextCursor: null }],
      pageParams: [0],
    })
    expect(listener).toHaveBeenCalled()
    expect(client.getQueryData(QueryKeys.ArchivedChatSessionsList)).toEqual({
      pages: [{ items: [{ id: 'archived' }], total: 1, nextCursor: null }],
      pageParams: [0],
    })
    expect(client.getQueryData(QueryKeys.ChatSessionSettings('restored'))).toBeUndefined()
    expect(client.getQueryData(['license'])).toBe(unrelated)
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(0)
    expect(mocks.archived).toHaveBeenCalledExactlyOnceWith(0)
    expect(mocks.settings).not.toHaveBeenCalled()
    expect(mocks.copilots).not.toHaveBeenCalled()
    expect(mocks.flush).toHaveBeenCalledOnce()
  } finally {
    unsubscribe()
  }
})

const entry = { path: 'data.json', size: 2, checksum: { algorithm: 'sha256' as const, value: 'a'.repeat(64) } }

test.each(['settings', 'copilots', 'sessionSettings'] as const)(
  '%s entries reload global state and require restart',
  async (key) => {
    const manifest = { data: { [key]: entry } }
    expect(backupRequiresRestart(manifest)).toBe(true)
    expect(await refreshBackupState(manifest)).toBe(true)
    expect(mocks.settings).toHaveBeenCalledOnce()
    expect(mocks.copilots).toHaveBeenCalledOnce()
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(mocks.list).not.toHaveBeenCalled()
  }
)

test('a list refresh failure is propagated instead of reporting a completed restore', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Storage unavailable'))
  await expect(refreshBackupState({ data: {} })).rejects.toThrow('Storage unavailable')
})
