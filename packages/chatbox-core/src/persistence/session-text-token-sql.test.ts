import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionTextTokenResult } from '../ports/session-text-tokens'
import type { Message } from '../types/session'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSnapshot } from './session-context-read.test-support'
import { SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
async function setup(count = 3, messageIdPrefix = '') {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new SqlSessionRowStore(database)
  const session = {
    id: 's',
    name: 's',
    type: 'chat' as const,
    messages: Array.from(
      { length: count },
      (_, i): Message => ({
        id: `${messageIdPrefix}m${i}`,
        role: i === 0 ? 'system' : 'user',
        timestamp: 1,
        contentParts: [{ type: 'text', text: `text ${i}` }],
      })
    ),
  }
  const snapshot = contextSnapshot(session)
  await rows.writeRows(snapshot)
  const read = await rows.readMessages({ sessionId: 's', messageIds: session.messages.map((message) => message.id) })
  const results: SessionTextTokenResult[] = Object.values(read?.textTokens?.sources ?? {}).map((source) => ({
    source,
    value: { tokenizerType: 'default', sourceDigest: source.textDigest, tokens: 7, calculatedAt: 100 },
  }))
  expect(results).toHaveLength(count)
  database.reset()
  return { database, rows, session, snapshot, results }
}

describe('SQL source-bound numerical text results', () => {
  it('publishes numbers independently of bodies and revisions across restart', async () => {
    const h = await setup(60)
    const revision = await h.rows.getRevision('s')
    expect(await h.rows.acceptTextTokenResults(h.results)).toHaveLength(60)
    expect(await h.rows.getRevision('s')).toBe(revision)
    const restarted = new SqlSessionRowStore(h.database)
    const selected = await restarted.readMessages({ sessionId: 's', messageIds: ['m12', 'm1', 'm12'] })
    expect(selected?.messages.map((row) => row.messageId)).toEqual(['m12', 'm1'])
    expect(selected?.messages.every((row) => row.message.tokenCountMap === undefined)).toBe(true)
    expect(selected?.textTokens?.results.map((result) => result.value.tokens)).toEqual([7, 7])
    const window = await restarted.readTranscriptWindow({ sessionId: 's', limit: 20 })
    expect(window?.messages.every((row) => row.message.tokenCountMap === undefined)).toBe(true)
    h.database.reset()
    expect(await restarted.readTextTokenResults(h.results.map((result) => result.source))).toHaveLength(60)
    expect(h.database.executed.some((sql) => sql.includes('session_message_payload_chunks'))).toBe(false)
  })

  it('keeps metadata edits source-stable and rejects stale content, staged payloads, and deleted sources', async () => {
    const h = await setup()
    await h.rows.acceptTextTokenResults(h.results)
    const row = h.snapshot.rows.messages[1]
    const { message: _message, ...metadata } = row
    await h.rows.applyDiff(
      {
        sessionId: 's',
        threads: { upsert: [], delete: [] },
        messages: { upsert: [], delete: [] },
        messageMetadataUpsert: [{ ...metadata, seq: 42 }],
      },
      { record: h.snapshot.record, revision: 2 },
      1
    )
    expect(await h.rows.readTextTokenResults([h.results[1].source])).toHaveLength(1)
    const edited = {
      ...row,
      seq: 42,
      message: { ...row.message, contentParts: [{ type: 'text' as const, text: 'changed' }] },
    }
    await h.rows.applyDiff(
      { sessionId: 's', threads: { upsert: [], delete: [] }, messages: { upsert: [edited], delete: [] } },
      { record: h.snapshot.record, revision: 3 },
      2
    )
    expect(await h.rows.acceptTextTokenResults([h.results[1]])).toEqual([])
    const current = await h.rows.readMessages({ sessionId: 's', messageIds: [row.messageId] })
    expect(current?.textTokens?.results).toEqual([])
    expect(current?.textTokens?.sources[row.messageId].payloadId).not.toBe(h.results[1].source.payloadId)
    const original = h.results[0]
    const staged = {
      ...original,
      source: { ...original.source, payloadId: 's:m0:00000000-0000-4000-8000-000000000000' },
    }
    await h.database.executeBatch([
      {
        sql: 'INSERT INTO session_messages_staging SELECT ?,m.* FROM session_messages m WHERE message_id=?',
        params: ['token-candidate', original.source.messageId],
      },
      {
        sql: 'UPDATE session_messages_staging SET payload_id=? WHERE mutation_id=?',
        params: [staged.source.payloadId, 'token-candidate'],
      },
    ])
    expect(await h.rows.acceptTextTokenResults([staged])).toEqual([])
    await h.rows.deleteRows('s', 3)
    expect(await h.rows.acceptTextTokenResults(h.results)).toEqual([])
    expect(await h.database.query('SELECT COUNT(*) AS count FROM session_text_tokens')).toEqual([{ count: 0 }])
    const deletedRevision = await h.rows.getRevision('s')
    await h.rows.writeRows({ ...h.snapshot, revision: deletedRevision! + 1 }, deletedRevision)
    expect(await h.rows.acceptTextTokenResults(h.results)).toEqual([])
  })

  it('probes existing session/message keys for a full 288-source readback', async () => {
    const h = await setup(288)
    const results = h.results.map((result, index) => ({
      ...result,
      value: { ...result.value, tokens: index, calculatedAt: 100 + index },
    }))
    await h.rows.acceptTextTokenResults(results)
    const revision = await h.rows.getRevision('s')
    const query = vi.spyOn(h.database, 'query')
    const actual = await h.rows.readTextTokenResults(results.map((result) => result.source))
    expect(actual).toEqual(results.map((result) => ({ ...result, value: { ...result.value, approximate: false } })))
    const reads = query.mock.calls.filter(([sql]) => sql.startsWith('WITH requested'))
    expect(reads).toHaveLength(1)
    const [sql, params] = reads[0]
    expect(params).toHaveLength(865)
    const plan = await h.database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
    const details = plan.map((entry) => entry.detail).join('\n')
    expect(details).not.toMatch(/AUTOMATIC|SCAN [mc]\b/)
    expect(details).toMatch(/SEARCH m .*session_id=\? AND message_id=\?/)
    expect(details).toMatch(/SEARCH c .*session_id=\? AND message_id=\? AND tokenizer_type=\?/)
    expect(await h.rows.getRevision('s')).toBe(revision)
  })

  it('reads both tokenizers by the requested session and live payload, excluding stale and deleted sources', async () => {
    const h = await setup()
    await h.rows.writeRows(contextSnapshot({ ...h.session, id: 'other' }))
    const other = await h.rows.readMessages({
      sessionId: 'other',
      messageIds: h.session.messages.map((message) => message.id),
    })
    const otherResults: SessionTextTokenResult[] = Object.values(other?.textTokens?.sources ?? {}).map((source) => ({
      source,
      value: { tokenizerType: 'default', sourceDigest: source.textDigest, tokens: 20, calculatedAt: 200 },
    }))
    expect(otherResults).toHaveLength(3)
    const results: SessionTextTokenResult[] = [...h.results, ...otherResults].flatMap((result) => [
      result,
      { ...result, value: { ...result.value, tokenizerType: 'deepseek', tokens: result.value.tokens + 1 } },
    ])
    await h.rows.acceptTextTokenResults(results)
    const stale = { ...h.results[1].source, payloadId: 's:m1:00000000-0000-4000-8000-000000000000' }
    await h.database.executeBatch([
      {
        sql: 'UPDATE session_text_tokens SET payload_id=? WHERE session_id=? AND message_id=?',
        params: [stale.payloadId, 's', 'm1'],
      },
      { sql: 'DELETE FROM session_messages WHERE session_id=? AND message_id=?', params: ['s', 'm2'] },
    ])
    const sources = [
      otherResults[1].source,
      stale,
      h.results[2].source,
      h.results[0].source,
      otherResults[0].source,
      h.results[1].source,
      otherResults[2].source,
    ]
    const actual = await h.rows.readTextTokenResults(sources)
    const tuples = (values: SessionTextTokenResult[]) =>
      values.map(({ source, value }) => JSON.stringify([source.sessionId, source.messageId, value])).sort()
    expect(tuples(actual)).toEqual(
      tuples(
        results
          .filter(({ source }) => source.sessionId === 'other' || source.messageId === 'm0')
          .map((result) => ({ ...result, value: { ...result.value, approximate: false } }))
      )
    )
    for (const { source } of actual) expect(sources).toContain(source)
  })

  it('keeps tokenizer/version/approximate clocks separate and treats corrupt cache values as misses', async () => {
    const h = await setup(1)
    const first = h.results[0]
    const approx = { ...first, value: { ...first.value, tokens: 8, approximate: true } }
    await h.rows.acceptTextTokenResults([approx])
    const exact = { ...first, value: { ...first.value, calculatedAt: 101 } }
    await h.rows.acceptTextTokenResults([exact])
    await h.rows.acceptTextTokenResults([{ ...approx, value: { ...approx.value, calculatedAt: 999 } }])
    const deepseek = { ...first, value: { ...first.value, tokenizerType: 'deepseek' as const, tokens: 13 } }
    await h.rows.acceptTextTokenResults([deepseek])
    const counts = await h.rows.readTextTokenResults([first.source])
    expect(counts.map((result) => [result.value.tokenizerType, result.value.tokens])).toEqual([
      ['deepseek', 13],
      ['default', 7],
    ])
    await h.database.executeBatch([
      {
        sql: 'UPDATE session_text_tokens SET calculation_version=? WHERE tokenizer_type=?',
        params: ['unknown', 'deepseek'],
      },
      { sql: 'UPDATE session_text_tokens SET tokens=? WHERE tokenizer_type=?', params: ['broken', 'default'] },
    ])
    expect(await h.rows.readTextTokenResults([first.source])).toEqual([])
    await h.rows.acceptTextTokenResults([first, deepseek])
    expect(await h.rows.readTextTokenResults([first.source])).toHaveLength(2)
  })

  it.each([1000, 10000])(
    'adds one indexed empty-cache query for %i sources and bounds numeric writes/readback',
    async (count) => {
      const h = await setup(count)
      await h.rows.readTextTokenResults(h.results.map((result) => result.source))
      expect(h.database.executed.filter((sql) => sql.includes('session_text_tokens'))).toHaveLength(1)
      expect(h.database.executed[0]).toContain('SELECT 1 AS present')
      const execute = vi.spyOn(h.database, 'executeBatch')
      const query = vi.spyOn(h.database, 'query')
      h.database.reset()
      const accepted = await h.rows.acceptTextTokenResults(h.results)
      expect(accepted.map((result) => result.source.messageId)).toEqual(
        h.results.map((result) => result.source.messageId)
      )
      expect(accepted.every((result) => result.value.tokens === 7 && result.value.calculatedAt === 100)).toBe(true)
      if (count === 1000) expect(h.database.batchCount).toBe(1)
      else expect(h.database.batchCount).toBeGreaterThan(1)
      expect(query).toHaveBeenCalledTimes(
        execute.mock.calls.reduce(
          (total, [statements]) =>
            total +
            Math.ceil(Array.from(statements).reduce((n, statement) => n + statement.params.length / 8, 0) / 288),
          0
        )
      )
      const encoder = new TextEncoder()
      for (const [index, [source]] of execute.mock.calls.entries()) {
        const statements = Array.from(source)
        expect(
          encoder.encode(
            JSON.stringify({
              set: statements.map((entry) => ({ statement: entry.sql, values: entry.params })),
              transaction: true,
            })
          ).length
        ).toBeLessThan(384 * 1024)
        for (const statement of statements) expect(statement.params.length).toBeLessThanOrEqual(512)
        expect(statements.every((statement) => !statement.sql.includes('DELETE FROM'))).toBe(true)
        const next = Array.from(execute.mock.calls[index + 1]?.[0] ?? [])[0]
        if (next) {
          const size = [...statements, next].reduce(
            (bytes, entry) =>
              bytes + encoder.encode(JSON.stringify({ statement: entry.sql, values: entry.params })).length + 1,
            1024
          )
          expect(size).toBeGreaterThan(384 * 1024)
        }
      }
      for (const [sql, params] of query.mock.calls) {
        expect(encoder.encode(JSON.stringify({ statement: sql, values: params })).length).toBeLessThan(384 * 1024)
        expect(params?.length).toBeLessThanOrEqual(865)
      }
      expect(await h.rows.getRevision('s')).toBe(1)
    }
  )

  it('bounds escaped wide identities and maximal numerical values by serialized bytes', async () => {
    const h = await setup(256, '\\"/\n\t💬'.repeat(80))
    const results = h.results.map((result) => ({
      ...result,
      value: { ...result.value, tokens: Number.MAX_SAFE_INTEGER, calculatedAt: Number.MAX_SAFE_INTEGER },
    }))
    const execute = vi.spyOn(h.database, 'executeBatch')
    const query = vi.spyOn(h.database, 'query')
    expect(await h.rows.acceptTextTokenResults(results)).toHaveLength(results.length)
    expect(execute.mock.calls.length).toBeGreaterThan(1)
    const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
    for (const [source] of execute.mock.calls) {
      const statements = Array.from(source)
      expect(
        size({ set: statements.map(({ sql, params }) => ({ statement: sql, values: params })), transaction: true })
      ).toBeLessThan(384 * 1024)
      for (const statement of statements) expect(statement.params.length).toBeLessThanOrEqual(512)
    }
    for (const [statement, values] of query.mock.calls) {
      expect(size({ statement, values })).toBeLessThan(384 * 1024)
      expect(values?.length).toBeLessThanOrEqual(865)
    }
    expect(await h.rows.getRevision('s')).toBe(1)
  })
})
