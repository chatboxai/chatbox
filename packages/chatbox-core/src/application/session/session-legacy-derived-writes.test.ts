import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSwitchForkToPatch } from '../../session/message-forks'
import { unencodableMessage } from '../../session/session-tree/unencodable.test-support'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySessionRowStore } from '../../testing'
import type { Message, Session } from '../../types'
import { getSessionMessageTokenizationDigest, type SessionMessageDerivedPatch } from './message-derived-data'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionPersistenceProtocol } from './SessionPersistenceProtocol'
import { SessionService } from './SessionService'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'
import { SessionEventBus } from './session-events'

async function setup() {
  const message: Message = { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Current text' }] }
  const session: Session = {
    id: 'legacy',
    name: 'Legacy conversation',
    type: 'chat',
    messages: [message],
    messageForksHash: {
      user: {
        position: 1,
        createdAt: 1,
        lists: [
          { id: 'saved', messages: [unencodableMessage()] },
          { id: 'active', messages: [] },
        ],
      },
    },
  }
  const records = new InMemorySessionRecordStore()
  const rows = new InMemorySessionRowStore()
  const repository = Object.assign(new RowBackedSessionRepository({ records, rows }), {
    meta: new InMemorySessionRepository().meta,
  })
  await repository.initialize()
  await records.setRecord(session)
  const patch: SessionMessageDerivedPatch = {
    messageId: message.id,
    text: [
      {
        tokenizerType: 'default',
        sourceDigest: getSessionMessageTokenizationDigest(message),
        tokens: 3,
        calculatedAt: 10,
        approximate: false,
      },
    ],
  }
  return { session, records, rows, repository, patch }
}

vi.mock('../../session/session-tree/encode', async (importOriginal) => {
  const { failOnUnencodableMarker } = await import('../../session/session-tree/unencodable.test-support')
  const actual = await importOriginal<typeof import('../../session/session-tree/encode')>()
  return { ...actual, encodeSessionTree: failOnUnencodableMarker(actual.encodeSessionTree) }
})

afterEach(() => vi.restoreAllMocks())

describe('legacy derived data writes', () => {
  it('preserves legacy branches and updates caches with one record read and write', async () => {
    const h = await setup()
    const read = vi.spyOn(h.records, 'getRecord')
    const write = vi.spyOn(h.records, 'setRecord')
    const fingerprint = vi.spyOn(SessionPersistenceProtocol.prototype, 'fingerprint')
    const result = await h.repository.patchSessionMessageDerivedData(h.session.id, [h.patch])
    expect(result).toEqual({ sessionId: h.session.id, previousRevision: null, revision: null, patches: [h.patch] })
    expect(read).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(fingerprint).not.toHaveBeenCalled()
    expect(await h.records.getRecord(h.session.id)).toMatchObject({
      messages: [{ ...h.session.messages[0], tokenCountMap: { default: 3 }, tokenCalculatedAt: { default: 10 } }],
      messageForksHash: h.session.messageForksHash,
    })
    expect(await h.rows.hasRows(h.session.id)).toBe(false)
  })

  it('rejects stale results against the latest persisted text', async () => {
    const h = await setup()
    const edited: Session = {
      ...h.session,
      messages: [{ ...h.session.messages[0], contentParts: [{ type: 'text', text: 'Changed elsewhere' }] }],
    }
    await h.records.setRecord(edited)
    const write = vi.spyOn(h.records, 'setRecord')
    expect((await h.repository.patchSessionMessageDerivedData(h.session.id, [h.patch])).patches).toEqual([])
    expect(write).not.toHaveBeenCalled()
    expect(await h.records.getRecord(h.session.id)).toEqual(edited)
  })

  it('orders cache patches with queued appends and message edits', async () => {
    const h = await setup()
    const service = new SessionService(h.repository, new SessionWriteCoordinator(h.repository), new SessionEventBus(), {
      createId: () => 'new',
    })
    const appended: Message = { id: 'reply', role: 'assistant', contentParts: [{ type: 'text', text: 'Draft' }] }
    await Promise.all([
      service.patchSessionMessageDerivedData(h.session.id, [h.patch]),
      service.insertMessage(h.session.id, appended),
      service.updateMessage(h.session.id, appended.id, (message) => {
        if (!message) throw new Error('Missing reply')
        return { ...message, contentParts: [{ type: 'text', text: 'Completed' }] }
      }),
    ])
    const stored = await h.records.getRecord(h.session.id)
    expect(stored).toMatchObject({
      messages: [
        { tokenCountMap: { default: 3 } },
        { id: 'reply', contentParts: [{ type: 'text', text: 'Completed' }] },
      ],
      messageForksHash: h.session.messageForksHash,
    })
  })

  it('keeps a legacy record authoritative over residual promotion rows', async () => {
    const h = await setup()
    const { messageForksHash: _forks, ...encodable } = h.session
    await h.repository.setSession(encodable)
    const revision = await h.rows.getRevision(h.session.id)
    expect(revision).not.toBeNull()
    await h.records.setRecord(h.session)
    await h.repository.patchSessionMessageDerivedData(h.session.id, [h.patch])
    expect(await h.rows.getRevision(h.session.id)).toBe(revision)
    expect(await h.repository.getSession(h.session.id)).toMatchObject({
      messageForksHash: h.session.messageForksHash,
      messages: [{ tokenCountMap: { default: 3 } }],
    })
  })

  it('commits a user and assistant pair together while retaining legacy branches', async () => {
    const h = await setup()
    const service = new SessionService(h.repository, new SessionWriteCoordinator(h.repository), new SessionEventBus(), {
      createId: () => 'new',
    })
    const pair: Message[] = [
      { id: 'next-user', role: 'user', contentParts: [] },
      { id: 'next-assistant', role: 'assistant', contentParts: [], generating: true },
    ]
    const write = vi.spyOn(h.records, 'setRecord')
    await service.insertMessages(h.session.id, pair)
    expect(write).toHaveBeenCalledTimes(1)
    expect(await h.records.getRecord(h.session.id)).toMatchObject({
      messages: [...h.session.messages, ...pair],
      messageForksHash: h.session.messageForksHash,
    })
  })

  it('propagates storage failures and permits retry against the retained record', async () => {
    const h = await setup()
    vi.spyOn(h.records, 'setRecord').mockRejectedValueOnce(new Error('Unavailable'))
    await expect(h.repository.patchSessionMessageDerivedData(h.session.id, [h.patch])).rejects.toThrow()
    expect(await h.records.getRecord(h.session.id)).toEqual(h.session)
    expect((await h.repository.patchSessionMessageDerivedData(h.session.id, [h.patch])).patches).toEqual([h.patch])
  })
})

describe('backup restoration through the write coordinator', () => {
  it('keeps the stored shape of a restored session so later updates apply to it', async () => {
    const records = new InMemorySessionRecordStore()
    const rows = new InMemorySessionRowStore()
    const repository = Object.assign(new RowBackedSessionRepository({ records, rows }), {
      meta: new InMemorySessionRepository().meta,
    })
    await repository.initialize()
    const coordinator = new SessionWriteCoordinator(repository)
    const text = (value: string) => [{ type: 'text' as const, text: value }]
    const restored: Session = {
      id: 'restored',
      name: 'Restored',
      type: 'chat',
      messages: [
        { id: 'u1', role: 'user', contentParts: text('question') },
        { id: 'a1', role: 'assistant', contentParts: text('answer') },
      ],
      messageForksHash: {
        u1: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [{ id: 'old', role: 'assistant', contentParts: text('earlier answer') }] },
            { id: 'saved', messages: [{ id: 'a2', role: 'assistant', contentParts: text('other answer') }] },
          ],
        },
      },
    }

    await coordinator.replaceFromBackup(restored)
    const shown = await repository.getSession(restored.id)
    const residual = shown?.messageForksHash?.u1.lists.findIndex((list) => list.id === 'u1~residual') ?? -1
    expect(residual).toBeGreaterThan(0)
    await coordinator.update(restored.id, (session) => {
      if (!session) throw new Error('Missing session')
      const patch = buildSwitchForkToPatch(session, 'u1', residual)
      if (!patch) throw new Error('The residual branch is not switchable')
      return { ...session, ...patch }
    })

    repository.forgetAllBaselines()
    expect((await repository.getSession(restored.id))?.messages.map((message) => message.id)).toEqual(['u1', 'old'])
  })
})
