import { BackupOperationCoordinator } from '@chatbox/core/backup'
import { expect, test, vi } from 'vitest'
import { registerNativeBackupProtection } from './native-backup-protection'

test('waits for native protection acknowledgement and releases it after cleanup', async () => {
  const operations = new BackupOperationCoordinator()
  const events: string[] = []
  let acknowledge = () => {}
  const ready = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  registerNativeBackupProtection(operations, {
    setBackupOperationActive: async (active) => {
      events.push(active ? 'protect' : 'unprotect')
      if (active) await ready
    },
  })
  operations.registerParticipant({
    pauseAndDrain: async () => {},
    resume: async () => {
      events.push('cleanup')
    },
  })
  const backup = operations.run('export', async () => {
    events.push('backup')
  })
  await vi.waitFor(() => expect(events).toEqual(['protect']))
  acknowledge()
  await backup
  expect(events).toEqual(['protect', 'backup', 'cleanup', 'unprotect'])
})

test('does not run a backup when native protection fails', async () => {
  const operations = new BackupOperationCoordinator()
  const action = vi.fn()
  const setBackupOperationActive = vi.fn(async (active: boolean) => {
    if (active) throw new Error('IPC unavailable')
  })
  registerNativeBackupProtection(operations, { setBackupOperationActive })
  await expect(operations.run('export', action)).rejects.toThrow('IPC unavailable')
  expect(action).not.toHaveBeenCalled()
  expect(operations.getSnapshot()).toBeNull()
  expect(setBackupOperationActive.mock.calls).toEqual([[true], [false]])
})
