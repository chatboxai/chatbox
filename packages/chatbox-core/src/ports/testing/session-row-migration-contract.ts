import { SessionRowMigration } from '../../application/session/SessionRowMigration'
import { SessionRowWriteQueue } from '../../application/session/SessionRowWriteQueue'
import { verifySessionTreeRoundTrip } from '../../session/session-tree/verify'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import type { SessionRowStoreContractFactory } from './session-row-store-contract'

export async function verifyPublishedFormatUpgrade(factory: SessionRowStoreContractFactory) {
  const rows = await factory()
  const verified = verifySessionTreeRoundTrip(
    {
      id: 'upgrade',
      name: 'Published',
      messages: [{ id: 'saved', role: 'user', contentParts: [{ type: 'text', text: 'authoritative' }] }],
    },
    { activeThreadId: 'active', now: 1 }
  )
  if (!verified.ok) throw new Error(verified.reason)
  await rows.writeRows({
    record: { ...verified.tree.session, rowAuthority: 1 },
    revision: 4,
    rows: { sessionId: 'upgrade', threads: verified.tree.threads, messages: verified.tree.messages },
  })
  const records = new InMemorySessionRecordStore()
  await records.setRecord({ id: 'upgrade', name: 'Stale JSON', messages: [] })
  const migration = new SessionRowMigration(records, rows, new SessionRowWriteQueue((_id, run) => run()))
  const upgraded = await migration.ensureRows('upgrade')
  if (upgraded?.revision !== 5 || upgraded.record.rowFormatVersion !== 3 || upgraded.record.name !== 'Published')
    throw new Error('Published rows were not upgraded authoritatively')
  const metadata = await rows.readMessageMetadata({ sessionId: 'upgrade', messageIds: ['saved'], expectedRevision: 5 })
  if (metadata?.status !== 'ready' || metadata.rows[0]?.selected !== true || metadata.rows[0]?.facts.role !== 'user')
    throw new Error('Upgrade projections are missing')
  const page = await rows.readTranscriptWindow({ sessionId: 'upgrade', origin: 'tail', limit: 20 })
  if (
    page?.messages[0]?.message.contentParts[0]?.type !== 'text' ||
    page.messages[0].message.contentParts[0].text !== 'authoritative'
  )
    throw new Error('Upgrade changed the published body')
  const initialSnapshot = rows.readSnapshot
  const initialRecord = records.getRecord
  rows.readSnapshot = async () => {
    throw new Error('Format3 open read all rows')
  }
  records.getRecord = async () => {
    throw new Error('Format3 open read legacy input')
  }
  try {
    if ((await migration.ensureRows('upgrade'))?.revision !== 5) throw new Error('Format3 open advanced revision')
  } finally {
    rows.readSnapshot = initialSnapshot
    records.getRecord = initialRecord
  }
}

export async function verifyCandidateFormatUpgrade(
  store: import('../session-row-store').SessionRowStorePort & import('../../backup/session-port').BackupSessionStore
) {
  const encoded = verifySessionTreeRoundTrip(
    {
      id: 'candidate-upgrade',
      name: 'Before',
      messages: [{ id: 'source', role: 'user', contentParts: [{ type: 'text', text: 'before' }] }],
    },
    { activeThreadId: 'active', now: 1 }
  )
  if (!encoded.ok) throw new Error(encoded.reason)
  await store.writeRows({
    record: encoded.tree.session,
    revision: 4,
    rows: { sessionId: 'candidate-upgrade', threads: encoded.tree.threads, messages: encoded.tree.messages },
  })
  const candidate = await store.beginBackupRestore('candidate-upgrade')
  try {
    await candidate.append({ kind: 'header', record: { ...encoded.tree.session, name: 'After' } })
    for (const thread of encoded.tree.threads) await candidate.append({ kind: 'thread', thread })
    for (const row of encoded.tree.messages) await candidate.append({ kind: 'message', message: row })
    if ((await store.readCommit('candidate-upgrade'))?.revision !== 4)
      throw new Error('Candidate published before completion')
    await candidate.publish()
    const commit = await store.readCommit('candidate-upgrade')
    if (commit?.revision !== 5 || commit.record.rowFormatVersion !== 3 || commit.record.name !== 'After')
      throw new Error('Candidate was not upgraded before its only publication')
    const metadata = await store.readMessageMetadata({
      sessionId: 'candidate-upgrade',
      messageIds: ['source'],
      expectedRevision: 5,
    })
    if (metadata?.status !== 'ready' || metadata.rows[0].facts.promptCacheChars !== 6)
      throw new Error('Candidate facts were not derived')
    await candidate.rollback()
    const restored = await store.readCommit('candidate-upgrade')
    if (restored?.revision !== 4 || restored.record.name !== 'Before' || restored.record.rowFormatVersion !== undefined)
      throw new Error('Rollback changed the original row commit')
  } finally {
    await candidate.dispose()
  }
}
