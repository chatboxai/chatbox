import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionTranscriptContract, transcriptFixture } from '../ports/testing/session-transcript-contract'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore } from './session-row-sql'
import * as tokens from './session-text-token-sql'

const databases: NodeSessionRowSqlDatabase[] = []
function createStore(bounded = false) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  return { database, store: new SqlSessionRowStore(database, undefined, bounded ? {} : { readByteBudget: 'none' }) }
}
afterEach(() => {
  vi.restoreAllMocks()
  while (databases.length) databases.pop()?.close()
})

describe.each([false, true])('SQL transcript contract (bounded bridge: %s)', (bounded) => {
  for (const test of createSessionTranscriptContract(() => createStore(bounded).store)) it(test.name, test.run)
})

describe('SQL transcript query boundaries', () => {
  it('reads only a commit header and selected payloads, without token sources or full topology', async () => {
    const { database, store } = createStore()
    await store.writeRows(transcriptFixture())
    const query = vi.spyOn(database, 'query')
    const tokenize = vi.spyOn(tokens, 'createTextTokenSource')
    const snapshot = vi.spyOn(store, 'readSnapshot')
    await store.readCommit('transcript')
    expect(query.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(
      /compaction_points|session_message_payload_chunks|session_messages\b/
    )
    query.mockClear()
    const page = await store.readTranscriptWindow({
      sessionId: 'transcript',
      limit: 2,
      origin: { messageId: 'recent-2' },
    })
    expect(page?.messages.map((row) => row.messageId)).toEqual(['recent-2', 'recent-3'])
    expect(query.mock.calls.filter((call) => call[0].includes('WITH RECURSIVE transcript_path'))).toHaveLength(1)
    expect(query.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(
      /compaction_points|session_text_tokens|json_quote\(message_json\)/
    )
    expect(snapshot).not.toHaveBeenCalled()
    expect(tokenize).not.toHaveBeenCalled()
  })

  it('rejects a target with a missing membership projection without walking ancestors or reading bodies', async () => {
    const { database, store } = createStore()
    await store.writeRows(transcriptFixture())
    await database.execute(
      "UPDATE session_messages SET row_metadata_json=json_remove(row_metadata_json,'$.selected') WHERE session_id='transcript' AND message_id='recent-2'"
    )
    const query = vi.spyOn(database, 'query')
    await expect(
      store.readTranscriptWindow({ sessionId: 'transcript', origin: { messageId: 'recent-2' }, limit: 20 })
    ).rejects.toMatchObject({ cause: { message: 'Transcript selected-path projection is unavailable' } })
    const sql = query.mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).not.toMatch(/WITH RECURSIVE|session_message_payload_chunks/)
    expect(query.mock.calls.filter(([statement]) => statement.includes('FROM session_messages'))).toHaveLength(1)
  })
})

it('rejects malformed commit identity and nonpositive revisions without reading payloads', async () => {
  const { database, store } = createStore()
  const fixture = transcriptFixture()
  await store.writeRows(fixture)
  await database.executeBatch([
    {
      sql: 'UPDATE session_threads SET session_record_json = ? WHERE session_id = ? AND seq = -1',
      params: [JSON.stringify({ ...fixture.record, id: 'wrong' }), 'transcript'],
    },
  ])
  await expect(store.readCommit('transcript')).rejects.toMatchObject({
    operation: 'read-commit',
    cause: { message: 'Transcript commit identity is invalid' },
  })
  await database.executeBatch([
    {
      sql: 'UPDATE session_threads SET session_record_json = ?, commit_revision = 0 WHERE session_id = ? AND seq = -1',
      params: [JSON.stringify(fixture.record), 'transcript'],
    },
    { sql: 'UPDATE session_row_heads SET revision = 0 WHERE session_id = ?', params: ['transcript'] },
  ])
  await expect(store.readCommit('transcript')).rejects.toMatchObject({
    operation: 'read-commit',
    cause: { message: 'Transcript commit metadata is inconsistent' },
  })
})
