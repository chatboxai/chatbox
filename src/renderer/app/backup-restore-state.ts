import type { BackupManifest, BackupManifestV3 } from '@chatbox/core/backup'
import { QueryKeys } from '@chatbox/react/query'
import { flushRendererStorageWrites } from '@/adapters/RendererStoragePersistence'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { reloadCopilotState } from '@/stores/copilotStore'
import { rendererApplication } from './renderer-application'

const log = getLogger('backup-restore')

/** Compaction only returns disk space, so a failure leaves the completed restore intact. */
export async function compactStoreAfterRestore(): Promise<void> {
  try {
    await platform.compactStore?.()
  } catch (error) {
    log.warn('Failed to compact storage after restore', error)
  }
}

/** Global entries can affect services initialized only at application startup. */
export function backupRequiresRestart(manifest: Pick<BackupManifest | BackupManifestV3, 'data'>): boolean {
  return Boolean(manifest.data.settings || manifest.data.copilots || manifest.data.sessionSettings)
}

/** Session bodies have already been discarded by the importer; refresh bounded list pages. */
export async function refreshBackupState(manifest: Pick<BackupManifest | BackupManifestV3, 'data'>): Promise<boolean> {
  if (backupRequiresRestart(manifest)) {
    await rendererApplication.settings.reloadFromStorage()
    await reloadCopilotState()
    await flushRendererStorageWrites()
    await rendererApplication.queryClient.resetQueries()
    return true
  }

  await flushRendererStorageWrites()
  const sessions = await rendererApplication.sessions.listSessionsMetaPage(0)
  rendererApplication.sessionQueryBridge.resetSessionList(sessions)
  const archived = await rendererApplication.sessions.listArchivedSessionsMetaPage(0)
  rendererApplication.sessionQueryBridge.resetArchivedSessionList(archived)
  await rendererApplication.queryClient.resetQueries({ queryKey: [QueryKeys.ChatSessionSettings('')[0]] })
  return false
}
