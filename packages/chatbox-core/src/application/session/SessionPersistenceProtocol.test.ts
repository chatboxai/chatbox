import { describe, expect, test } from 'vitest'
import { verifySessionTreeRoundTrip } from '../../session/session-tree'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../testing/InMemorySessionRowStore'
import type { Session } from '../../types/session'
import { SessionPersistenceProtocol } from './SessionPersistenceProtocol'

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
