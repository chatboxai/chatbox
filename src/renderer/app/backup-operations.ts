import { type BackupOperationKind, throwIfAborted } from '@chatbox/core/backup'
import { waitForSessionGenerations } from '@chatbox/core/generation'
import { flushRendererStorageWrites } from '@/adapters/RendererStoragePersistence'
import { withBackupWorkAccess } from '@/adapters/session-work-lock'
import { rendererApplication } from './renderer-application'

/** Flush host-level accepted work before any backup storage access begins. */
export function runRendererBackupOperation<T>(
  kind: BackupOperationKind,
  action: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  return rendererApplication.backupOperations.run(kind, async (signal) => {
    await waitForSessionGenerations(signal)
    await rendererApplication.generationRuntime.waitForIdle(signal)
    await rendererApplication.settings.flushPersistence()
    await flushRendererStorageWrites()
    throwIfAborted(signal)
    return withBackupWorkAccess(() => action(signal), signal)
  })
}
