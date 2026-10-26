import {
  type BackupHostOptions,
  createBackupExportSource,
  createBackupImportTarget,
  cleanupBackupImport,
  commitBackupSettings,
} from '@chatbox/core/backup-host'
import { importBackup } from '@chatbox/core/backup-import'
import { type BackupExportFormat, type BackupExportResult, exportBackupStream } from '@chatbox/core/backup-export'
import {
  type BackupProgress,
  type BackupResult,
  type BackupSelection,
  getBackupImportPartialResult,
} from '@chatbox/core/backup-v3'
import { SessionRowMigration, SessionRowWriteQueue } from '@chatbox/core/application/session'
import type { ByteSource } from '@chatbox/core/io'
import type { KeyValueStoragePort } from '@chatbox/core/ports'
import { v4 as uuid } from 'uuid'
import { CurrentSessionRecordStore } from '@/adapters/CurrentSessionRecordStore'
import { createRendererBackupResources } from '@/adapters/backup-resources'
import platform from '@/platform'
import { IndexedDBBackupWorkspace } from '@/storage/BackupWorkspace'
import { rendererMemoryService, reloadCopilotDefinitions } from '@/stores/memoryRuntime'
import { rendererApplication } from './renderer-application'

export interface RendererBackupSnapshot {
  operation: 'export' | 'import'
  progress: BackupProgress
  cancelling: boolean
}
type RendererBackupSelection = BackupSelection & { excludedSessionIds?: readonly string[] }
const rawKV: KeyValueStoragePort = {
  get: async <T>(key: string) => ((await platform.getStoreValue(key)) ?? null) as T | null,
  set: (key, value) => platform.setStoreValue(key, value),
  remove: (key) => platform.delStoreValue(key),
  keys: () => platform.getAllStoreKeys(),
}
function host(jobId: string, workspace: IndexedDBBackupWorkspace): BackupHostOptions {
  const rows = platform.getSessionRowStore(),
    metadata = platform.getSessionMetaStorage()
  const records = new CurrentSessionRecordStore({
    getItemRaw: (key) => rawKV.get(key),
    getItem: async <T>(key: string, initial: T) => (await rawKV.get<T>(key)) ?? initial,
    setItemNow: (key, value) => rawKV.set(key, value),
    removeItem: (key) => rawKV.remove(key),
    getAllKeys: () => rawKV.keys(),
  })
  const migration = new SessionRowMigration(records, rows, new SessionRowWriteQueue((_id, action) => action()))
  return {
    jobId,
    workspace,
    storage: rawKV,
    rows,
    records,
    metadata,
    resources: createRendererBackupResources(workspace),
    ensureRows: async (id) => {
      await rows.initialize()
      await migration.ensureRows(id)
    },
    async *listSessionIds() {
      await metadata.initialize()
      if (!metadata.iterateIds) throw new Error('Conversation metadata iteration is unavailable')
      yield* metadata.iterateIds()
    },
    getSettings: () => rendererApplication.settings.getSettings(),
    refresh: async () => {},
  }
}

class RendererBackupService {
  private snapshot: RendererBackupSnapshot | null = null
  private controller: AbortController | null = null
  private listeners = new Set<() => void>()
  private lastProgressAt = 0
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(value: RendererBackupSnapshot | null) {
    this.snapshot = value
    for (const listener of this.listeners) listener()
  }
  isActive = () => this.snapshot !== null
  cancelAndWait = async () => {
    this.cancel()
    if (!this.snapshot) return
    await new Promise<void>((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (!this.snapshot) {
          unsubscribe()
          resolve()
        }
      })
    })
  }
  cancel = () => {
    this.controller?.abort()
    if (this.snapshot) this.update({ ...this.snapshot, cancelling: true })
  }
  async listSessions(
    after: number | null,
    search: string
  ): Promise<{ sessions: Array<{ id: string; name: string }>; next: number | null; total: number }> {
    const meta = platform.getSessionMetaStorage()
    await meta.initialize()
    if (!meta.iterateIds) throw new Error('Conversation metadata iteration is unavailable')
    const total = await meta.getAllTotal()
    const sessions: Array<{ id: string; name: string }> = []
    let offset = 0
    for await (const id of meta.iterateIds()) {
      offset++
      if (offset <= (after ?? 0)) continue
      const entry = await meta.getById(id)
      if (!entry || !entry.name.toLowerCase().includes(search.toLowerCase())) continue
      if (sessions.length === 50) return { sessions, next: offset - 1, total }
      sessions.push({ id: entry.id, name: entry.name })
    }
    return { sessions, next: null, total }
  }
  private onProgress = (progress: BackupProgress) => {
    if (!this.snapshot) return
    const now = Date.now()
    if (this.snapshot.progress.phase === progress.phase && now - this.lastProgressAt < 100) return
    this.lastProgressAt = now
    this.update({ ...this.snapshot, progress })
  }
  getGeneratingSessionIds(selection?: RendererBackupSelection): readonly string[] {
    if (selection && !selection.sessions) return []
    const selected = selection?.sessionIds ? new Set(selection.sessionIds) : null
    const excluded = new Set(selection?.excludedSessionIds)
    return rendererApplication.generationRuntime
      .getGeneratingSessionIds()
      .filter((id) => (!selected || selected.has(id)) && !excluded.has(id))
  }
  async getConversationNames(ids: readonly string[]): Promise<string[]> {
    const meta = platform.getSessionMetaStorage()
    await meta.initialize()
    return Promise.all(ids.map(async (id) => (await meta.getById(id))?.name || id))
  }
  async cleanupBeforeBootstrap(): Promise<void> {
    const probe = new IndexedDBBackupWorkspace('startup')
    try {
      for (const jobId of await probe.listJobIds()) {
        if (jobId === 'startup') continue
        try {
          await cleanupBackupImport(host(jobId, new IndexedDBBackupWorkspace(jobId)))
        } catch (error) {
          console.warn('Could not clean temporary backup data', error)
        }
      }
    } finally {
      await probe.dispose()
    }
  }
  async export(selection: RendererBackupSelection, format: BackupExportFormat = 'v3'): Promise<BackupExportResult> {
    const { excludedSessionIds, ...included } = selection
    const excluded = new Set(excludedSessionIds)
    const sessionIds = included.sessionIds?.filter((id) => !excluded.has(id))
    const exportSelection: BackupSelection =
      format === 'v1'
        ? { sessions: true, settings: false, copilots: false, credentials: false, sessionIds }
        : { ...included, sessionIds }
    return this.run('export', async (options, signal) => {
      const sourceOptions: BackupHostOptions = {
        ...options,
        async *listSessionIds() {
          for await (const id of options.listSessionIds()) {
            if (!excluded.has(id)) yield id
          }
        },
      }
      const application =
        format === 'v2' ? { version: await platform.getVersion(), platform: platform.type } : undefined
      let result: BackupExportResult | undefined
      const delivery = await platform.exporter.exportStreamingFile(
        `chatbox-backup-${new Date().toISOString().slice(0, 10)}${format === 'v1' ? '-v1.json' : format === 'v2' ? '-v2.zip' : '.zip'}`,
        async function* () {
          const stream = exportBackupStream({
            format,
            application,
            archiveId: options.jobId,
            producer: 'Chatbox',
            selection: exportSelection,
            source: createBackupExportSource(sourceOptions, { includeGlobals: format !== 'v1' }),
            workspace: options.workspace,
            signal,
            onProgress: rendererBackupService.onProgress,
          })
          try {
            while (true) {
              const entry = await stream.next()
              if (entry.done) {
                result = entry.value
                return
              }
              yield entry.value
            }
          } finally {
            await stream.return(undefined as never)
          }
        },
        format === 'v1' ? 'application/json' : 'application/zip',
        signal,
        { requiresStreaming: platform.type !== 'web' }
      )
      if (delivery.pendingDownload) {
        const link = document.createElement('a'),
          url = URL.createObjectURL(delivery.pendingDownload.blob)
        link.href = url
        link.download = delivery.pendingDownload.filename
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
      if (!result) throw new DOMException('Export was cancelled', 'AbortError')
      return result
    })
  }
  import(source: ByteSource): Promise<BackupResult> {
    return this.run('import', (options, signal) =>
      importBackup({
        source,
        archiveId: options.jobId,
        workspace: options.workspace,
        target: createBackupImportTarget({
          ...options,
          storage: {
            ...options.storage,
            set: (key, value) =>
              key === 'settings'
                ? commitBackupSettings(value, {
                    settings: rendererApplication.settings,
                    write: (encoded) => options.storage.set(key, encoded),
                    isDesktopLike: platform.isDesktopLike,
                  })
                : options.storage.set(key, value),
          },
        }),
        signal,
        onProgress: this.onProgress,
      })
    )
  }
  private async run<T extends Pick<BackupResult, 'cleanupPending' | 'refreshPending'>>(
    operation: 'export' | 'import',
    action: (options: BackupHostOptions, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.snapshot) throw new Error('A backup operation is already in progress')
    const controller = new AbortController()
    this.controller = controller
    this.update({
      operation,
      cancelling: false,
      progress: { phase: 'preparing', records: 0, messages: 0, resources: 0, bytes: 0 },
    })
    const jobId = uuid(),
      workspace = new IndexedDBBackupWorkspace(jobId)
    let result: T | undefined
    let partial: BackupResult | undefined
    let failure: unknown
    try {
      try {
        result = await action(host(jobId, workspace), controller.signal)
      } catch (error) {
        failure = error
        partial = getBackupImportPartialResult(error)
      }
      if (operation === 'import') {
        const refreshes = await Promise.allSettled([
          rendererApplication.settings.reloadFromStorage(),
          reloadCopilotDefinitions(),
          rendererMemoryService.reload(),
          rendererApplication.sessions.reloadFromStorage(),
        ])
        const imported = result ?? partial
        if (imported && refreshes.some((refresh) => refresh.status === 'rejected')) imported.refreshPending = true
        void rendererApplication.queryClient.resetQueries().catch(() => {})
      }
      if (failure !== undefined) throw failure
      if (!result) throw new Error('Backup operation did not complete')
      return result
    } finally {
      if (operation === 'export') {
        try {
          await workspace.dispose()
        } catch {
          if (result) result.cleanupPending = true
        }
      }
      this.controller = null
      this.update(null)
    }
  }
}
export const rendererBackupService = new RendererBackupService()
