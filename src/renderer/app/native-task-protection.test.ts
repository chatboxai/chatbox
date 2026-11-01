import { ExclusiveOperationCoordinator } from '@chatbox/core/utils/exclusive-operation'
import { expect, test, vi } from 'vitest'
import { registerNativeTaskProtection } from './native-task-protection'

test('waits for native protection acknowledgement and releases it after cleanup', async () => {
  const operations = new ExclusiveOperationCoordinator()
  const events: string[] = []
  let acknowledge = () => {}
  const ready = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  registerNativeTaskProtection(operations, {
    setTaskCloseProtection: async (active) => {
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
  const operation = operations.run(async () => {
    events.push('action')
  })
  await vi.waitFor(() => expect(events).toEqual(['protect']))
  acknowledge()
  await operation
  expect(events).toEqual(['protect', 'action', 'cleanup', 'unprotect'])
})

test('does not run a task when native protection fails', async () => {
  const operations = new ExclusiveOperationCoordinator()
  const action = vi.fn()
  const setTaskCloseProtection = vi.fn(async (active: boolean) => {
    if (active) throw new Error('IPC unavailable')
  })
  registerNativeTaskProtection(operations, { setTaskCloseProtection })
  await expect(operations.run(action)).rejects.toThrow('IPC unavailable')
  expect(action).not.toHaveBeenCalled()
  expect(operations.getSnapshot()).toBeNull()
  expect(setTaskCloseProtection.mock.calls).toEqual([[true], [false]])
})
