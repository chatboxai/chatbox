import { buildContext } from '@shared/context/builder'
import { afterEach, describe, expect, it } from 'vitest'
import { readRowContextSource } from '../application/session/row-context'
import type { SessionRowSnapshot } from '../ports/session-row-store'
import type { MessageRowMetadata } from '../session/session-tree/types'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSession, contextSnapshot } from './session-context-read.test-support'
import { type SessionRowSqlBindValue, SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
const encoder = new TextEncoder()
async function measuredStore(
  snapshot: SessionRowSnapshot,
  afterQuery?: (sql: string, writer: SqlSessionRowStore) => Promise<void>
) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const writer = new SqlSessionRowStore(database)
  await writer.writeRows(snapshot)
  const payloadIds = new Set<string>()
  const payloads = await database.query<{ payload_id: string; message_id: string }>(
    'SELECT payload_id,message_id FROM session_messages'
  )
  const identities = new Map(payloads.map((row) => [row.payload_id, row.message_id]))
  let relationQueries = 0
  let responseBytes = 0
  const reader = new SqlSessionRowStore({
    execute: (sql) => database.execute(sql),
    executeBatch: (statements, options) => database.executeBatch(statements, options),
    query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
      const result = await database.query<T>(sql, params)
      const escaped = JSON.stringify(result).replace(/[\u007f-\uffff]/g, () => '\\u0000')
      responseBytes = Math.max(responseBytes, encoder.encode(escaped).length)
      expect(encoder.encode(JSON.stringify({ sql, params })).length).toBeLessThan(384 * 1024)
      expect(responseBytes).toBeLessThan(384 * 1024)
      if (sql.includes('WITH RECURSIVE path')) {
        relationQueries++
        if (relationQueries === 1) {
          const plan = await database.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
          const lookups = plan.filter((step) => step.detail.startsWith('SEARCH m '))
          expect(lookups.length).toBeGreaterThan(0)
          expect(lookups.every((step) => step.detail.includes('message_id=?'))).toBe(true)
        }
      }
      if (sql.startsWith('WITH requested(payload_id, request_index)'))
        for (const param of params)
          if (typeof param === 'string' && identities.has(param)) payloadIds.add(identities.get(param)!)
      await afterQuery?.(sql, writer)
      return result
    },
  })
  return { database, writer, reader, payloadIds, relationQueries: () => relationQueries }
}
const metadata = ({ message: _message, ...row }: SessionRowSnapshot['rows']['messages'][number]): MessageRowMetadata =>
  row

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe('SQL causal context', () => {
  it('preserves compacted context and bidirectional transcript after a local middle deletion', async () => {
    const snapshot = contextSnapshot()
    const { reader, payloadIds } = await measuredStore(snapshot)
    const first = await readRowContextSource(reader, { sessionId: snapshot.record.id, targetMessageId: 'target' })
    expect(first?.candidateMessages.map((message) => message.id)).toEqual(['system', 'boundary', 'summary', 'question'])
    expect([...payloadIds].sort()).toEqual(['boundary', 'question', 'summary', 'system', 'target'])
    const parent = snapshot.rows.messages.find((row) => row.messageId === 'prefix-2')!
    const child = snapshot.rows.messages.find((row) => row.messageId === 'prefix-4')!
    await reader.applyDiff(
      {
        sessionId: snapshot.record.id,
        threads: { upsert: [], delete: [] },
        messages: { upsert: [], delete: ['prefix-3'] },
        messageMetadataUpsert: [
          { ...metadata(parent), activeChildId: child.messageId },
          { ...metadata(child), parentMessageId: parent.messageId },
        ],
      },
      { record: snapshot.record, revision: 2 },
      1
    )
    const context = await readRowContextSource(reader, { sessionId: snapshot.record.id, targetMessageId: 'target' })
    expect(context?.candidateMessages).toEqual(first?.candidateMessages)
    const head = await reader.readTranscriptWindow({ sessionId: snapshot.record.id, origin: 'head', limit: 4 })
    expect(head?.messages.map((row) => row.messageId)).toEqual(['system', 'prefix-0', 'prefix-1', 'prefix-2'])
    const next = await reader.readTranscriptWindow({ sessionId: snapshot.record.id, cursor: head!.newer!, limit: 4 })
    expect(next?.messages.map((row) => row.messageId)).toEqual(['prefix-4', 'prefix-5', 'prefix-6', 'prefix-7'])
    const back = await reader.readTranscriptWindow({ sessionId: snapshot.record.id, cursor: next!.older!, limit: 4 })
    expect(back?.messages).toEqual(head?.messages)
  })

  it.each([1000, 10000, 100000])(
    'reads %i causal identities in bounded relation pages while excluding compacted prefix bodies',
    async (count) => {
      const snapshot = contextSnapshot(contextSession(count))
      const { reader, payloadIds, relationQueries } = await measuredStore(snapshot)
      const result = await readRowContextSource(reader, { sessionId: snapshot.record.id, targetMessageId: 'target' })
      expect(result?.mode).toBe('compacted')
      expect(result?.pathMessageIds).toHaveLength(count + 4)
      expect([...payloadIds].sort()).toEqual(['boundary', 'question', 'summary', 'system', 'target'])
      expect(relationQueries()).toBeLessThanOrEqual(Math.ceil((count + 5) / 200) * 3)
    },
    60000
  )

  it.each([false, true])('stops at a middle target (includeTarget: %s)', async (includeTarget) => {
    const snapshot = contextSnapshot()
    const { reader, payloadIds } = await measuredStore(snapshot)
    const result = await readRowContextSource(reader, {
      sessionId: snapshot.record.id,
      targetMessageId: 'prefix-2',
      includeTarget,
    })
    expect(result?.mode).toBe('full-path')
    expect(result?.candidateMessages.map((message) => message.id)).toEqual([
      'system',
      'prefix-0',
      'prefix-1',
      ...(includeTarget ? ['prefix-2'] : []),
    ])
    expect(result?.targetMessage?.id).toBe('prefix-2')
    expect([...payloadIds].sort()).toEqual(['prefix-0', 'prefix-1', 'prefix-2', 'system'])
  })

  it('handles an empty thread and an excluded root', async () => {
    const empty = contextSnapshot({ id: 'empty', name: 'Empty', messages: [] })
    const { reader } = await measuredStore(empty)
    expect((await readRowContextSource(reader, { sessionId: 'empty' }))?.candidateMessages).toEqual([])
    const snapshot = contextSnapshot()
    await reader.writeRows(snapshot)
    const root = await readRowContextSource(reader, { sessionId: snapshot.record.id, targetMessageId: 'system' })
    expect(root?.candidateMessages).toEqual([])
    expect(root?.targetMessage?.id).toBe('system')
  })

  it.each(['missing', 'cycle', 'cross-thread'] as const)('rejects a %s parent chain', async (kind) => {
    const snapshot = contextSnapshot()
    const { reader, database, payloadIds } = await measuredStore(snapshot)
    if (kind === 'cross-thread')
      await database.executeBatch([
        { sql: "UPDATE session_messages SET thread_id='other' WHERE message_id='prefix-2'", params: [] },
      ])
    else
      await database.executeBatch([
        {
          sql: "UPDATE session_messages SET parent_message_id=? WHERE message_id='prefix-2'",
          params: [kind === 'missing' ? 'missing' : 'question'],
        },
      ])
    await expect(
      readRowContextSource(reader, { sessionId: snapshot.record.id, targetMessageId: 'target' })
    ).rejects.toThrow()
    expect(payloadIds.size).toBe(0)
  })

  it.each(['ineligible-summary', 'before-checkpoint'] as const)('selects a full causal path for %s', async (kind) => {
    const session = contextSession()
    if (kind === 'ineligible-summary') session.messages.find((message) => message.id === 'summary')!.generating = true
    const { reader } = await measuredStore(contextSnapshot(session))
    const result = await readRowContextSource(reader, {
      sessionId: session.id,
      targetMessageId: kind === 'before-checkpoint' ? 'prefix-2' : 'target',
    })
    expect(result?.mode).toBe('full-path')
    expect(result?.candidateMessages.some((message) => message.id === 'prefix-0')).toBe(true)
  })

  it('keeps a valid checkpoint when a steered message precedes its boundary', async () => {
    const session = contextSession()
    session.messages.find((message) => message.id === 'prefix-0')!.steered = true
    const { reader, payloadIds } = await measuredStore(contextSnapshot(session))
    const result = await readRowContextSource(reader, { sessionId: session.id, targetMessageId: 'target' })
    const options = { compactionPoints: session.compactionPoints, attachmentResolver: { read: async () => null } }
    expect(await buildContext(result!.candidateMessages, options)).toEqual(
      await buildContext(session.messages.slice(0, -1), options)
    )
    expect(result?.mode).toBe('compacted')
    expect(result?.pathMessageIds).toContain('prefix-0')
    expect(result?.candidateMessages.map((message) => message.id)).toEqual([
      'system',
      'boundary',
      'summary',
      'question',
    ])
    expect([...payloadIds].sort()).toEqual(['boundary', 'question', 'summary', 'system', 'target'])
  })

  it.each([false, true])('fences a commit during context payload hydration (explicit revision: %s)', async (pinned) => {
    const snapshot = contextSnapshot()
    let changed = false
    const { reader } = await measuredStore(snapshot, async (sql, writer) => {
      if (changed || !sql.startsWith('WITH requested(payload_id, request_index)')) return
      changed = true
      await writer.applyDiff(
        { sessionId: snapshot.record.id, threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
        { record: { ...snapshot.record, name: 'Changed' }, revision: 2 },
        1
      )
    })
    await expect(
      readRowContextSource(reader, {
        sessionId: snapshot.record.id,
        targetMessageId: 'target',
        expectedRevision: pinned ? 1 : undefined,
      })
    ).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    expect(changed).toBe(true)
  })
})
