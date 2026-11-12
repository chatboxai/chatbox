import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { SessionMessageDerivedPatch } from './message-derived-data'
import type { Session } from '../../types'

const patch: SessionMessageDerivedPatch = {
  messageId: 'm',
  attachments: [
    {
      id: 'f',
      type: 'file',
      sourceStorageKey: 'file',
      sourceName: 'notes.txt',
      tokenCountMap: { default: 7 },
      tokenCalculatedAt: { default: 200 },
    },
  ],
}
async function setup() {
  const repository = new InMemorySessionRepository()
  const value: Session = {
    id: 's',
    name: 'Chat',
    messages: [
      {
        id: 'm',
        role: 'user',
        contentParts: [{ type: 'text', text: 'Read file' }],
        files: [{ id: 'f', name: 'notes.txt', fileType: 'text/plain', storageKey: 'file' }],
      },
      { id: 'tail', role: 'assistant', contentParts: [] },
    ],
    threads: [{ id: 'old', name: 'Old', createdAt: 1, messages: [{ id: 'archived', role: 'user', contentParts: [] }] }],
    messageForksHash: {
      m: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'selected', messages: [] },
          { id: 'other', messages: [{ id: 'inactive', role: 'assistant', contentParts: [] }] },
        ],
      },
    },
  }
  await repository.seedSession(value)
  return repository
}

describe('point message reads and attachment-derived commits', () => {
  it('reads requested active, archived and inactive identities in deduplicated request order', async () => {
    const repository = await setup()
    const reads = vi.spyOn(repository.rowStore, 'readMessages')
    const result = await repository.readSessionMessages({
      sessionId: 's',
      messageIds: ['inactive', 'archived', 'missing', 'inactive', 'm'],
    })
    expect(result?.messages.map((message) => message.id)).toEqual(['inactive', 'archived', 'm'])
    expect(result?.header).not.toHaveProperty('messages')
    expect(reads).toHaveBeenCalledOnce()
  })
  it('patches one attachment while retaining unrelated body fields and header', async () => {
    const repository = await setup()
    await repository.executeSessionCommand('s', {
      type: 'update',
      messageId: 'm',
      updater: { usage: { inputTokens: 900, outputTokens: 3, totalTokens: 903 } },
    })
    const reads = vi.spyOn(repository.rowStore, 'readMessages')
    const writes = vi.spyOn(repository.rowStore, 'applyDiff')
    const result = await repository.patchSessionMessageDerivedData('s', [patch])
    expect(result).toMatchObject({ previousRevision: 2, revision: 3 })
    expect(result).not.toHaveProperty('session')
    expect(reads.mock.calls.every(([request]) => request.messageIds.length === 1)).toBe(true)
    expect(writes).toHaveBeenCalledOnce()
    expect(writes.mock.calls[0][0].messages.upsert).toHaveLength(1)
    expect((await repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] }))?.messages[0]).toMatchObject({
      usage: { inputTokens: 900 },
      files: [{ tokenCountMap: { default: 7 } }],
    })
  })
  it('discards attachment results after their source identity changed', async () => {
    const repository = await setup()
    await repository.executeSessionCommand('s', {
      type: 'update',
      messageId: 'm',
      updater: { files: [{ id: 'f', name: 'replacement.txt', fileType: 'text/plain', storageKey: 'replacement' }] },
    })
    expect(await repository.patchSessionMessageDerivedData('s', [patch])).toMatchObject({
      previousRevision: 2,
      revision: 2,
      patches: [],
    })
  })
  it('treats missing rows as no-ops and never recreates a deleted session', async () => {
    const repository = await setup()
    expect(await repository.patchSessionMessageDerivedData('s', [{ ...patch, messageId: 'missing' }])).toMatchObject({
      revision: 1,
      patches: [],
    })
    await repository.deleteSession('s')
    await expect(repository.patchSessionMessageDerivedData('s', [patch])).rejects.toMatchObject({
      name: 'SessionNotFoundError',
    })
    expect(await repository.readSessionMessages({ sessionId: 's', messageIds: ['m'] })).toBeNull()
  })
})
