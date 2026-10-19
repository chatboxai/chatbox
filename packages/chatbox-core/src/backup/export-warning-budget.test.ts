import type { Session } from '@shared/types'
import { expect, it, vi } from 'vitest'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import type { BackupExportOptions } from './export-backup'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import { prepareBackupExport } from './preflight'
import { BackupResourceCatalog } from './resource-catalog'
import { collectSessionResourceReferences } from './resources'
import type { BackupSessionStore } from './session-port'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { BackupWarningBudgetError } from './warning-index'

function externalSession(id: string, count = 400): Session {
  return {
    id,
    name: id,
    messages: Array.from({ length: count }, (_, index) => ({
      id: `m-${index}`,
      role: 'user',
      contentParts: [],
      files: [
        {
          id: `f-${index}`,
          name: `${id}-${index}-${'x'.repeat(3000)}.pdf`,
          fileType: 'application/pdf',
          localPath: '/external/file',
        },
      ],
    })),
  }
}
const options = () => ({
  storage: new MemoryStorage(),
  metaStorage: new MemoryMetaStorage(),
  exportItems: ['conversations'] as ['conversations'],
  includeKeys: false,
  application: { version: 'test', platform: 'test' },
})

it.each(['v2', 'v3'] as const)(
  'stops %s external-only warnings before consuming the remaining sessions and closes the writer',
  async (format) => {
    const ids = ['s0', 's1', 's2', 's3']
    expect(collectSessionResourceReferences(externalSession('probe', 1)).references).toEqual([])
    let sessionsRead = 0
    let closedSources = 0
    let writerClosed = false
    let writerCompleted = false
    const store: BackupSessionStore = {
      listSessionIds: async () => ids,
      beginBackupRestore: async () => {
        throw new Error('Read-only source')
      },
      async *iterateBackupRows(id) {
        sessionsRead++
        const snapshot = contextSnapshot(externalSession(id))
        try {
          yield { kind: 'header', record: snapshot.record }
          for (const thread of snapshot.rows.threads) yield { kind: 'thread', thread }
          for (const message of snapshot.rows.messages) yield { kind: 'message', message }
        } finally {
          closedSources++
        }
      },
    }
    const request: BackupExportOptions = {
      ...options(),
      selectedSessionIds: ids,
      ...(format === 'v3'
        ? { sharded: { store } }
        : {
            sessionStore: store,
            prepared: await prepareBackupExport({ ...options(), sessionStore: store }, { preparedEntryBytes: 0 }),
          }),
      writeArchive: async (stream) => {
        try {
          for await (const chunk of stream()) void chunk
          writerCompleted = true
          return { boundedMemory: true }
        } finally {
          writerClosed = true
        }
      },
    }
    sessionsRead = 0
    closedSources = 0
    await expect(exportBackupArchive(request)).rejects.toBeInstanceOf(BackupWarningBudgetError)
    expect(sessionsRead).toBeLessThan(ids.length)
    expect(writerClosed).toBe(true)
    expect(writerCompleted).toBe(false)
    if (format === 'v3') expect(closedSources).toBe(sessionsRead)
  }
)

it('propagates a resource failure warning budget error instead of continuing with later resources', async () => {
  const catalog = new BackupResourceCatalog()
  catalog.add([
    { kind: 'image', storageKey: 'missing-a' },
    { kind: 'image', storageKey: 'missing-b' },
  ])
  const storage = new MemoryStorage()
  const get = vi.spyOn(storage, 'getBlob').mockRejectedValue(new Error('x'.repeat(4 * 1024 * 1024)))
  await expect(async () => {
    for await (const entry of catalog.entries({ storage })) void entry
  }).rejects.toBeInstanceOf(BackupWarningBudgetError)
  expect(get).toHaveBeenCalledTimes(1)
  expect(catalog.warnings.size).toBe(0)
})
