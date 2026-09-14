import { SessionEventBus } from '@chatbox/core/application/session'
import { describe, expect, it, vi } from 'vitest'
import { registerWorkspaceCleanup } from './workspace-cleanup'
import { WorkspaceLifecycle } from './workspace-lifecycle'

describe('session workspace cleanup', () => {
  it.each([['one'], ['one', 'two', 'three']])('aborts before deleting every workspace in %j', async (...ids) => {
    const events = new SessionEventBus()
    const order: string[] = []
    const workspace = {
      remove: vi.fn(async (id: string) => {
        order.push(`remove:${id}`)
      }),
      reopen: vi.fn(),
    }
    const unsubscribe = registerWorkspaceCleanup(events, workspace, (id) => {
      order.push(`abort:${id}`)
    })
    await events.publish({ type: 'session-will-delete', ids, operation: 'bulk session deletion' })
    expect(workspace.remove).not.toHaveBeenCalled()
    await events.publish({ type: 'session-deleted', ids })
    expect(order).toEqual([...ids.map((id) => `abort:${id}`), ...ids.map((id) => `remove:${id}`)])
    unsubscribe()
    await events.publish({ type: 'session-deleted', ids })
    expect(workspace.remove).toHaveBeenCalledTimes(ids.length)
  })

  it('rejects queued native operations after deletion and allows a restored session', async () => {
    const lifecycle = new WorkspaceLifecycle()
    const operation = vi.fn(async () => undefined)
    const queued = lifecycle.run('session', operation)
    const deletion = lifecycle.remove('session', async () => undefined)
    await expect(queued).rejects.toThrow('deleted')
    await deletion
    expect(operation).not.toHaveBeenCalled()
    await expect(lifecycle.run('session', operation)).rejects.toThrow('deleted')
    lifecycle.reopen('session')
    await expect(lifecycle.run('session', operation)).resolves.toBeUndefined()
  })
})
