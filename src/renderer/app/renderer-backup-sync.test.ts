import { beforeEach, expect, it, vi } from 'vitest'
import { rendererBackupService } from './renderer-backup'

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  importBackup: vi.fn(),
  inspectBackup: vi.fn(),
  deleteSessions: vi.fn(),
}))

vi.mock('@chatbox/core/backup-host', () => ({
  createBackupExportSource: vi.fn(),
  createBackupImportTarget: vi.fn(),
}))
vi.mock('@chatbox/core/backup-export', () => ({ exportBackupStream: mocks.stream }))
vi.mock('@chatbox/core/backup-import', () => ({ importBackup: mocks.importBackup, inspectBackup: mocks.inspectBackup }))
vi.mock('@chatbox/core/backup-v3', () => ({ getBackupImportPartialResult: vi.fn() }))
vi.mock('@chatbox/core/application/session', () => ({
  SessionRowMigration: class {},
  SessionRowWriteQueue: class {},
}))
vi.mock('@/adapters/CurrentSessionRecordStore', () => ({ CurrentSessionRecordStore: class {} }))
vi.mock('@/adapters/backup-resources', () => ({ createRendererBackupResources: vi.fn() }))
vi.mock('@/storage/BackupWorkspace', () => ({
  IndexedDBBackupWorkspace: class {
    async dispose() {}
  },
}))
vi.mock('@/stores/memoryRuntime', () => ({
  reloadCopilotDefinitions: vi.fn(),
  rendererMemoryService: { reload: vi.fn() },
}))
vi.mock('@/platform', () => ({
  default: {
    getSessionRowStore: vi.fn(),
    getSessionMetaStorage: () => ({
      initialize: () => Promise.resolve(),
      async *iterateIds() {
        yield await Promise.resolve('local-session')
        yield 'archived-session'
      },
    }),
    setStoreValue: vi.fn(),
  },
}))
vi.mock('./renderer-application', () => ({
  rendererApplication: {
    queryClient: { resetQueries: async () => {} },
    sessions: {
      reloadFromStorage: vi.fn(),
      deleteSessions: mocks.deleteSessions,
    },
    generationRuntime: { getGeneratingSessionIds: () => [] },
    settings: { reloadFromStorage: vi.fn() },
  },
}))

const selection = { sessions: true, settings: false, copilots: false, credentials: false }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.stream.mockImplementation(async function* () {
    yield await Promise.resolve(Uint8Array.of(42))
    return {}
  })
  mocks.importBackup.mockResolvedValue({})
  mocks.inspectBackup.mockResolvedValue({ formatVersion: 3, selection })
})

it('exports and restores sync data without opening the manual backup overlay', async () => {
  const onProgress = vi.fn()
  const unsubscribe = rendererBackupService.subscribe(onProgress)
  try {
    const backup = await rendererBackupService.exportForSync(selection)
    expect(backup.bytes).toEqual(Uint8Array.of(42))
    await rendererBackupService.replaceForSync(new Blob([new Uint8Array(backup.bytes)]), selection)

    expect(mocks.importBackup).toHaveBeenCalledTimes(1)
    expect(mocks.deleteSessions).toHaveBeenCalledWith(['local-session', 'archived-session'])
    expect(onProgress).not.toHaveBeenCalled()
    expect(rendererBackupService.isActive()).toBe(false)
  } finally {
    unsubscribe()
  }
})

it('rejects a mismatched archive before changing local data', async () => {
  mocks.inspectBackup.mockResolvedValue({ formatVersion: 3, selection: { ...selection, sessions: false } })
  await expect(rendererBackupService.replaceForSync(new Blob(), selection)).rejects.toThrow(
    'unsupported_cloud_sync_payload'
  )
  expect(mocks.deleteSessions).not.toHaveBeenCalled()
  expect(mocks.importBackup).not.toHaveBeenCalled()
})

it('restores the local snapshot after an incomplete cloud import', async () => {
  mocks.importBackup.mockResolvedValueOnce({ importReport: { skippedRecords: 1 } })
  await expect(rendererBackupService.replaceForSync(new Blob(), selection)).rejects.toThrow('sync_restore_incomplete')
  expect(mocks.deleteSessions).toHaveBeenCalledTimes(2)
  expect(mocks.importBackup).toHaveBeenCalledTimes(2)
})

it('retains the overlay for a manual import', async () => {
  const task = rendererBackupService.import(new Blob())

  expect(rendererBackupService.getSnapshot()?.operation).toBe('import')
  await task
  expect(rendererBackupService.getSnapshot()).toBeNull()
})
