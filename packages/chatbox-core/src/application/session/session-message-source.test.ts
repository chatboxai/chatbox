import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { contextSession } from '../../persistence/session-context-read.test-support'
import {
  applySessionMessageDerivedPatch,
  getSessionMessageTokenizationDigest,
  type SessionMessageDerivedPatch,
} from './message-derived-data'
import type { Message, Session } from '../../types/session'
import { isRowsSessionRecord } from '../../ports/session-record-store'

function textPatch(message: Message, tokens = 7): SessionMessageDerivedPatch {
  return {
    messageId: message.id,
    text: [
      {
        tokenizerType: 'default',
        sourceDigest: getSessionMessageTokenizationDigest(message),
        tokens,
        calculatedAt: 200,
      },
    ],
  }
}

async function setup(session = contextSession()) {
  const rows = new InMemorySessionRowStore()
  const records = new InMemorySessionRecordStore()
  const writer = new RowBackedSessionRepository({ records, rows })
  await writer.setSession(session)
  const repo = new RowBackedSessionRepository({ records, rows })
  return { rows, records, repo }
}

describe('targeted message reads and derived commits', () => {
  it('discards an outdated baseline when another writer changed the session before a token patch', async () => {
    const { repo, rows, records } = await setup()
    const original = (await repo.getSession('context-session'))!
    const other = new RowBackedSessionRepository({ rows, records })
    const current = (await other.getSession(original.id))!
    await other.setSession({ ...current, name: 'Changed elsewhere' }, { baseSession: current })
    await repo.patchSessionMessageDerivedData(original.id, [textPatch(original.messages.at(-2)!)])
    await expect(repo.setSession({ ...original, name: 'Stale' }, { baseSession: original })).rejects.toMatchObject({
      name: 'SessionWriteConflictError',
    })
    expect((await repo.getSession(original.id))?.name).toBe('Changed elsewhere')
  })

  it('keeps a matching write baseline after a token patch so the next insert does not reread history', async () => {
    const { repo, rows } = await setup(contextSession(1000))
    const original = (await repo.getSession('context-session'))!
    const patch = textPatch(original.messages.at(-2)!)
    const readSnapshot = vi.spyOn(rows, 'readSnapshot')
    await repo.patchSessionMessageDerivedData(original.id, [patch])
    const replayed: Session = {
      ...original,
      messages: original.messages.map((message) => applySessionMessageDerivedPatch(message, patch)?.message ?? message),
    }
    const added: Message = { id: 'appended', role: 'user', contentParts: [{ type: 'text', text: 'Continue' }] }
    await repo.setSession({ ...replayed, messages: [...replayed.messages, added] }, { baseSession: replayed })
    expect(readSnapshot).not.toHaveBeenCalled()
    const stored = await repo.getSession(original.id)
    expect(stored?.messages.at(-1)?.id).toBe(added.id)
    expect(stored?.messages.find((message) => message.id === patch.messageId)?.tokenCountMap?.default).toBe(7)
  })

  it('reads and patches one row without decoding a session or returning a full projection', async () => {
    const session = contextSession(1000)
    const message = session.messages.at(-2)!
    message.usage = { inputTokens: 123, outputTokens: 45, totalTokens: 168 }
    message.timestamp = 100
    const { repo, rows } = await setup(session)
    const before = (await rows.readSnapshot(session.id))!
    const readSnapshot = vi.spyOn(rows, 'readSnapshot')
    const readMessages = vi.spyOn(rows, 'readMessages')
    const applyDiff = vi.spyOn(rows, 'applyDiff')
    const source = await repo.readSessionMessages({ sessionId: session.id, messageIds: [message.id] })
    expect(source?.messages).toEqual([message])
    const result = await repo.patchSessionMessageDerivedData(session.id, [textPatch(message)])
    expect(result).toMatchObject({ sessionId: session.id, previousRevision: 1, revision: 2 })
    expect(result).not.toHaveProperty('session')
    expect(result).not.toHaveProperty('messages')
    expect(readSnapshot).not.toHaveBeenCalled()
    expect(readMessages.mock.calls.every(([request]) => request.messageIds.length === 1)).toBe(true)
    expect(applyDiff).toHaveBeenCalledTimes(1)
    expect(applyDiff.mock.calls[0][0].messages.upsert).toHaveLength(1)
    expect(applyDiff.mock.calls[0][0].threads).toEqual({ upsert: [], delete: [] })
    const after = (await rows.readMessages({ sessionId: session.id, messageIds: [message.id] }))!
    expect(after.record).toEqual(before.record)
    expect(after.messages[0]).toEqual({
      ...before.rows.messages.find((row) => row.messageId === message.id),
      message: {
        ...message,
        tokenCountMap: { default: 7 },
        tokenCalculatedAt: { default: 200 },
        tokenCountApproximate: undefined,
      },
    })
    expect((await repo.getSessionContextSource({ sessionId: session.id }))?.mode).toBe('compacted')
  })

  it('re-reads after a CAS conflict and discards a result for edited text', async () => {
    const session = contextSession()
    const { repo, rows } = await setup(session)
    const message = session.messages.at(-2)!
    const originalRead = rows.readMessages.bind(rows)
    vi.spyOn(rows, 'readMessages').mockImplementationOnce(async (request) => {
      const snapshot = (await originalRead(request))!
      const current = snapshot.messages[0]
      await rows.applyDiff(
        {
          sessionId: session.id,
          threads: { upsert: [], delete: [] },
          messages: {
            upsert: [
              {
                ...current,
                message: { ...current.message, contentParts: [{ type: 'text', text: 'Edited while estimating' }] },
              },
            ],
            delete: [],
          },
        },
        { record: snapshot.record, revision: snapshot.revision + 1 },
        snapshot.revision
      )
      return snapshot
    })
    const result = await repo.patchSessionMessageDerivedData(session.id, [textPatch(message)])
    expect(result).toEqual({ sessionId: session.id, previousRevision: 2, revision: 2, patches: [] })
    expect(
      (await originalRead({ sessionId: session.id, messageIds: [message.id] }))?.messages[0].message
    ).not.toHaveProperty('tokenCountMap')
  })

  it('does not overwrite unrelated fields after a CAS retry', async () => {
    const session = contextSession()
    const { repo, rows } = await setup(session)
    const message = session.messages.at(-2)!
    const originalRead = rows.readMessages.bind(rows)
    vi.spyOn(rows, 'readMessages').mockImplementationOnce(async (request) => {
      const snapshot = (await originalRead(request))!
      const current = snapshot.messages[0]
      await rows.applyDiff(
        {
          sessionId: session.id,
          threads: { upsert: [], delete: [] },
          messages: {
            upsert: [
              {
                ...current,
                message: { ...current.message, usage: { inputTokens: 900, outputTokens: 3, totalTokens: 903 } },
              },
            ],
            delete: [],
          },
        },
        { record: snapshot.record, revision: snapshot.revision + 1 },
        snapshot.revision
      )
      return snapshot
    })
    expect((await repo.patchSessionMessageDerivedData(session.id, [textPatch(message)])).revision).toBe(3)
    expect(
      (await originalRead({ sessionId: session.id, messageIds: [message.id] }))?.messages[0].message
    ).toMatchObject({ tokenCountMap: { default: 7 }, usage: { inputTokens: 900, outputTokens: 3, totalTokens: 903 } })
  })

  it('rejects stale complete-session writes after a derived commit and accepts a replayed base', async () => {
    const session = contextSession()
    const { repo } = await setup(session)
    const old = (await repo.getSession(session.id))!
    const patch = textPatch(old.messages.at(-2)!)
    await repo.patchSessionMessageDerivedData(session.id, [patch])
    await expect(repo.setSession({ ...old, name: 'stale' }, { baseSession: old })).rejects.toMatchObject({
      name: 'SessionWriteConflictError',
    })
    const replayed: Session = {
      ...old,
      messages: old.messages.map((message) => applySessionMessageDerivedPatch(message, patch)?.message ?? message),
    }
    await repo.setSession({ ...replayed, name: 'fresh' }, { baseSession: replayed })
    expect((await repo.getSession(session.id))?.name).toBe('fresh')
  })

  it('handles missing rows as no-ops and never recreates a deleted session', async () => {
    const session = contextSession()
    const { repo } = await setup(session)
    const patch = { ...textPatch(session.messages.at(-2)!), messageId: 'missing' }
    expect(await repo.patchSessionMessageDerivedData(session.id, [patch])).toMatchObject({
      previousRevision: 1,
      revision: 1,
      patches: [],
    })
    await repo.deleteSession(session.id)
    await expect(repo.patchSessionMessageDerivedData(session.id, [patch])).rejects.toMatchObject({
      name: 'SessionNotFoundError',
    })
    expect(await repo.readSessionMessages({ sessionId: session.id, messageIds: ['question'] })).toBeNull()
  })

  it.each([false, true])('preserves legacy derived data through explicit migration (%s)', async (interrupted) => {
    const session = contextSession()
    const { repo, rows, records } = await setup(session)
    if (!interrupted) await rows.deleteRows(session.id)
    await records.setRecord(session)
    const source = await repo.readSessionMessages({ sessionId: session.id, messageIds: ['question'] })
    expect(source?.revision).toBeNull()
    const rowRevision = await rows.getRevision(session.id)
    const result = await repo.patchSessionMessageDerivedData(session.id, [textPatch(session.messages.at(-2)!)])
    expect(result.previousRevision).toBeNull()
    expect(result.revision).toBeNull()
    expect(await rows.getRevision(session.id)).toBe(rowRevision)
    expect(isRowsSessionRecord((await records.getRecord(session.id))!)).toBe(false)
    expect(
      (await repo.readSessionMessages({ sessionId: session.id, messageIds: ['question'] }))?.messages[0].tokenCountMap
        ?.default
    ).toBe(7)
    await repo.migrateSession(session.id)
    const complete = await repo.getSession(session.id)
    expect(complete?.messages).toHaveLength(session.messages.length)
    expect(complete?.messages.find((message) => message.id === 'question')?.tokenCountMap?.default).toBe(7)
    expect(isRowsSessionRecord((await records.getRecord(session.id))!)).toBe(true)
  })
})
