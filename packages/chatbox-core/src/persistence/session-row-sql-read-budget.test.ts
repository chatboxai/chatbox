import { afterEach, describe, expect, it } from 'vitest'
import type { SessionRowSnapshot } from '../ports/session-row-store'
import type { Session } from '../types/session'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSnapshot, expectedContextMessage } from './session-context-read.test-support'
import { type SessionRowSqlBindValue, SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
const encoder = new TextEncoder()
const budget = 384 * 1024

function sessionSnapshot(count: number, suffix = '', widePrefixCount = 0): SessionRowSnapshot {
  const id = `message-read-budget-session-${count}${suffix}`
  const session: Session = {
    id,
    type: 'chat',
    name: 'Read budget',
    messages: Array.from({ length: count }, (_, index) => ({
      id: `${id}-message-${index}${index < widePrefixCount ? '界'.repeat(200) : ''}`,
      role: index % 2 ? 'assistant' : 'user',
      timestamp: 1_700_000_000_000 + index,
      contentParts: [{ type: 'text', text: `Message ${index}: ${'text '.repeat(24)}` }],
    })),
  }
  return contextSnapshot(session)
}

function setup(onQuery?: (sql: string, params: SessionRowSqlBindValue[], rows: unknown[]) => void | Promise<void>) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const calls: Array<{
    kind: string
    binds: number
    rows: number
    requestBytes: number
    responseBytes: number
    ascii: boolean
    oversized: boolean
    contextLimit?: SessionRowSqlBindValue
    keys: string[]
  }> = []
  const reader = new SqlSessionRowStore({
    execute: (sql) => database.execute(sql),
    executeBatch: (statements, options) => database.executeBatch(statements, options),
    query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
      const result = await database.query<T>(sql, params)
      const kind =
        sql.includes('payload_id IN (') || sql.startsWith('WITH requested(payload_id, request_index)')
          ? 'payload'
          : sql.includes('WITH requested')
            ? 'selected'
            : sql.includes('WITH RECURSIVE path')
              ? 'context'
              : 'other'
      const requestBytes = encoder.encode(
        JSON.stringify({ database: 'chatbox', statement: sql, values: params, readonly: false })
      ).byteLength
      const response = JSON.stringify({ values: result }).replace(
        /[\u007f-\uffff<>&/]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
      )
      const responseBytes = encoder.encode(response).byteLength
      const keys = result.length ? Object.keys(result[0] as object) : []
      const iosResponseBytes = encoder.encode(
        JSON.stringify({ values: result.length ? [{ ios_columns: keys }, ...result] : [] }).replace(
          /[\u007f-\uffff<>&/]/g,
          (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        )
      ).byteLength
      expect(requestBytes).toBeLessThan(budget)
      expect(responseBytes).toBeLessThan(budget)
      expect(iosResponseBytes).toBeLessThan(budget)
      expect(params.length).toBeLessThanOrEqual(900)
      if (kind === 'selected' || kind === 'payload') {
        const plan = await database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
        expect(
          plan.some((step) =>
            /SEARCH (m|session_messages|session_message_payload_chunks) USING INDEX/.test(step.detail)
          )
        ).toBe(true)
        expect(
          plan.some((step) => /SCAN (m|session_messages|session_message_payload_chunks)\b/.test(step.detail))
        ).toBe(false)
      }
      calls.push({
        kind,
        binds: params.length,
        rows: result.length,
        requestBytes,
        responseBytes,
        contextLimit: kind === 'context' ? params[3] : undefined,
        keys,
        ascii: sql.includes('instr(value, char(0))'),
        oversized: result.some(
          (row) =>
            typeof row === 'object' &&
            row !== null &&
            (('payload_oversized' in row && row.payload_oversized === 1) ||
              (kind === 'payload' && 'x' in row && row.x === 1))
        ),
      })
      await onQuery?.(sql, params, result)
      return result
    },
  })
  return { database, writer: new SqlSessionRowStore(database), reader, calls }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe('SQLite bridge read budgets', () => {
  it('maps compact payload ordinals to exact sources in requested order', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(1000, '-会话😀')
    await writer.writeRows(snapshot)
    const ids = snapshot.rows.messages.map((row) => row.messageId).reverse()
    const result = await reader.readMessages({ sessionId: snapshot.record.id, messageIds: ids })
    expect(result?.messages).toEqual([...snapshot.rows.messages].reverse())
    expect(Object.keys(result?.textTokens?.sources ?? {})).toHaveLength(1000)
    const payload = calls.filter((call) => call.kind === 'payload')
    expect(payload.length).toBeGreaterThan(1)
    for (const call of payload) expect(call.keys).toEqual(['i', 'c', 'v', 'x'])
  })

  it.each([-1, 768, 0.5, Number.POSITIVE_INFINITY, '0'])('rejects an invalid payload ordinal %s', async (ordinal) => {
    const { writer, reader } = setup((sql, _params, rows) => {
      if (!sql.includes('FROM session_message_payload_chunks') || !rows.length) return
      const row = rows[0]
      if (typeof row === 'object' && row !== null && ('payload_oversized' in row || 'x' in row))
        Object.assign(row, { i: ordinal })
    })
    const snapshot = sessionSnapshot(3)
    await writer.writeRows(snapshot)
    await expect(
      reader.readMessages({ sessionId: snapshot.record.id, messageIds: [snapshot.rows.messages[0].messageId] })
    ).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: { message: 'Invalid message payload wire record' },
    })
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, 'invalid'])(
    'rejects invalid payload chunk index %s before body transfer',
    async (chunkIndex) => {
      const { writer, reader, database, calls } = setup()
      const snapshot = sessionSnapshot(3)
      await writer.writeRows(snapshot)
      const id = snapshot.rows.messages[0].messageId
      await database.executeBatch([
        {
          sql: 'UPDATE session_message_payload_chunks SET chunk_index=? WHERE payload_id=(SELECT payload_id FROM session_messages WHERE message_id=?)',
          params: [chunkIndex, id],
        },
      ])
      await expect(reader.readMessages({ sessionId: snapshot.record.id, messageIds: [id] })).rejects.toMatchObject({
        name: 'SessionRowStoreError',
      })
      const payload = calls.filter((call) => call.kind === 'payload')
      expect(payload).toHaveLength(1)
      expect(payload[0].oversized).toBe(true)
      expect(payload[0].responseBytes).toBeLessThan(128)
    }
  )

  it('reassembles split chunks for their own payload ordinal', async () => {
    const { writer, reader, database } = setup()
    const snapshot = sessionSnapshot(3)
    await writer.writeRows(snapshot)
    const id = snapshot.rows.messages[1].messageId
    const [payload] = await database.query<{ payload_id: string; value: string }>(
      'SELECT p.payload_id, p.value FROM session_message_payload_chunks p JOIN session_messages m USING(payload_id) WHERE m.message_id=?',
      [id]
    )
    const middle = Math.floor(payload.value.length / 2)
    await database.executeBatch([
      {
        sql: 'UPDATE session_message_payload_chunks SET value=? WHERE payload_id=?',
        params: [payload.value.slice(0, middle), payload.payload_id],
      },
      {
        sql: 'INSERT INTO session_message_payload_chunks(session_id,payload_id,chunk_index,value) VALUES(?,?,1,?)',
        params: [snapshot.record.id, payload.payload_id, payload.value.slice(middle)],
      },
      { sql: 'UPDATE session_messages SET payload_chunk_count=2 WHERE message_id=?', params: [id] },
    ])
    const ids = [snapshot.rows.messages[2].messageId, id, snapshot.rows.messages[0].messageId]
    const read = await reader.readMessages({ sessionId: snapshot.record.id, messageIds: ids })
    expect(read?.messages).toEqual([snapshot.rows.messages[2], snapshot.rows.messages[1], snapshot.rows.messages[0]])
    expect(Object.keys(read?.textTokens?.sources ?? {})).toHaveLength(3)
  })

  it('rejects BLOB payload values with a body-free response', async () => {
    const { writer, reader, database, calls } = setup()
    const snapshot = sessionSnapshot(1)
    await writer.writeRows(snapshot)
    await database.executeBatch([
      { sql: 'UPDATE session_message_payload_chunks SET value=CAST(? AS BLOB)', params: ['x'.repeat(100000)] },
    ])
    await expect(
      reader.readMessages({ sessionId: snapshot.record.id, messageIds: [snapshot.rows.messages[0].messageId] })
    ).rejects.toMatchObject({ name: 'SessionRowStoreError' })
    const payload = calls.filter((call) => call.kind === 'payload')
    expect(payload).toHaveLength(1)
    expect(payload[0].oversized).toBe(true)
    expect(payload[0].responseBytes).toBeLessThan(128)
  })

  it('bounds context bridge projection and adapts lookahead to accepted rows', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(3500, '', 1700)
    await writer.writeRows(snapshot)
    const context = await reader.readContext({ sessionId: snapshot.record.id })
    expect(context?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
    const pages = calls.filter((call) => call.kind === 'context')
    expect(pages.length).toBeGreaterThan(2)
    expect(pages[0].contextLimit).toBe(1536)
    for (const [index, page] of pages.entries()) {
      expect(page.keys).toEqual(['i', 'p', 's', 'v', 'c', 'l', 'x'])
      if (index > 0) {
        expect(page.contextLimit).toBe(
          Math.max(8, Math.min(Math.floor(budget / 160), Math.ceil(pages[index - 1].rows * 1.1)))
        )
      }
    }
  })

  it('reads context with the highest safe sequence values', async () => {
    const { writer, reader } = setup()
    const snapshot = sessionSnapshot(4)
    for (const row of snapshot.rows.messages) row.seq += Number.MAX_SAFE_INTEGER - 3
    await writer.writeRows(snapshot)
    const context = await reader.readContext({ sessionId: snapshot.record.id })
    expect(context?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
  })

  it.each([
    ['seq', 1.5],
    ['seq', -1],
    ['seq', Number.POSITIVE_INFINITY],
    ['seq', Number.MAX_SAFE_INTEGER + 1],
    ['seq', 'invalid'],
    ['payload_chunk_count', 0],
    ['payload_chunk_count', 1.5],
    ['payload_chunk_count', Number.POSITIVE_INFINITY],
    ['payload_chunk_count', 'invalid'],
    ['payload_utf8_length', -1],
    ['payload_utf8_length', 0.5],
    ['payload_utf8_length', Number.POSITIVE_INFINITY],
    ['payload_utf8_length', 'invalid'],
  ] as const)('rejects malformed context metadata %s=%s before payload transfer', async (column, value) => {
    const { database, writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(3)
    await writer.writeRows(snapshot)
    await database.executeBatch([
      {
        sql: `UPDATE session_messages SET ${column} = ? WHERE message_id = ?`,
        params: [value, snapshot.rows.messages[1].messageId],
      },
    ])
    await expect(reader.readContext({ sessionId: snapshot.record.id })).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: { message: 'Context metadata exceeds the native response budget' },
    })
    expect(calls.some((call) => call.kind === 'context')).toBe(true)
  })

  it.each(['payload_id', 'parent_message_id'])(
    'rejects BLOB context identifier %s with a bounded sentinel',
    async (column) => {
      const { database, writer, reader, calls } = setup()
      const snapshot = sessionSnapshot(3)
      await writer.writeRows(snapshot)
      await database.executeBatch([
        {
          sql: `UPDATE session_messages SET ${column} = CAST(? AS BLOB) WHERE message_id = ?`,
          params: ['x'.repeat(10000), snapshot.rows.messages[1].messageId],
        },
      ])
      await expect(reader.readContext({ sessionId: snapshot.record.id })).rejects.toMatchObject({
        name: 'SessionRowStoreError',
        cause: { message: 'Context metadata exceeds the native response budget' },
      })
      expect(calls.filter((call) => call.kind === 'context').at(-1)?.responseBytes).toBeLessThan(1024)
    }
  )

  it('packs safe ASCII payloads after a complete conservative batch', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(1000)
    await writer.writeRows(snapshot)
    const selected = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: snapshot.rows.messages.map((row) => row.messageId),
    })
    expect(selected?.messages).toEqual(snapshot.rows.messages)
    const payload = calls.filter((call) => call.kind === 'payload')
    expect(payload[0].ascii).toBe(false)
    expect(payload.some((call) => call.ascii && call.binds > payload[0].binds * 1.5)).toBe(true)
    expect(payload.every((call) => !call.oversized)).toBe(true)
  })

  it('keeps initially complex text on the conservative SQL path', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(1000)
    for (const row of snapshot.rows.messages) {
      row.message.contentParts = [{ type: 'text', text: '中文 [link](https://example.com/?a=1&b=2) **Markdown**' }]
    }
    await writer.writeRows(snapshot)
    const selected = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: snapshot.rows.messages.map((row) => row.messageId),
    })
    expect(selected?.messages).toEqual(snapshot.rows.messages)
    expect(calls.some((call) => call.ascii)).toBe(false)
  })

  it('packs mixed-language conversation payloads within the native response budget', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(240)
    for (const [index, row] of snapshot.rows.messages.entries()) {
      const size = index % 2 === 0 ? 500 : index % 40 === 1 ? 32_000 : 4_000
      row.message.contentParts = [
        {
          type: 'text',
          text: `Message ${index} `.padEnd(
            size,
            index % 2 === 0 ? '请解释一下这段代码的作用 ' : 'Here is a detailed answer with examples. '
          ),
        },
      ]
    }
    await writer.writeRows(snapshot)

    const context = await reader.readContext({ sessionId: snapshot.record.id })

    expect(context?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
    expect(Object.keys(context?.textTokens?.sources ?? {})).toHaveLength(240)
    const payload = calls.filter((call) => call.kind === 'payload')
    expect(payload.length).toBeLessThanOrEqual(12)
    expect(payload.every((call) => !call.oversized)).toBe(true)
  })

  it('falls back when text after a mixed-language sample expands beyond the response budget', async () => {
    const { writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(240)
    for (const [index, row] of snapshot.rows.messages.entries()) {
      row.message.contentParts = [
        {
          type: 'text',
          text: index >= 32 ? '界😀<&>'.repeat(600) : index % 2 === 0 ? '请解释'.repeat(166) : 'answer '.repeat(570),
        },
      ]
    }
    await writer.writeRows(snapshot)

    const selected = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: snapshot.rows.messages.map((row) => row.messageId),
    })

    expect(selected?.messages).toEqual(snapshot.rows.messages)
    const payload = calls.filter((call) => call.kind === 'payload')
    expect(payload.filter((call) => call.oversized)).toHaveLength(1)
    expect(payload.find((call) => call.oversized)).toMatchObject({ ascii: true, rows: 1 })
    expect(payload.at(-1)?.ascii).toBe(false)
  })

  it.each(['界'.repeat(160), '<&>'.repeat(160), '"\\'.repeat(160)])(
    'replays an overflowing ASCII batch once and stays conservative',
    async (text) => {
      const { writer, reader, calls } = setup()
      const snapshot = sessionSnapshot(1000)
      for (const row of snapshot.rows.messages.slice(250, 800)) row.message.contentParts = [{ type: 'text', text }]
      await writer.writeRows(snapshot)
      const selected = await reader.readMessages({
        sessionId: snapshot.record.id,
        messageIds: snapshot.rows.messages.map((row) => row.messageId),
      })
      expect(selected?.messages).toEqual(snapshot.rows.messages)
      const payload = calls.filter((call) => call.kind === 'payload')
      const attempts = payload.filter((call) => call.ascii)
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ rows: 1, oversized: true })
      expect(attempts[0].responseBytes).toBeLessThan(256)
      expect(payload.at(-1)?.ascii).toBe(false)
    }
  )

  it.each(['body', 'extra', 'missing'])('rejects late invalid payload data after ASCII sampling: %s', async (kind) => {
    const { database, writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(1000)
    await writer.writeRows(snapshot)
    const messageId = snapshot.rows.messages[250].messageId
    const selector = '(SELECT payload_id FROM session_messages WHERE message_id = ?)'
    if (kind === 'body') {
      await database.executeBatch([
        {
          sql: `UPDATE session_message_payload_chunks SET value = ? WHERE payload_id = ${selector}`,
          params: ['\u0001'.repeat(100000), messageId],
        },
      ])
    } else if (kind === 'extra') {
      await database.executeBatch([
        {
          sql: 'INSERT INTO session_message_payload_chunks SELECT session_id, payload_id, 1, ? FROM session_messages WHERE message_id = ?',
          params: ['\u0001'.repeat(100000), messageId],
        },
      ])
    } else {
      await database.executeBatch([
        { sql: `DELETE FROM session_message_payload_chunks WHERE payload_id = ${selector}`, params: [messageId] },
      ])
    }
    await expect(
      reader.readMessages({
        sessionId: snapshot.record.id,
        messageIds: snapshot.rows.messages.map((row) => row.messageId),
      })
    ).rejects.toMatchObject({ name: 'SessionRowStoreError' })
    const attempts = calls.filter((call) => call.ascii)
    if (kind !== 'missing') {
      expect(attempts).toHaveLength(1)
      expect(attempts[0].oversized).toBe(true)
      expect(calls.filter((call) => call.kind === 'payload').at(-1)?.ascii).toBe(false)
    } else {
      expect(attempts.length).toBeGreaterThan(0)
      expect(attempts.every((call) => !call.oversized)).toBe(true)
    }
  })

  it('rejects undeclared chunks before reading a large payload', async () => {
    const { database, writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(1)
    snapshot.rows.messages[0].message.contentParts = [{ type: 'text', text: 'x'.repeat(100000) }]
    await writer.writeRows(snapshot)
    await database.executeBatch([
      {
        sql: 'INSERT INTO session_message_payload_chunks SELECT session_id, payload_id, 1, ? FROM session_messages',
        params: ['undeclared chunk'],
      },
    ])
    const rejected = await reader
      .readMessages({
        sessionId: snapshot.record.id,
        messageIds: [snapshot.rows.messages[0].messageId],
      })
      .then(
        () => false,
        () => true
      )
    expect(rejected).toBe(true)
    expect(calls.every((call) => call.responseBytes < 10000)).toBe(true)
  })

  it('keeps large supplementary-character slices within the soft response budget', async () => {
    const { writer, reader } = setup()
    const snapshot = sessionSnapshot(1)
    snapshot.rows.messages[0].message.contentParts = [{ type: 'text', text: '😀'.repeat(100000) }]
    await writer.writeRows(snapshot)
    const selected = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: [snapshot.rows.messages[0].messageId],
    })
    expect(selected?.messages).toEqual(snapshot.rows.messages)
  })

  it.each([1000, 10000, 100000])(
    'uses byte-bounded pages for %i ordinary text messages',
    async (count) => {
      const { writer, reader, calls } = setup()
      const snapshot = sessionSnapshot(count)
      await writer.writeRows(snapshot)
      const selected = await reader.readMessages({
        sessionId: snapshot.record.id,
        messageIds: snapshot.rows.messages.map((row) => row.messageId),
      })
      expect(selected?.messages).toEqual(snapshot.rows.messages)
      expect(calls.filter((call) => call.kind === 'selected').length).toBeLessThanOrEqual(Math.ceil(count / 350))
      expect(calls.filter((call) => call.kind === 'payload').length).toBeLessThanOrEqual(Math.ceil(count / 140))
      expect(calls.some((call) => call.kind === 'payload' && call.binds > 100)).toBe(true)
      const selectedMetadataBytes = calls
        .filter((call) => call.kind === 'selected')
        .reduce((sum, call) => sum + call.responseBytes, 0)
      calls.length = 0
      const context = await reader.readContext({ sessionId: snapshot.record.id })
      expect(context?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
      const contextCalls = calls.filter((call) => call.kind === 'context')
      expect(contextCalls.length).toBeLessThanOrEqual(Math.ceil(count / 600))
      expect(contextCalls.reduce((sum, call) => sum + call.responseBytes, 0)).toBeLessThan(selectedMetadataBytes * 0.6)
    },
    60000
  )

  it.each([
    { label: 'wide ASCII', suffix: 'x'.repeat(850) },
    { label: 'NUL', suffix: '\u0000'.repeat(200) },
    { label: 'control', suffix: '\u0001'.repeat(200) },
    { label: 'quotes and slashes', suffix: '\\"/'.repeat(66) },
    { label: 'CJK', suffix: '界'.repeat(66) },
    { label: 'emoji', suffix: '😀'.repeat(50) },
    { label: 'DEL', suffix: '\u007f'.repeat(200) },
  ])('keeps structural ID responses bounded for $label', async ({ label, suffix }) => {
    const { writer, reader } = setup()
    const snapshot = sessionSnapshot(250, label === 'NUL' ? '' : suffix)
    if (label === 'NUL') for (const row of snapshot.rows.messages) row.branchId = `branch${suffix}`
    await writer.writeRows(snapshot)
    const ids = snapshot.rows.messages.map((row) => row.messageId)
    const selected = await reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: [ids[40], 'missing', ...ids.slice().reverse(), ids[40]],
    })
    expect(selected?.messages.map((row) => row.messageId)).toEqual([...new Set([ids[40], ...ids.slice().reverse()])])
    const context = await reader.readContext({ sessionId: snapshot.record.id })
    expect(context?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
  })

  it.each([false, true])(
    'rejects oversized context metadata with a bounded response (checkpoint: %s)',
    async (compacted) => {
      const { database, writer, reader, calls } = setup()
      const snapshot = compacted ? contextSnapshot() : sessionSnapshot(3)
      await writer.writeRows(snapshot)
      const ancestorId = compacted ? 'question' : snapshot.rows.messages[1].messageId
      await database.executeBatch([
        {
          sql: 'UPDATE session_messages SET payload_id = ? WHERE message_id = ?',
          params: [`payload\u0000${'\u0001'.repeat(100000)}`, ancestorId],
        },
      ])
      await expect(reader.readContext({ sessionId: snapshot.record.id })).rejects.toMatchObject({
        name: 'SessionRowStoreError',
        cause: { message: 'Context metadata exceeds the native response budget' },
      })
      expect(calls.filter((call) => call.kind === 'context').every((call) => call.responseBytes < budget)).toBe(true)
    }
  )

  it('rejects a false payload manifest before transferring an oversized body', async () => {
    const { database, writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(2)
    await writer.writeRows(snapshot)
    await database.executeBatch([
      {
        sql: 'UPDATE session_message_payload_chunks SET value = ? WHERE payload_id = (SELECT payload_id FROM session_messages WHERE message_id = ?)',
        params: ['\u0001'.repeat(100000), snapshot.rows.messages[0].messageId],
      },
    ])
    await expect(
      reader.readMessages({
        sessionId: snapshot.record.id,
        messageIds: snapshot.rows.messages.map((row) => row.messageId),
      })
    ).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: { message: 'Message payload exceeds the native response budget' },
    })
    expect(calls.some((call) => call.kind === 'payload')).toBe(true)
  })

  it('reserves request SQL and JSON envelope bytes for an oversized payload ID', async () => {
    const { database, writer, reader, calls } = setup()
    const snapshot = sessionSnapshot(1)
    await writer.writeRows(snapshot)
    await database.executeBatch([
      { sql: 'UPDATE session_messages SET payload_id = ?', params: ['x'.repeat(budget - 3000)] },
    ])
    await expect(
      reader.readMessages({ sessionId: snapshot.record.id, messageIds: [snapshot.rows.messages[0].messageId] })
    ).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: { message: 'Message payload ID exceeds the native request budget' },
    })
    expect(calls.some((call) => call.kind === 'payload')).toBe(false)
  })

  it.each([false, true])('rejects undeclared payload chunks (oversized: %s)', async (oversized) => {
    const { database, writer, reader } = setup()
    const snapshot = sessionSnapshot(2)
    await writer.writeRows(snapshot)
    await database.executeBatch([
      {
        sql: 'INSERT INTO session_message_payload_chunks (session_id, payload_id, chunk_index, value) SELECT session_id, payload_id, 20, ? FROM session_messages WHERE message_id = ?',
        params: [oversized ? '\u0001'.repeat(100000) : '{}', snapshot.rows.messages[0].messageId],
      },
    ])
    await expect(
      reader.readMessages({
        sessionId: snapshot.record.id,
        messageIds: snapshot.rows.messages.map((row) => row.messageId),
      })
    ).rejects.toMatchObject({
      name: 'SessionRowStoreError',
      cause: {
        message: oversized
          ? 'Message payload exceeds the native response budget'
          : expect.stringContaining('has 2 chunks, expected 1'),
      },
    })
  })

  it.each(['x'.repeat(budget), `branch\u0000${'\u0001'.repeat(100000)}`])(
    'rejects an oversized metadata row with a small response',
    async (branchId) => {
      const { database, writer, reader } = setup()
      const snapshot = sessionSnapshot(1)
      await writer.writeRows(snapshot)
      await database.executeBatch([{ sql: 'UPDATE session_messages SET branch_id = ?', params: [branchId] }])
      await expect(
        reader.readMessages({ sessionId: snapshot.record.id, messageIds: [snapshot.rows.messages[0].messageId] })
      ).rejects.toMatchObject({
        name: 'SessionRowStoreError',
        cause: { message: 'Message metadata exceeds the native response budget' },
      })
    }
  )

  it.each([false, true])('keeps enlarged payload batches revision-bound (pinned: %s)', async (pinned) => {
    let changed = false
    const snapshot = sessionSnapshot(1000)
    const { writer, reader } = setup(async (sql) => {
      if (!changed && sql.startsWith('WITH requested(payload_id, request_index)')) {
        changed = true
        await writer.writeRows({ ...snapshot, record: { ...snapshot.record, name: 'Current' }, revision: 2 }, 1)
      }
    })
    await writer.writeRows(snapshot)
    const selected = reader.readMessages({
      sessionId: snapshot.record.id,
      messageIds: snapshot.rows.messages.map((row) => row.messageId),
      expectedRevision: pinned ? 1 : undefined,
    })
    if (pinned) await expect(selected).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    else expect((await selected)?.revision).toBe(2)
    expect(changed).toBe(true)
  })
})
