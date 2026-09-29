import { afterEach, describe, expect, it } from 'vitest'
import type { SessionRowSnapshot } from '../ports/session-row-store'
import type { MessageRow } from '../session/session-tree/types'
import { encodeSessionTree } from '../session/session-tree/encode'
import { diffSessionRows } from '../session/session-tree/diff'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSession, contextSnapshot, expectedContextMessage } from './session-context-read.test-support'
import { type SessionRowSqlBindValue, SqlSessionRowStore } from './session-row-sql'

const databases: NodeSessionRowSqlDatabase[] = []
const encoder = new TextEncoder()

function linearSnapshot(count: number, id: (index: number) => string = (index) => `m-${index}`): SessionRowSnapshot {
  const ids = Array.from({ length: count }, (_, index) => id(index))
  return {
    revision: 1,
    record: {
      id: 'session',
      type: 'chat',
      name: 'Context',
      storageFormat: 'rows',
      activeThreadId: 'active',
      contextReadProjection: {
        version: 1,
        threads: {
          active: { rootMessageId: ids[0] ?? null, hasSteeredMessages: false, checkpoints: [], attachments: [] },
        },
      },
    },
    rows: {
      sessionId: 'session',
      threads: [
        {
          sessionId: 'session',
          threadId: 'active',
          seq: -1,
          name: 'Active',
          createdAt: 1,
          rootMessageId: ids[0] ?? null,
          activeLeafMessageId: ids.at(-1) ?? null,
          compactionPoints: [],
        },
      ],
      messages: ids.map((messageId, index) => ({
        sessionId: 'session',
        threadId: 'active',
        messageId,
        parentMessageId: ids[index - 1] ?? null,
        activeChildId: ids[index + 1] ?? null,
        seq: index,
        kind: 'message',
        status: 'settled',
        createdAt: index,
        updatedAt: index,
        branchId: null,
        message: {
          id: messageId,
          role: index % 2 === 0 ? 'user' : 'assistant',
          timestamp: index,
          contentParts: [{ type: 'text', text: `Message ${index}` }],
        },
      })),
    },
  }
}

async function measuredStore(
  snapshot: SessionRowSnapshot,
  afterQuery?: (
    sql: string,
    params: SessionRowSqlBindValue[],
    writer: SqlSessionRowStore,
    payloadMessageIds: string[]
  ) => Promise<void>
) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const writer = new SqlSessionRowStore(database)
  await writer.writeRows(snapshot)
  const pages: Array<{ ids: string[]; limit: number; bytes: number }> = []
  const payloadIds = new Set<string>()
  let maxResponseBytes = 0
  const reader = new SqlSessionRowStore({
    execute: (sql) => database.execute(sql),
    executeBatch: (statements, options) => database.executeBatch(statements, options),
    query: async <T>(sql: string, params: SessionRowSqlBindValue[] = []): Promise<T[]> => {
      const rows = await database.query<T>(sql, params)
      const bytes = encoder.encode(JSON.stringify(rows)).byteLength
      maxResponseBytes = Math.max(maxResponseBytes, bytes)
      expect(bytes).toBeLessThanOrEqual(512 * 1024)
      if (sql.startsWith('WITH RECURSIVE path AS')) {
        expect(bytes).toBeLessThanOrEqual(384 * 1024)
        pages.push({
          ids: (rows as Array<{ i: string }>).map((row) => row.i),
          limit: Number(params[3]),
          bytes,
        })
        expect(sql).not.toContain('OFFSET')
      }
      const payloadMessageIds: string[] = []
      if (sql.includes('FROM session_message_payload_chunks')) {
        // These fixtures have single-chunk payloads, so account for actual bodies returned by SQLite.
        for (const row of rows as Array<{ v: string }>) {
          const messageId = (JSON.parse(row.v) as { id: string }).id
          payloadIds.add(messageId)
          payloadMessageIds.push(messageId)
        }
      }
      await afterQuery?.(sql, params, writer, payloadMessageIds)
      return rows
    },
  })
  return { database, writer, reader, pages, payloadIds, maxResponseBytes: () => maxResponseBytes }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe('SQL context ancestry response planning on real SQLite', () => {
  it('reads compacted context and both window directions after a middle deletion', async () => {
    const session = contextSession()
    const before = contextSnapshot(session)
    const { reader } = await measuredStore(before)
    const beforeContext = await reader.readContext({ sessionId: session.id })
    const next = { ...session, messages: session.messages.filter((message) => message.id !== 'prefix-3') }
    const encoded = encodeSessionTree(next, {
      activeThreadId: session.id,
      now: 1,
      previousMessages: before.rows.messages,
    })
    if (!encoded.ok) throw new Error(encoded.reason)
    const rows = { sessionId: session.id, threads: encoded.tree.threads, messages: encoded.tree.messages }
    await reader.applyDiff(diffSessionRows(before.rows, rows), { record: encoded.tree.session, revision: 2 }, 1)
    const context = await reader.readContext({ sessionId: session.id })
    expect(context?.messages.map((row) => row.messageId)).toEqual(beforeContext?.messages.map((row) => row.messageId))
    const head = await reader.readMessageWindow({ sessionId: session.id, edge: 'head', limit: 4 })
    expect(head?.messages.map((row) => row.messageId)).toEqual(['system', 'prefix-0', 'prefix-1', 'prefix-2'])
    if (!head?.newer) throw new Error('missing forward cursor')
    const page = await reader.readMessageWindow({ sessionId: session.id, cursor: head.newer, limit: 4 })
    expect(page?.messages.map((row) => row.messageId)).toEqual(['prefix-4', 'prefix-5', 'prefix-6', 'prefix-7'])
    if (!page?.older) throw new Error('missing backward cursor')
    const back = await reader.readMessageWindow({ sessionId: session.id, cursor: page.older, limit: 4 })
    expect(back?.messages.map((row) => row.messageId)).toEqual(head.messages.map((row) => row.messageId))
  })

  it.each([1_000, 10_000, 100_000])(
    'reads all %i uncompacted ancestors in byte-bounded batches',
    async (count) => {
      const snapshot = linearSnapshot(count)
      const { reader, pages, payloadIds, maxResponseBytes } = await measuredStore(snapshot)
      const result = await reader.readContext({ sessionId: 'session' })

      expect(result?.mode).toBe('full-path')
      expect(result?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
      expect(result?.beforeTarget).toMatchObject({
        firstMessageTimestamp: 0,
        userMessageCount: count / 2,
        hasAssistantMessage: true,
        lastUserMessageId: `m-${count - 2}`,
      })
      expect(payloadIds).toEqual(new Set(snapshot.rows.messages.map((row) => row.messageId)))
      expect(pages.flatMap((page) => page.ids)).toEqual(snapshot.rows.messages.map((row) => row.messageId).reverse())
      expect(pages.length).toBeLessThanOrEqual(Math.ceil(count / 150))
      expect(pages[0].ids.length).toBeGreaterThan(8)
      expect(pages[0].limit).toBe(1536)
      expect(pages.every((page) => page.limit >= 8 && page.limit <= Math.floor((384 * 1024) / 160))).toBe(true)
      expect(maxResponseBytes()).toBeLessThanOrEqual(512 * 1024)
    },
    60_000
  )

  it.each([false, true])(
    'shrinks pages for escaped and multibyte IDs (wide ownership IDs: %s)',
    async (wideOwnership) => {
      const suffixes = ['\u0001'.repeat(1000), '\\"'.repeat(495), '汉'.repeat(330), 'short']
      const snapshot = linearSnapshot(1_000, (index) => `${index}-${suffixes[index % suffixes.length]}`)
      if (wideOwnership) {
        const sessionId = `s-${'\u0002'.repeat(1000)}`
        const threadId = `t-${'\\"'.repeat(500)}`
        snapshot.record.id = sessionId
        snapshot.record.activeThreadId = threadId
        snapshot.rows.sessionId = sessionId
        snapshot.rows.threads[0] = { ...snapshot.rows.threads[0], sessionId, threadId }
        snapshot.rows.messages = snapshot.rows.messages.map((row) => ({
          ...row,
          sessionId,
          threadId,
          branchId: `b-${'\u0003'.repeat(1000)}`,
        }))
        delete snapshot.record.contextReadProjection
      }
      const { reader, pages, payloadIds } = await measuredStore(snapshot)
      const result = await reader.readContext({ sessionId: snapshot.record.id })

      expect(result?.messages).toEqual(snapshot.rows.messages.map(expectedContextMessage))
      expect(pages.flatMap((page) => page.ids)).toEqual(snapshot.rows.messages.map((row) => row.messageId).reverse())
      expect(payloadIds.size).toBe(1_000)
      expect(pages.length).toBeGreaterThan(2)
      expect(pages.every((page) => page.ids.length < 768 && page.bytes < 384 * 1024)).toBe(true)
    }
  )

  it.each([false, true])('stops at a middle target (includeTarget: %s)', async (includeTarget) => {
    const snapshot = linearSnapshot(2_000)
    const { reader, pages, payloadIds } = await measuredStore(snapshot)
    const result = await reader.readContext({ sessionId: 'session', targetMessageId: 'm-999', includeTarget })
    expect(result?.messages).toEqual(
      snapshot.rows.messages.slice(0, includeTarget ? 1_000 : 999).map(expectedContextMessage)
    )
    expect(result?.beforeTarget.userMessageCount).toBe(500)
    expect(payloadIds).toEqual(new Set(snapshot.rows.messages.slice(0, 1_000).map((row) => row.messageId)))
    expect(pages.flatMap((page) => page.ids)).not.toContain('m-1000')
  })

  it('does not query ancestry for an empty thread or an excluded root target', async () => {
    const empty = await measuredStore(linearSnapshot(0))
    expect((await empty.reader.readContext({ sessionId: 'session' }))?.messages).toEqual([])
    expect(empty.pages).toEqual([])
    expect(empty.payloadIds.size).toBe(0)

    const root = await measuredStore(linearSnapshot(1))
    const result = await root.reader.readContext({ sessionId: 'session', targetMessageId: 'm-0' })
    expect(result?.messages).toEqual([])
    expect(result?.beforeTarget).toMatchObject({ firstMessageTimestamp: 0, userMessageCount: 0 })
    expect(root.pages).toEqual([])
    expect([...root.payloadIds]).toEqual(['m-0'])
  })

  it.each([false, true])(
    'selects only inactive fork ancestry in its owning thread (archived: %s)',
    async (archived) => {
      const snapshot = linearSnapshot(2_000)
      const threadId = archived ? 'archived' : 'active'
      if (archived) {
        snapshot.rows.threads.push({ ...snapshot.rows.threads[0], threadId, seq: 0 })
        snapshot.rows.messages.push(
          ...snapshot.rows.messages.map((row) => ({
            ...row,
            threadId,
            messageId: `archived-${row.messageId}`,
            parentMessageId: row.parentMessageId ? `archived-${row.parentMessageId}` : null,
            activeChildId: row.activeChildId ? `archived-${row.activeChildId}` : null,
            message: { ...row.message, id: `archived-${row.messageId}` },
          }))
        )
        snapshot.rows.threads[1].rootMessageId = 'archived-m-0'
        snapshot.rows.threads[1].activeLeafMessageId = 'archived-m-1999'
      }
      const prefix = snapshot.rows.messages.filter((row) => row.threadId === threadId).slice(0, 700)
      const fork = linearSnapshot(1_000).rows.messages.map(
        (row, index): MessageRow => ({
          ...row,
          threadId,
          messageId: `fork-${index}`,
          seq: 2_000 + index,
          parentMessageId: index ? `fork-${index - 1}` : prefix[699].messageId,
          activeChildId: index === 999 ? null : `fork-${index + 1}`,
          message: { ...row.message, id: `fork-${index}` },
        })
      )
      snapshot.rows.messages.push(...fork)
      const { reader, payloadIds } = await measuredStore(snapshot)
      const result = await reader.readContext({
        sessionId: 'session',
        targetMessageId: 'fork-999',
        includeTarget: true,
      })
      expect(result?.thread.threadId).toBe(threadId)
      expect(result?.messages).toEqual([...prefix, ...fork].map(expectedContextMessage))
      expect(payloadIds).toEqual(new Set([...prefix, ...fork].map((row) => row.messageId)))
    }
  )

  it.each(['missing', 'cycle', 'cross-thread', 'false-root'] as const)('rejects a %s parent chain', async (kind) => {
    const snapshot = linearSnapshot(1_000)
    const { reader, database } = await measuredStore(snapshot)
    if (kind === 'cross-thread') {
      await database.executeBatch([
        { sql: 'UPDATE session_messages SET thread_id = ? WHERE message_id = ?', params: ['foreign', 'm-200'] },
      ])
    } else {
      const parent = kind === 'missing' ? 'not-a-message' : kind === 'cycle' ? 'm-300' : null
      await database.executeBatch([
        { sql: 'UPDATE session_messages SET parent_message_id = ? WHERE message_id = ?', params: [parent, 'm-200'] },
      ])
    }
    await expect(reader.readContext({ sessionId: 'session' })).rejects.toMatchObject({
      cause: { message: expect.stringContaining('Context path is invalid') },
    })
  })

  it.each(
    ['ancestors', 'first-path-payload', 'last-path-payload'].flatMap((phase) =>
      [false, true].map((pinned) => ({ phase, pinned }))
    )
  )('keeps a commit during $phase revision-bound (pinned: $pinned)', async ({ phase, pinned }) => {
    const snapshot = linearSnapshot(1_000)
    const changed = { ...snapshot.rows.messages[0], message: { ...snapshot.rows.messages[0].message, timestamp: 1234 } }
    let mutated = false
    let pathStarted = false
    const { reader } = await measuredStore(snapshot, async (sql, _params, writer, payloadMessageIds) => {
      const ancestryQuery = sql.startsWith('WITH RECURSIVE path AS')
      if (ancestryQuery) pathStarted = true
      // Path hydration visits the active leaf first and the root last, after the standalone target read.
      const boundaryMessage =
        snapshot.rows.messages[phase === 'first-path-payload' ? snapshot.rows.messages.length - 1 : 0]
      const atMutation =
        phase === 'ancestors' ? ancestryQuery : pathStarted && payloadMessageIds.includes(boundaryMessage.messageId)
      if (mutated || !atMutation) return
      mutated = true
      await writer.applyDiff(
        {
          sessionId: 'session',
          threads: { upsert: [], delete: [] },
          messages: { upsert: [changed], delete: [] },
        },
        { record: snapshot.record, revision: 2 },
        1
      )
    })
    const read = reader.readContext({ sessionId: 'session', expectedRevision: pinned ? 1 : undefined })
    if (pinned) await expect(read).rejects.toMatchObject({ name: 'SessionRowConflictError', actualRevision: 2 })
    else {
      const result = await read
      expect(result?.revision).toBe(2)
      expect(result?.messages).toEqual([changed, ...snapshot.rows.messages.slice(1)].map(expectedContextMessage))
      expect(result?.beforeTarget.firstMessageTimestamp).toBe(1234)
    }
    expect(mutated).toBe(true)
  })

  it.each(['missing-projection', 'before-checkpoint', 'ineligible-summary', 'steered'] as const)(
    'uses full ancestry batching for %s fallback and preserves point selection',
    async (reason) => {
      const session = contextSession(1_000)
      if (reason === 'steered') session.messages[1].steered = true
      const snapshot = contextSnapshot(session)
      if (reason === 'missing-projection') delete snapshot.record.contextReadProjection
      // Retain a stale checkpoint projection to exercise validation of the real summary payload.
      if (reason === 'ineligible-summary') {
        const summary = snapshot.rows.messages.find((row) => row.messageId === 'summary')
        if (!summary) throw new Error('Fixture summary is missing')
        summary.message.generating = true
      }
      const { reader, pages, payloadIds } = await measuredStore(snapshot)
      const targetMessageId = reason === 'before-checkpoint' ? 'prefix-500' : 'target'
      const result = await reader.readContext({ sessionId: session.id, targetMessageId, includeTarget: true })
      const targetIndex = snapshot.rows.messages.findIndex((row) => row.messageId === targetMessageId)
      expect(result?.mode).toBe('full-path')
      expect(result?.messages).toEqual(snapshot.rows.messages.slice(0, targetIndex + 1).map(expectedContextMessage))
      expect(payloadIds).toEqual(new Set(snapshot.rows.messages.slice(0, targetIndex + 1).map((row) => row.messageId)))
      expect(pages.some((page) => page.limit === 1536 && page.ids.length > 8)).toBe(true)
      expect(result?.effectiveCompactionPoint).toEqual(
        reason === 'missing-projection' || reason === 'steered' ? session.compactionPoints?.[0] : undefined
      )
    }
  )

  it('retains eight-row metadata batches and prefix exclusion for an effective checkpoint', async () => {
    const snapshot = contextSnapshot(contextSession(1_000))
    const { reader, pages, payloadIds } = await measuredStore(snapshot)
    const result = await reader.readContext({ sessionId: snapshot.record.id, targetMessageId: 'target' })
    expect(result?.mode).toBe('compacted')
    expect(result?.effectiveCompactionPoint).toEqual(snapshot.rows.threads[0].compactionPoints[0])
    expect(pages.every((page) => page.limit === 8 && page.ids.length <= 8)).toBe(true)
    expect([...payloadIds].sort()).toEqual(['boundary', 'question', 'summary', 'system', 'target'])
  })
})

describe('committed context payload reuse', () => {
  it.each([false, true])('matches cold context including token sources (includeTarget=%s)', async (includeTarget) => {
    const snapshot = contextSnapshot()
    const { reader, payloadIds } = await measuredStore(snapshot)
    const request = { sessionId: snapshot.rows.sessionId, targetMessageId: 'target', includeTarget }
    const expected = await reader.readContext(request)
    payloadIds.clear()
    expect(await reader.readContext(request, snapshot)).toEqual(expected)
    expect(payloadIds.size).toBe(0)
    const cachedRead = (await reader.readContext(request, snapshot))!
    cachedRead.messages[0].message.contentParts = [{ type: 'text', text: 'Consumer mutation' }]
    expect(await reader.readContext(request, snapshot)).toEqual(expected)
  })

  it('refreshes token results without changing the cached content revision', async () => {
    const snapshot = contextSnapshot()
    const { reader, writer } = await measuredStore(snapshot)
    const request = { sessionId: snapshot.rows.sessionId, targetMessageId: 'target' }
    const before = (await reader.readContext(request, snapshot))!
    const source = before.textTokens!.sources.question
    await writer.acceptTextTokenResults([
      {
        source,
        value: {
          tokenizerType: 'default',
          sourceDigest: source.textDigest,
          tokens: 123,
          calculatedAt: 456,
          approximate: false,
        },
      },
    ])
    const after = (await reader.readContext(request, snapshot))!
    expect(after.revision).toBe(before.revision)
    expect(after.textTokens?.results).toContainEqual({
      source,
      value: {
        tokenizerType: 'default',
        sourceDigest: source.textDigest,
        tokens: 123,
        calculatedAt: 456,
        approximate: false,
      },
    })
    expect(after).toEqual(await writer.readContext(request))
  })

  it('reads missing cached payloads and ignores another session or revision', async () => {
    const snapshot = contextSnapshot()
    const { reader, payloadIds } = await measuredStore(snapshot)
    const request = { sessionId: snapshot.rows.sessionId, targetMessageId: 'target' }
    const expected = await reader.readContext(request)
    payloadIds.clear()
    const partial = {
      ...snapshot,
      rows: { ...snapshot.rows, messages: snapshot.rows.messages.filter((row) => row.messageId !== 'question') },
    }
    expect(await reader.readContext(request, partial)).toEqual(expected)
    expect([...payloadIds]).toEqual(['question'])
    for (const invalid of [
      { ...snapshot, revision: snapshot.revision + 1 },
      { ...snapshot, rows: { ...snapshot.rows, sessionId: 'other' } },
    ]) {
      payloadIds.clear()
      expect(await reader.readContext(request, invalid)).toEqual(expected)
      expect(payloadIds.size).toBeGreaterThan(0)
    }
  })

  it('retries with fresh payloads after a concurrent write changes the revision', async () => {
    const snapshot = contextSnapshot()
    let changed = false
    const next = structuredClone(snapshot)
    next.revision += 1
    next.rows.messages.find((row) => row.messageId === 'question')!.message.contentParts = [
      { type: 'text', text: 'Changed by another writer' },
    ]
    const { reader, writer } = await measuredStore(snapshot, async (sql, _params, writer) => {
      if (!changed && sql.startsWith('WITH RECURSIVE path AS')) {
        changed = true
        await writer.writeRows(next, snapshot.revision)
      }
    })
    const request = { sessionId: snapshot.rows.sessionId, targetMessageId: 'target' }
    const actual = await reader.readContext(request, snapshot)
    expect(changed).toBe(true)
    expect(actual).toEqual(await writer.readContext(request))
    expect(actual?.revision).toBe(next.revision)
  })
})
