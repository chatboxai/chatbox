import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { SessionMessageDerivedPatch } from './message-derived-data'
import { SessionService } from './SessionService'
import { SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'
import { type SessionApplicationEvent, SessionEventBus } from './session-events'

async function setup() {
  const repository = new InMemorySessionRepository()
  await repository.seedSession({
    id: 's',
    name: 'Chat',
    messages: [
      {
        id: 'm',
        role: 'user',
        contentParts: [],
        files: [{ id: 'f', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file' }],
      },
    ],
  })
  const writes = new SessionWriteCoordinator(repository)
  const events = new SessionEventBus()
  const published: SessionApplicationEvent[] = []
  events.subscribe((event) => {
    published.push(event)
  })
  const service = new SessionService(repository, writes, events, { createId: () => 'new' })
  const patches: SessionMessageDerivedPatch[] = [
    {
      messageId: 'm',
      attachments: [
        {
          id: 'f',
          type: 'file',
          sourceStorageKey: 'file',
          sourceName: 'notes.txt',
          tokenCountMap: { default: 42 },
          tokenCalculatedAt: { default: 100 },
        },
      ],
    },
  ]
  return { repository, writes, service, published, patches }
}

describe('derived service and coordinator row writes', () => {
  it('publishes accepted local patches and ignores absent message identities', async () => {
    const h = await setup()
    const selected = vi.spyOn(h.repository.rowStore, 'readMessages')
    const result = await h.service.patchSessionMessageDerivedData('s', h.patches)
    expect(selected.mock.calls.every(([request]) => request.messageIds.length === 1)).toBe(true)
    expect(h.published).toEqual([{ type: 'session-derived-data-patched', ...result }])
    expect(result.revision).toBe(2)
    await h.service.patchSessionMessageDerivedData('s', [{ ...h.patches[0], messageId: 'missing' }])
    expect(h.published).toHaveLength(1)
  })
  it('orders a header command after a selected derived commit', async () => {
    const h = await setup()
    let release!: () => void
    let entered!: () => void
    const barrier = new Promise<void>((done) => {
      release = done
    })
    const started = new Promise<void>((done) => {
      entered = done
    })
    const original = h.repository.patchSessionMessageDerivedData
    vi.spyOn(h.repository, 'patchSessionMessageDerivedData').mockImplementationOnce(async (...args) => {
      entered()
      await barrier
      return original(...args)
    })
    const narrow = h.service.patchSessionMessageDerivedData('s', h.patches)
    await started
    const header = h.service.updateSessionHeader('s', { name: 'Renamed' })
    release()
    await Promise.all([narrow, header])
    expect((await h.repository.getSessionHeader('s'))?.header.name).toBe('Renamed')
    expect(
      (await h.repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] }))?.messages[0].files?.[0]
        .tokenCountMap?.default
    ).toBe(42)
  })
  it('drains queued derived writes before deletion and fences late writes', async () => {
    const h = await setup()
    let release!: () => void
    let entered!: () => void
    const barrier = new Promise<void>((done) => {
      release = done
    })
    const started = new Promise<void>((done) => {
      entered = done
    })
    const original = h.repository.patchSessionMessageDerivedData
    const patch = vi.spyOn(h.repository, 'patchSessionMessageDerivedData').mockImplementationOnce(async (...args) => {
      entered()
      await barrier
      return original(...args)
    })
    const pending = h.writes.patchMessageDerivedData('s', h.patches)
    await started
    const deletion = h.writes.delete('s', () => h.repository.deleteSession('s'))
    await expect(h.writes.patchMessageDerivedData('s', h.patches)).rejects.toBeInstanceOf(SessionNotFoundError)
    release()
    await Promise.all([pending, deletion])
    expect(await h.repository.getSessionHeader('s')).toBeNull()
    await expect(h.writes.patchMessageDerivedData('s', h.patches)).rejects.toBeInstanceOf(SessionNotFoundError)
    expect(patch).toHaveBeenCalledTimes(1)
  })
})
