import type { BackupOperationCoordinator } from '@chatbox/core/backup'

/** Register before maintenance participants so native protection is released last. */
export function registerNativeBackupProtection(
  operations: BackupOperationCoordinator,
  host: { setBackupOperationActive?(active: boolean): Promise<void> }
): () => void {
  if (!host.setBackupOperationActive) return () => {}
  const setProtection = host.setBackupOperationActive.bind(host)
  return operations.registerParticipant({
    pauseAndDrain: () => setProtection(true),
    resume: () => setProtection(false),
  })
}
