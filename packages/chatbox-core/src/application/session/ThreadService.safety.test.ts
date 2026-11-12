import { describe, expect, test, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Session } from '../../types'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'
import { ThreadService } from './ThreadService'
import { SessionService } from './SessionService'
import { SessionEventBus } from './session-events'

async function harness() {
  const original: Session = {
    id: 's',
    name: 'Old chat',
    messages: [
      { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'Prompt' }] },
      { id: 'question', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] },
      { id: 'answer', role: 'assistant', contentParts: [{ type: 'text', text: 'Answer' }] },
    ],
  }
  const repository = new InMemorySessionRepository()
  await repository.seedSession(original)
  const writes = new SessionWriteCoordinator(repository)
  let id = 0
  const service = new ThreadService({
    sessions: new SessionService(repository, writes, new SessionEventBus(), { createId: () => 'new', now: () => 1 }),
    createId: () => `id-${++id}`,
    now: () => id,
    getDefaultSystemPrompt: () => 'Prompt',
    cancelMessageIds: vi.fn(),
    copyThread: async () => ({ id: 'copy', name: 'Copied' }),
  })
  return { original, repository, writes, service, read: async () => repository.inspectSession('s') }
}

describe('thread deletion safety with queued persistence', () => {
  test('undo restores history once and duplicate receipts cannot delete the restored conversation', async () => {
    const h = await harness()
    const target = await h.service.createWithRollback('s')
    expect(target).not.toBeNull()
    if (!target) throw new Error('Expected rollback receipt')
    expect(await h.service.rollbackCreated(target)).toBe(true)
    expect(await h.service.rollbackCreated(target)).toBe(false)
    expect((await h.read())?.messages).toEqual(h.original.messages)
  })

  test('simultaneous current-thread deletions do not delete the restored thread', async () => {
    const h = await harness()
    await h.service.refreshContextAndCreateNew('s')
    await Promise.all([h.service.removeCurrent('s'), h.service.removeCurrent('s')])
    expect((await h.read())?.messages).toEqual(h.original.messages)
  })

  test('a stale visible target cannot delete a different current thread', async () => {
    const h = await harness()
    await h.service.refreshContextAndCreateNew('s')
    const created = await h.read()
    if (!created) throw new Error('Expected session')
    const target = await h.repository.getCurrentThreadIdentity('s')
    if (!target) throw new Error('Expected identity')
    expect(await h.service.removeCurrent('s', target)).toBe(true)
    expect(await h.service.removeCurrent('s', target)).toBe(false)
    expect((await h.read())?.messages).toEqual(h.original.messages)
  })

  test('failed creation preserves old messages and returns no receipt', async () => {
    const h = await harness()
    vi.spyOn(h.repository.rowStore, 'applyDiff').mockRejectedValueOnce(new Error('Disk write failed'))
    await expect(h.service.createWithRollback('s')).rejects.toThrow('Disk write failed')
    expect((await h.read())?.messages).toEqual(h.original.messages)
  })

  test('undo refuses a new thread after a message was submitted', async () => {
    const h = await harness()
    const target = await h.service.createWithRollback('s')
    if (!target) throw new Error('Expected rollback receipt')
    await h.repository.executeSessionCommand('s', {
      type: 'append',
      messages: [{ id: 'new-question', role: 'user', contentParts: [] }],
    })
    expect(await h.service.rollbackCreated(target)).toBe(false)
    expect((await h.read())?.messages.at(-1)?.id).toBe('new-question')
    expect((await h.read())?.threads?.[0].messages).toEqual(h.original.messages)
  })

  test('an earlier undo cannot remove a later created thread', async () => {
    const h = await harness()
    const first = await h.service.createWithRollback('s')
    await h.service.createWithRollback('s')
    const before = await h.read()
    if (!first) throw new Error('Expected rollback receipt')
    expect(await h.service.rollbackCreated(first)).toBe(false)
    expect(await h.read()).toEqual(before)
  })
  test('switching threads invalidates the undo target', async () => {
    const h = await harness()
    const target = await h.service.createWithRollback('s')
    const created = await h.read()
    if (!target || !created?.threads?.[0]) throw new Error('Expected archived thread')
    await h.service.switch('s', created.threads[0].id)
    const before = await h.read()
    expect(await h.service.rollbackCreated(target)).toBe(false)
    expect(await h.read()).toEqual(before)
    expect((await h.read())?.messages).toEqual(h.original.messages)
  })

  test('deleting an archived thread does not remove the current conversation', async () => {
    const h = await harness()
    await h.service.refreshContextAndCreateNew('s')
    const created = await h.read()
    if (!created?.threads?.[0]) throw new Error('Expected archived thread')
    await h.service.remove('s', created.threads[0].id)
    expect((await h.read())?.messages).toEqual(created.messages)
    expect((await h.read())?.threads ?? []).toEqual([])
  })

  test('undo does not clear the current conversation when the archived source was deleted', async () => {
    const h = await harness()
    const target = await h.service.createWithRollback('s')
    const created = await h.read()
    if (!target || !created?.threads?.[0]) throw new Error('Expected archived thread')
    await h.service.remove('s', created.threads[0].id)
    expect(await h.service.rollbackCreated(target)).toBe(false)
    expect((await h.read())?.messages).toEqual(created.messages)
  })
})
