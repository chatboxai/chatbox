import { BackupOperationBusyError } from '@chatbox/core/backup'

const SESSION_WORK_LOCK = 'chatbox-session-work'

/** Hold across generation/compaction, including their final persistence. */
export async function withSessionWorkAccess<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return action()
  return navigator.locks.request(SESSION_WORK_LOCK, { mode: 'shared', ifAvailable: true }, async (lock) => {
    if (!lock) throw new BackupOperationBusyError()
    return action()
  })
}

/** Drain work in other windows before acquiring the backup storage lock. */
export async function withBackupWorkAccess<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return action()
  return navigator.locks.request(SESSION_WORK_LOCK, { mode: 'exclusive', signal }, async () => action())
}
