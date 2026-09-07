import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSessionMessageTokenizationDigest } from '../application/session/message-derived-data'
import { RowBackedSessionRepository } from '../application/session/RowBackedSessionRepository'
import type { SessionTextTokenResult } from '../ports/session-text-tokens'
import { InMemorySessionRecordStore } from '../testing'
import type { Session } from '../types/session'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

async function setup(count = 3, messageIdPrefix = '') {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new SqlSessionRowStore(database)
  const records = new InMemorySessionRecordStore()
  const repo = new RowBackedSessionRepository({ rows, records })
  const session: Session = {
    id: 's',
    name: 's',
    type: 'chat',
    settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: Array.from({ length: count }, (_, i) => ({
      id: `${messageIdPrefix}m${i}`,
      role: i === 0 ? 'system' : 'user',
      timestamp: 1,
      contentParts: [{ type: 'text', text: `text ${i}` }],
    })),
  }
  await repo.setSession(session)
  const read = await repo.getSessionContextSource({ sessionId: session.id })
  const results: SessionTextTokenResult[] = Object.values(read?.textTokens?.sources ?? {}).map((source) => ({
    source,
    value: {
      tokenizerType: 'default',
      sourceDigest: source.textDigest,
      tokens: 7,
      calculatedAt: 100,
    },
  }))
  expect(results).toHaveLength(count)
  database.reset()
  return { database, rows, records, repo, session, results }
}

describe('SQL source-bound numerical text results', () => {
  it.each([false, true])(
    'checks restored V1 content across token migration (concurrent edit: %s)',
    async (concurrentEdit) => {
      const h = await setup()
      const restored: Session = {
        ...h.session,
        name: 'Restored backup',
        messages: h.session.messages.map((message) => ({
          ...message,
          tokenCountMap: { default: 7 },
          tokenCalculatedAt: { default: 100 },
        })),
      }
      await h.records.setRecord(restored)
      h.repo.forgetAllBaselines()
      await h.repo.getSession('s')
      if (concurrentEdit) await h.records.setRecord({ ...restored, name: 'Concurrent edit' })
      const migrator = new RowBackedSessionRepository({ records: h.records, rows: h.rows })
      await migrator.initialize()
      await expect(migrator.migrateSession('s')).resolves.toBe('migrated')

      if (concurrentEdit) {
        await expect(h.repo.deleteSession('s')).rejects.toMatchObject({ name: 'SessionWriteConflictError' })
        expect(await h.repo.getSession('s')).toMatchObject({ name: 'Concurrent edit' })
        return
      }
      await expect(h.repo.deleteSession('s')).resolves.toBeUndefined()
      expect(await h.records.getRecord('s')).toBeNull()
      expect(await h.rows.hasRows('s')).toBe(false)
    }
  )

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
    await h.repo.setSession({ ...h.session, id: 'other' })
    const other = await h.repo.getSessionContextSource({ sessionId: 'other' })
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

  it('overlays full, selected, context and window reads at unchanged revision; leaves raw bodies untouched', async () => {
    const h = await setup(60)
    const revision = await h.rows.getRevision('s')
    expect((await h.repo.acceptSessionTextTokenResults('s', h.results)).results).toHaveLength(60)
    expect(await h.rows.getRevision('s')).toBe(revision)
    const full = await h.repo.getSession('s')
    expect(full?.messages.every((message) => message.tokenCountMap?.default === 7)).toBe(true)
    const context = await h.repo.getSessionContextSource({ sessionId: 's' })
    expect(context?.candidateMessages.every((message) => message.tokenCountMap?.default === 7)).toBe(true)
    const selected = await h.repo.readSessionMessages({ sessionId: 's', messageIds: ['m12', 'm1', 'm12'] })
    expect(selected?.messages.map((message) => [message.id, message.tokenCountMap?.default])).toEqual([
      ['m12', 7],
      ['m1', 7],
    ])
    const model = await h.repo.getSessionReadModel('s')
    expect(model?.kind).toBe('window')
    if (model?.kind === 'window')
      expect(model.window.messages.every((row) => row.message.tokenCountMap?.default === 7)).toBe(true)
    const raw = await h.rows.readSnapshot('s')
    expect(raw?.rows.messages.every((row) => row.message.tokenCountMap === undefined)).toBe(true)
    const restart = new RowBackedSessionRepository({ rows: new SqlSessionRowStore(h.database), records: h.records })
    expect((await restart.getSession('s'))?.messages[12].tokenCountMap?.default).toBe(7)
  })

  it('rejects late edits with copied clocks, deletes and staged-only payloads', async () => {
    const h = await setup()
    await h.repo.acceptSessionTextTokenResults('s', h.results)
    const before = await h.repo.getSession('s')
    if (!before) throw new Error('missing fixture')
    const edited = {
      ...before,
      messages: before.messages.map((message) =>
        message.id === 'm1' ? { ...message, contentParts: [{ type: 'text' as const, text: 'edited' }] } : message
      ),
    }
    await h.repo.setSession(edited, { baseSession: before, changedMessageId: 'm1' })
    const current = await h.repo.readSessionMessages({ sessionId: 's', messageIds: ['m1'] })
    expect(current?.messages[0].tokenCountMap).toBeUndefined()
    const late = h.results.filter((result) => result.source.messageId === 'm1')
    expect((await h.repo.acceptSessionTextTokenResults('s', late)).results).toEqual([])
    const original = h.results[0]
    const staged = {
      ...original,
      source: { ...original.source, payloadId: `s:m0:00000000-0000-4000-8000-000000000000` },
    }
    await h.database.executeBatch([
      {
        sql: 'INSERT INTO session_message_payload_chunks(session_id,payload_id,chunk_index,value) VALUES(?,?,?,?)',
        params: ['s', staged.source.payloadId, 0, '{}'],
      },
    ])
    expect(await h.rows.acceptTextTokenResults([staged])).toEqual([])
    await h.repo.deleteSession('s')
    expect(await h.rows.acceptTextTokenResults(h.results)).toEqual([])
    expect(await h.database.query('SELECT COUNT(*) AS count FROM session_text_tokens')).toEqual([{ count: 0 }])
    await h.repo.setSession(h.session)
    expect(await h.rows.acceptTextTokenResults(h.results)).toEqual([])
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

  it('does not turn a complete numerical view into N payload writes and retains content conflict checks', async () => {
    const h = await setup(100)
    await h.repo.getSession('s')
    await h.repo.acceptSessionTextTokenResults('s', h.results)
    const before = await h.repo.getSession('s')
    if (!before) throw new Error('missing fixture')
    h.database.reset()
    const next = {
      ...before,
      messages: before.messages.map((message) =>
        message.id === 'm99' ? { ...message, contentParts: [{ type: 'text' as const, text: 'changed' }] } : message
      ),
    }
    await h.repo.setSession(next, { baseSession: before, changedMessageId: 'm99' })
    const cleanup = h.database.executed.filter((sql) => sql.startsWith('DELETE FROM session_text_tokens'))
    expect(cleanup).toHaveLength(1)
    expect(cleanup[0]).toContain('AND message_id = ?')
    expect(
      h.database.executed.filter((sql) => sql.startsWith('INSERT OR REPLACE INTO session_messages '))
    ).toHaveLength(1)
    const current = await h.repo.getSession('s')
    expect(current?.messages[10].tokenCountMap?.default).toBe(7)
    expect(current?.messages[99].tokenCountMap).toBeUndefined()
    await expect(h.repo.setSession({ ...before, name: 'stale' }, { baseSession: before })).rejects.toThrow('changed')
    expect(getSessionMessageTokenizationDigest(current?.messages[99] ?? before.messages[99])).not.toBe(
      h.results[99].source.textDigest
    )
  })

  it('retains a new-message exact draft seed as content-owned input and never resurrects it after a same-clock edit', async () => {
    const h = await setup(1)
    const base = await h.repo.getSession('s')
    if (!base) throw new Error('missing fixture')
    const seed = {
      id: 'seed',
      role: 'user' as const,
      timestamp: 10,
      updatedAt: 10,
      tokenCount: 91,
      tokenCountMap: { default: 4 },
      tokenCalculatedAt: { default: 10 },
      contentParts: [{ type: 'text' as const, text: 'seed text' }],
    }
    await h.repo.setSession({ ...base, messages: [...base.messages, seed] }, { baseSession: base })
    const current = await h.repo.getSession('s')
    expect(current?.messages[1].tokenCountMap?.default).toBe(4)
    expect((await h.rows.readSnapshot('s'))?.textTokens?.results).toEqual([])
    if (!current) throw new Error('missing seed fixture')
    await h.repo.setSession(
      {
        ...current,
        messages: [
          current.messages[0],
          { ...current.messages[1], contentParts: [{ type: 'text', text: 'different seed' }] },
        ],
      },
      { baseSession: current }
    )
    const edited = await h.repo.getSession('s')
    expect(edited?.messages[1].tokenCountMap).toBeUndefined()
    expect(edited?.messages[1].tokenCount).toBe(91)
  })
})
