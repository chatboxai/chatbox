import { describe, expect, test, vi } from 'vitest'
import type { SessionRowStorePort } from '../../ports/session-row-store'
import * as sessionTree from '../../session/session-tree'
import { verifySessionTreeRoundTrip } from '../../session/session-tree'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Session } from '../../types/session'
import * as sessionLoad from './compatibility/session-load'
import { decodeLegacyRecord, SessionPersistenceProtocol } from './SessionPersistenceProtocol'

const session: Session = {
  id: 'session-1',
  type: 'chat',
  name: 'Session',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      contentParts: [{ type: 'text', text: 'hello' }],
      timestamp: 1_000,
    },
  ],
}

describe('SessionPersistenceProtocol', () => {
  const legacyFixtures: Record<string, Session> = {
    'summary fork without a preceding message': {
      ...session,
      messages: [{ id: 'summary', role: 'assistant', contentParts: [], isSummary: true }],
      messageForksHash: {
        summary: {
          createdAt: 1,
          position: 3,
          lists: [{ id: 'saved', messages: session.messages }],
        },
      },
    },
    'legacy message fields': {
      ...session,
      messages: [
        {
          id: 'old-message',
          role: 'assistant',
          contentParts: [],
          content: 'Saved answer',
          pictures: [{ storageKey: 'saved-image' }],
          webBrowsing: { query: ['saved query'], links: [{ title: 'Source', url: 'https://example.com' }] },
        } as Session['messages'][number],
      ],
    },
    'repaired topology and archived messages': {
      ...session,
      messages: [...session.messages, { id: 'summary', role: 'assistant', contentParts: [], isSummary: true }],
      threads: [{ id: session.id, name: '', createdAt: 1, messages: session.messages }],
      messageForksHash: {
        summary: {
          createdAt: 1,
          position: 0,
          lists: [
            { id: 'occupied-placeholder', messages: [{ id: '', role: 'assistant', contentParts: [] }] },
            { id: 'saved', messages: [{ id: 'saved-message', role: 'assistant', contentParts: [] }] },
          ],
        },
        unreachable: { createdAt: 1, position: 0, lists: [{ id: 'orphan', messages: session.messages }] },
      },
    },
    'empty containers and token seeds': {
      ...session,
      messages: [{ ...session.messages[0], tokenCountMap: { default: 3 }, tokenCalculatedAt: { default: 1 } }],
      threads: [],
      messageForksHash: {},
      compactionPoints: [],
    },
  }

  test('keeps the general fingerprint fallback when normalization cannot establish a canonical shape', async () => {
    const records = new InMemorySessionRecordStore()
    const rows = new InMemorySessionRowStore()
    const protocol = new SessionPersistenceProtocol(records, rows)
    await Promise.all([records.initialize(), rows.initialize()])
    await records.setRecord(session)
    const normalize = vi
      .spyOn(sessionTree, 'normalizeSessionV1')
      .mockReturnValue({ ok: false, reason: 'Unsupported topology' })
    try {
      const state = await protocol.inspectPersistedState(session.id)
      if (state.kind !== 'legacy') throw new Error('expected legacy')
      expect(state.version.fingerprint).toBe(protocol.fingerprint(state.session))
      expect(await records.getRecord(session.id)).toEqual(session)
      expect(await rows.getRevision(session.id)).toBeNull()
    } finally {
      normalize.mockRestore()
    }
  })

  test.each(Object.entries(legacyFixtures))(
    'prepares %s with the same content version across migration',
    async (_, input) => {
      for (const excludeEstimatedTextTokens of [false, true]) {
        const records = new InMemorySessionRecordStore()
        const rows: SessionRowStorePort = new InMemorySessionRowStore()
        if (excludeEstimatedTextTokens) rows.acceptTextTokenResults = async (results) => [...results]
        const protocol = new SessionPersistenceProtocol(records, rows)
        await Promise.all([records.initialize(), rows.initialize()])
        const original = structuredClone(input)
        const expectedSession = decodeLegacyRecord(structuredClone(input))
        const expectedFingerprint = protocol.fingerprint(expectedSession)
        await records.setRecord(original)

        const normalize = vi.spyOn(sessionTree, 'normalizeSessionV1')
        const migrate = vi.spyOn(sessionLoad, 'migrateSession')
        let legacy: Awaited<ReturnType<typeof protocol.inspectPersistedState>>
        try {
          legacy = await protocol.inspectPersistedState(input.id)
          expect(normalize).toHaveBeenCalledTimes(1)
          expect(migrate).toHaveBeenCalledTimes(2)
        } finally {
          normalize.mockRestore()
          migrate.mockRestore()
        }
        if (legacy.kind !== 'legacy') throw new Error('expected a legacy state')
        expect(legacy.session).toEqual(expectedSession)
        expect(legacy.version.fingerprint).toBe(expectedFingerprint)
        expect(legacy.session.messages[0].tokenCountMap).toEqual(expectedSession.messages[0].tokenCountMap)

        const encoded = verifySessionTreeRoundTrip(legacy.session, { activeThreadId: input.id, now: 1_000 })
        if (!encoded.ok) throw new Error(encoded.reason)
        const snapshot = {
          rows: { sessionId: input.id, threads: encoded.tree.threads, messages: encoded.tree.messages },
          record: encoded.tree.session,
          revision: 1,
        }
        await rows.writeRows(snapshot, null)
        const interrupted = await protocol.inspectPersistedState(input.id)
        if (interrupted.kind !== 'interrupted-promotion') throw new Error('expected an interrupted promotion')
        expect(interrupted.version.fingerprint).toBe(expectedFingerprint)
        const promoted = await protocol.promote(interrupted, legacy.session, snapshot.rows, snapshot.record)
        expect(promoted.kind).toBe('committed')
        expect(await rows.getRevision(input.id)).toBe(1)
        const committed = await protocol.inspectPersistedState(input.id)
        if (committed.kind !== 'rows') throw new Error('expected rows')
        expect(committed.version.fingerprint).toBe(expectedFingerprint)
        expect(protocol.fingerprint({ ...legacy.session, name: 'Changed title' })).not.toBe(expectedFingerprint)
      }
    }
  )

  test('classifies missing, legacy, interrupted-promotion and rows states with one version token', async () => {
    const records = new InMemorySessionRecordStore()
    const rows = new InMemorySessionRowStore()
    const protocol = new SessionPersistenceProtocol(records, rows)
    await Promise.all([records.initialize(), rows.initialize()])

    await expect(protocol.inspectPersistedState(session.id)).resolves.toMatchObject({ kind: 'missing' })

    await records.setRecord(session)
    const legacy = await protocol.inspectPersistedState(session.id)
    expect(legacy).toMatchObject({ kind: 'legacy', version: { revision: null } })
    if (legacy.kind !== 'legacy') throw new Error('expected a legacy state')

    const encoded = verifySessionTreeRoundTrip(session, { activeThreadId: session.id, now: 1_000 })
    if (!encoded.ok) throw new Error(encoded.reason)
    await rows.writeRows(
      {
        rows: { sessionId: session.id, threads: encoded.tree.threads, messages: encoded.tree.messages },
        record: encoded.tree.session,
        revision: 1,
      },
      null
    )
    const interrupted = await protocol.inspectPersistedState(session.id)
    expect(interrupted).toMatchObject({ kind: 'interrupted-promotion', revision: 1, version: { revision: null } })
    if (interrupted.kind !== 'interrupted-promotion') throw new Error('expected an interrupted promotion')
    expect(interrupted.version.fingerprint).toBe(legacy.version.fingerprint)

    await records.setRecord(encoded.tree.session)
    const rowBacked = await protocol.inspectPersistedState(session.id)
    expect(rowBacked).toMatchObject({ kind: 'rows', version: { revision: 1 } })
    if (rowBacked.kind !== 'rows') throw new Error('expected a row-backed state')
    expect(rowBacked.version.fingerprint).toBe(legacy.version.fingerprint)
  })
})
