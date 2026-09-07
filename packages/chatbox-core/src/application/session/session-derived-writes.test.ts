import { describe, expect, it, vi } from 'vitest'
import { SessionRowConflictError } from '../../ports'
import { isRowsSessionRecord } from '../../ports/session-record-store'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySessionRowStore } from '../../testing'
import type { Session } from '../../types'
import { getSessionMessageTokenizationDigest, type SessionMessageDerivedPatch } from './message-derived-data'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionService } from './SessionService'
import { SessionNotFoundError, SessionWriteCoordinator } from './SessionWriteCoordinator'
import { type SessionApplicationEvent, SessionEventBus } from './session-events'

async function setup() {
  const rows = new InMemorySessionRowStore()
  const repo = Object.assign(new RowBackedSessionRepository({ rows, records: new InMemorySessionRecordStore() }), {
    meta: new InMemorySessionRepository().meta,
  })
  const session: Session = {
    id: 's',
    name: 's',
    type: 'chat',
    messages: [{ id: 'm', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] }],
  }
  await repo.setSession(session)
  const writes = new SessionWriteCoordinator(repo)
  const events = new SessionEventBus()
  const published: SessionApplicationEvent[] = []
  events.subscribe((event) => {
    published.push(event)
  })
  const service = new SessionService(repo, writes, events, { createId: () => 'new' })
  const patches: SessionMessageDerivedPatch[] = [
    {
      messageId: 'm',
      text: [
        {
          tokenizerType: 'default',
          sourceDigest: getSessionMessageTokenizationDigest(session.messages[0]),
          tokens: 42,
          calculatedAt: 100,
        },
      ],
    },
  ]
  return { repo, rows, writes, service, session, published, patches }
}

describe('derived service and coordinator writes', () => {
  it.each(['unencodable', 'row-write-failure', 'marker-write-failure'] as const)(
    'records the accepted V1 version after an attachment patch (%s)',
    async (fallback) => {
      const rows = new InMemorySessionRowStore()
      const records = new InMemorySessionRecordStore()
      const repo = new RowBackedSessionRepository({ rows, records })
      await repo.initialize()
      const session: Session = {
        id: 'legacy-attachment',
        name: 'Legacy attachment',
        type: 'chat',
        messages: [
          {
            id: 'm',
            role: 'user',
            contentParts: [{ type: 'text', text: 'Read this file' }],
            files: [{ id: 'f', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file-contents' }],
          },
        ],
      }
      if (fallback === 'unencodable') session.messages.push({ id: 'm', role: 'assistant', contentParts: [] })
      await records.setRecord(session)
      if (fallback === 'row-write-failure')
        vi.spyOn(rows, 'writeRows').mockRejectedValueOnce(new Error('Rows unavailable'))
      if (fallback === 'marker-write-failure') {
        const setRecord = records.setRecord.bind(records)
        vi.spyOn(records, 'setRecord').mockImplementation(async (record) => {
          if (isRowsSessionRecord(record)) throw new Error('Marker unavailable')
          await setRecord(record)
        })
      }
      const result = await repo.patchSessionMessageDerivedData(session.id, [
        {
          messageId: 'm',
          attachments: [
            {
              id: 'f',
              type: 'file',
              sourceStorageKey: 'file-contents',
              sourceName: 'notes.txt',
              tokenCountMap: { default: 4 },
              tokenCalculatedAt: { default: 100 },
            },
          ],
        },
      ])
      expect(result.patches).toHaveLength(1)
      expect(result.revision).toBeNull()
      const stored = await records.getRecord(session.id)
      if (!stored || isRowsSessionRecord(stored)) throw new Error('Expected complete V1 fallback')
      expect(stored.messages[0].files?.[0].tokenCountMap).toEqual({ default: 4 })

      await expect(repo.deleteSession(session.id)).resolves.toBeUndefined()
      expect(await records.getRecord(session.id)).toBeNull()
      expect(await rows.hasRows(session.id)).toBe(false)
    }
  )

  it('preserves a recovery archive while clearing stale token seeds on an edited message', async () => {
    const h = await setup()
    await h.repo.meta.create({ id: 's', name: 's', type: 'chat', sortOrder: 1, createdAt: 1 })
    await h.writes.update('s', {
      messages: [{ ...h.session.messages[0], tokenCountMap: { default: 42 }, tokenCalculatedAt: { default: 100 } }],
    })
    await h.writes.archiveMetadataOnly('s', 50)

    await h.writes.update('s', (current) => {
      if (!current) throw new Error('Expected current session')
      return {
        ...current,
        messages: [{ ...current.messages[0], contentParts: [{ type: 'text', text: 'changed text' }] }],
      }
    })

    const saved = await h.repo.getSession('s')
    expect(saved).toMatchObject({ hidden: true, archivedAt: 50 })
    expect(saved?.messages[0].contentParts).toEqual([{ type: 'text', text: 'changed text' }])
    expect(saved?.messages[0].tokenCountMap).toBeUndefined()
    expect(saved?.messages[0].tokenCalculatedAt).toBeUndefined()
    expect(await h.repo.meta.getById('s')).toMatchObject({ hidden: true, archivedAt: 50 })
    expect((await h.repo.meta.getById('s'))?.recoveryArchived).toBeUndefined()
  })

  it('reads target IDs and commits derived data without full hydration or a full-session event', async () => {
    const h = await setup()
    const full = vi.spyOn(h.repo, 'getSession')
    const snapshots = vi.spyOn(h.rows, 'readSnapshot')
    const selected = vi.spyOn(h.rows, 'readMessages')
    const source = await h.service.readSessionMessages({ sessionId: 's', messageIds: ['m'] })
    const result = await h.service.patchSessionMessageDerivedData('s', h.patches)
    expect(source?.messages.map((message) => message.id)).toEqual(['m'])
    expect(selected).toHaveBeenCalledWith({ sessionId: 's', messageIds: ['m'] })
    expect(full).not.toHaveBeenCalled()
    expect(snapshots).not.toHaveBeenCalled()
    expect(h.published).toEqual([{ type: 'session-derived-data-patched', ...result }])
    expect(result.revision).toBe((result.previousRevision ?? 0) + 1)
    await h.service.patchSessionMessageDerivedData('s', [{ ...h.patches[0], messageId: 'missing' }])
    expect(h.published).toHaveLength(1)
  })

  it('serializes a full write after a selected commit and preserves the committed counts', async () => {
    const h = await setup()
    h.writes.prime(h.session)
    let release: (() => void) | undefined
    const original = h.repo.patchSessionMessageDerivedData.bind(h.repo)
    vi.spyOn(h.repo, 'patchSessionMessageDerivedData').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return original(...args)
    })
    const fullWrite = vi.spyOn(h.repo, 'setSession')
    const narrow = h.service.patchSessionMessageDerivedData('s', h.patches)
    await vi.waitFor(() => expect(release).toBeDefined())
    const full = h.service.updateSession('s', { name: 'renamed' })
    await Promise.resolve()
    expect(fullWrite).not.toHaveBeenCalled()
    release?.()
    await Promise.all([narrow, full])
    const saved = await h.repo.getSession('s')
    expect(saved?.name).toBe('renamed')
    expect(saved?.messages[0].tokenCountMap?.default).toBe(42)
  })

  it('drains queued derived writes before deletion and fences late writes', async () => {
    const h = await setup()
    let release: (() => void) | undefined
    const original = h.repo.patchSessionMessageDerivedData.bind(h.repo)
    const patch = vi.spyOn(h.repo, 'patchSessionMessageDerivedData').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return original(...args)
    })
    const pending = h.writes.patchMessageDerivedData('s', h.patches)
    await vi.waitFor(() => expect(release).toBeDefined())
    const deletion = h.writes.delete('s', () => h.repo.deleteSession('s'))
    await expect(h.writes.patchMessageDerivedData('s', h.patches)).rejects.toBeInstanceOf(SessionNotFoundError)
    release?.()
    await Promise.all([pending, deletion])
    expect(await h.repo.getSession('s')).toBeNull()
    await expect(h.writes.patchMessageDerivedData('s', h.patches)).rejects.toBeInstanceOf(SessionNotFoundError)
    expect(patch).toHaveBeenCalledTimes(1)
  })

  it('uses the complete-safe fallback only for repositories without selected reads', async () => {
    const repo = new InMemorySessionRepository()
    const session: Session = {
      id: 'legacy',
      name: 'legacy',
      type: 'chat',
      messages: [],
      threads: [
        {
          id: 'archive',
          name: 'archive',
          createdAt: 1,
          messages: [{ id: 'archived', role: 'user', contentParts: [] }],
        },
      ],
    }
    await repo.setSession(session)
    const service = new SessionService(repo, new SessionWriteCoordinator(repo), new SessionEventBus(), {
      createId: () => 'new',
    })
    const selected = await service.readSessionMessages({
      sessionId: 'legacy',
      messageIds: ['archived', 'missing', 'archived'],
    })
    expect(selected?.messages.map((message) => message.id)).toEqual(['archived'])
    expect(selected?.revision).toBeNull()
    await expect(
      service.readSessionMessages({ sessionId: 'legacy', messageIds: ['archived'], expectedRevision: 1 })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    expect(
      (await service.getSessionContextSource({ sessionId: 'legacy', threadId: 'archive' }))?.candidateMessages
    ).toEqual(session.threads?.[0].messages)
  })
})
