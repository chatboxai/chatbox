import { describe, expect, it, vi } from 'vitest'
import { selectContextMessages } from '@shared/context/builder'
import { findMessageContext, findMessageSourceThread } from '@shared/session/message-forks'
import { InMemorySessionRowStore } from '../testing/InMemorySessionRowStore'
import { InMemorySessionRecordStore } from '../testing/InMemorySessionRecordStore'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import { decodeSessionTree, deriveSessionRecord, sessionTopologyFingerprint } from '../session/session-tree'
import type { Session, Message } from '../types/session'
import { contextPathFacts, deriveContextReadProjection } from './session-context-read'
import { contextSession, contextSnapshot } from './session-context-read.test-support'

async function setup(session = contextSession()) {
  const rows = new InMemorySessionRowStore()
  const records = new InMemorySessionRecordStore()
  const repo = new RowBackedSessionRepository({ rows, records })
  await repo.setSession(session)
  return { rows, records, repo }
}

describe('context source planning', () => {
  it('keeps checkpoint reads bounded when an unrelated tail stream settles', async () => {
    const { repo, rows, records } = await setup()
    const before = (await repo.getSession('context-session'))!
    const after = {
      ...before,
      messages: before.messages.map((message) =>
        message.id === 'target' ? { ...message, generating: false, timestamp: 999 } : message
      ),
    }
    await repo.setSession(after, { changedMessageId: 'target', baseSession: before })
    const reopened = new RowBackedSessionRepository({ rows, records })
    expect((await reopened.getSessionContextSource({ sessionId: before.id }))?.mode).toBe('compacted')
    for (const id of ['boundary', 'summary', 'system']) {
      const baseline = (await reopened.getSession(before.id))!
      const changed = {
        ...baseline,
        messages: baseline.messages.map((message) => (message.id === id ? { ...message, generating: true } : message)),
      }
      await reopened.setSession(changed, { changedMessageId: id, baseSession: baseline })
      expect((await rows.readSnapshot(before.id))?.record.contextReadProjection).toBeUndefined()
      await reopened.setSession(before, { baseSession: changed })
    }
  })
  it('keeps real validation messages and preserves the full-source context and prefix facts', async () => {
    const session = contextSession()
    session.messages[1].files = [
      { id: 'f', name: 'older.txt', fileType: 'txt', storageKey: 'older', rawStorageKey: 'raw' },
    ]
    const { repo, rows } = await setup(session)
    const readSnapshot = vi.spyOn(rows, 'readSnapshot')
    const source = await repo.getSessionContextSource({ sessionId: session.id, targetMessageId: 'target' })
    expect(source?.mode).toBe('compacted')
    expect(source?.candidateMessages.map((message) => message.id)).toEqual([
      'system',
      'boundary',
      'summary',
      'question',
    ])
    expect(source?.candidateMessages.find((message) => message.id === 'boundary')).toEqual(session.messages.at(-4))
    expect(selectContextMessages(source!.candidateMessages, source!)).toEqual(
      selectContextMessages(session.messages.slice(0, -1), session)
    )
    expect(source?.beforeTarget).toEqual(contextPathFacts(session.messages.slice(0, -1)))
    expect(source?.header.threadName).toBe('Active')
    expect(source?.header).not.toHaveProperty('contextReadProjection')
    expect(source?.header).not.toHaveProperty('topologyFingerprint')
    expect(source?.header).not.toHaveProperty('messages')
    expect(source?.topologyFingerprint).toBe(sessionTopologyFingerprint(session))
    expect(readSnapshot).not.toHaveBeenCalled()
    // @ts-expect-error A context source cannot be passed to a complete-session writer.
    const complete: Session = source!
    expect(complete).toBe(source)
  })

  it.each(['missing-projection', 'steering', 'missing-summary', 'generating-boundary', 'fork-marker-boundary'])(
    'uses safe full-path semantics for %s',
    async (mode) => {
      const session = contextSession()
      if (mode === 'steering') session.messages[2].steered = true
      if (mode === 'missing-summary') session.compactionPoints![0].summaryMessageId = 'missing'
      if (mode === 'generating-boundary') session.messages.at(-4)!.generating = true
      if (mode === 'fork-marker-boundary') session.messages.at(-4)!.isForkMarker = true
      const snapshot = contextSnapshot(session)
      if (mode === 'missing-projection') delete snapshot.record.contextReadProjection
      const rows = new InMemorySessionRowStore()
      await rows.writeRows(snapshot)
      const source = await rows.readContext({ sessionId: session.id, targetMessageId: 'target' })
      expect(source?.mode).toBe('full-path')
      expect(source?.messages.map((row) => row.message)).toEqual(session.messages.slice(0, -1))
      expect(
        selectContextMessages(
          source!.messages.map((row) => row.message),
          { compactionPoints: source!.thread.compactionPoints }
        )
      ).toEqual(selectContextMessages(session.messages.slice(0, -1), session))
    }
  )

  it('applies an older intact point when the latest pair is on another fork', async () => {
    const session = contextSession()
    const alternate: Message[] = [
      { id: 'alternate', role: 'assistant', contentParts: [] },
      { id: 'alternate-summary', role: 'assistant', isSummary: true, contentParts: [] },
      { id: 'alternate-target', role: 'assistant', generating: true, contentParts: [] },
    ]
    session.messageForksHash = {
      question: {
        createdAt: 1,
        position: 0,
        lists: [
          { id: 'active-branch', messages: [] },
          { id: 'alternate-branch', messages: alternate },
        ],
      },
    }
    session.compactionPoints!.push({
      boundaryMessageId: 'alternate',
      summaryMessageId: 'alternate-summary',
      createdAt: 20,
    })
    const { rows } = await setup(session)
    for (const id of ['target', 'alternate-target']) {
      const source = await rows.readContext({ sessionId: session.id, targetMessageId: id })
      const path = findMessageContext(session, id)!.list
      const prefix = path.slice(
        0,
        path.findIndex((message) => message.id === id)
      )
      expect(
        selectContextMessages(
          source!.messages.map((row) => row.message),
          { compactionPoints: source!.thread.compactionPoints }
        )
      ).toEqual(selectContextMessages(prefix, session))
      expect(source?.beforeTarget).toEqual(contextPathFacts(prefix))
      expect(source?.effectiveCompactionPoint?.createdAt).toBe(id === 'target' ? 10 : 20)
    }
  })

  it('selects archived-thread facts and settings without mixing active context', async () => {
    const archived = contextSession()
    const session: Session = {
      id: archived.id,
      type: 'chat',
      name: 'Main',
      threadName: 'Current',
      settings: { temperature: 0.7 },
      messages: [],
      threads: [
        {
          id: 'archive',
          name: 'Archive',
          createdAt: 1,
          messages: archived.messages,
          compactionPoints: archived.compactionPoints,
        },
      ],
    }
    const { repo } = await setup(session)
    const source = await repo.getSessionContextSource({ sessionId: session.id, targetMessageId: 'target' })
    expect(source?.thread.threadId).toBe('archive')
    expect(source?.header.settings).toEqual(session.settings)
    expect(source?.header.threadName).toBe('Current')
    expect(source?.compactionPoints).toEqual(findMessageSourceThread(session, 'target')?.compactionPoints)
    expect(source?.mode).toBe('compacted')
  })

  it('supports an empty thread and a first-message target', async () => {
    const empty = { ...contextSession(), messages: [], compactionPoints: [] }
    const { repo } = await setup(empty)
    expect((await repo.getSessionContextSource({ sessionId: empty.id }))?.candidateMessages).toEqual([])
    const one = { ...empty, messages: [{ id: 'first', role: 'user' as const, timestamp: 99, contentParts: [] }] }
    await repo.setSession(one)
    const source = await repo.getSessionContextSource({ sessionId: one.id, targetMessageId: 'first' })
    expect(source?.candidateMessages).toEqual([])
    expect(source?.beforeTarget.firstMessageTimestamp).toBe(99)
    expect(source?.beforeTarget.userMessageCount).toBe(0)
  })

  it('preserves read projections for derived fields and invalidates changed semantic facts', () => {
    const session = contextSession()
    const snapshot = contextSnapshot(session)
    const before = session.messages[1]
    expect(
      deriveSessionRecord(session, session.id, {
        record: snapshot.record,
        before,
        after: { ...before, tokenCountMap: { default: 5 } },
      }).contextReadProjection
    ).toBe(snapshot.record.contextReadProjection)
    for (const after of [
      { ...before, role: 'system' as const },
      { ...before, steered: true },
    ]) {
      expect(
        deriveSessionRecord(session, session.id, { record: snapshot.record, before, after }).contextReadProjection
      ).toBeUndefined()
    }
    expect(
      deriveSessionRecord(session, session.id, {
        record: snapshot.record,
        before: session.messages[0],
        after: { ...session.messages[0], timestamp: 999 },
      }).contextReadProjection
    ).toBeUndefined()
    expect(
      deriveSessionRecord(session, session.id, {
        record: snapshot.record,
        before,
        after: { ...before, timestamp: 999 },
      }).contextReadProjection
    ).toBe(snapshot.record.contextReadProjection)
    const decoded = decodeSessionTree({
      session: snapshot.record,
      threads: snapshot.rows.threads,
      messages: snapshot.rows.messages,
    })
    expect(decoded.ok && decoded.session).not.toHaveProperty('contextReadProjection')
    expect(decoded.ok && decoded.session).not.toHaveProperty('topologyFingerprint')
  })

  it('stores each historical attachment once across many checkpoints', () => {
    const session = contextSession(100)
    session.messages[1].files = [{ id: 'f', name: 'old.txt', fileType: 'txt', storageKey: 'old' }]
    session.compactionPoints = Array.from({ length: 90 }, (_, index) => ({
      boundaryMessageId: `prefix-${index + 1}`,
      summaryMessageId: 'summary',
      createdAt: index,
    }))
    const snapshot = contextSnapshot(session)
    const projection = deriveContextReadProjection(snapshot.rows.threads, snapshot.rows.messages)
    expect(projection.threads[session.id].attachments).toHaveLength(1)
    expect(JSON.stringify(projection).match(/old\.txt/g)).toHaveLength(1)
    expect(projection.threads[session.id].checkpoints).toHaveLength(90)
  })

  it.each([false, true])(
    'keeps legacy and interrupted promotion reads on the authoritative full record (%s)',
    async (interrupted) => {
      const session = contextSession()
      const { repo, records, rows } = await setup(session)
      if (!interrupted) await rows.deleteRows(session.id)
      await records.setRecord(session)
      const source = await repo.getSessionContextSource({ sessionId: session.id, targetMessageId: 'target' })
      expect(source?.mode).toBe('full-path')
      expect(source?.revision).toBeNull()
      expect(source?.candidateMessages).toEqual(session.messages.slice(0, -1))
      expect(await records.getRecord(session.id)).not.toHaveProperty('storageFormat')
    }
  )
})
