import { afterEach, describe, expect, it, vi } from 'vitest'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../../persistence/node-sqlite.test-support'
import { type SessionRowSqlBindValue, SqlSessionRowStore } from '../../persistence/session-row-sql'
import { SessionRowConflictError } from '../../ports/session-row-store'
import { InMemorySessionRecordStore } from '../../testing/InMemorySessionRecordStore'
import type { Message, Session } from '../../types/session'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionSearchService } from './SessionSearchService'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

function message(id: string, text: string): Message {
  return { id, role: 'assistant', contentParts: [{ type: 'text', text }] }
}

function fixture(status: 'settled' | 'generating' | 'paused'): Session {
  const session: Session = {
    id: 'search-storage',
    name: 'Chat',
    type: 'chat',
    settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: Array.from({ length: 120 }, (_, index) =>
      message(`m${index}`, index === 30 ? 'selected needle' : 'ordinary message')
    ),
    threads: Array.from({ length: 25 }, (_, index) => ({
      id: `history-${index}`,
      name: `Old ${index}`,
      createdAt: index,
      messages: [message(`h${index}`, index === 0 ? 'archived needle' : 'ordinary history')],
    })),
    messageForksHash: {
      m118: {
        position: 0,
        createdAt: 1,
        lists: [
          { id: 'selected', messages: [] },
          { id: 'other', messages: [message('hidden-fork', 'unselected needle')] },
        ],
      },
    },
  }
  if (status === 'generating') session.messages[119].generating = true
  if (status === 'paused')
    session.messages[119].contentParts = [
      {
        type: 'tool-call',
        toolCallId: 'pause',
        toolName: 'command',
        state: 'paused',
        pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
      },
    ]
  return session
}

async function harness(status: 'settled' | 'generating' | 'paused' = 'settled', migrateLegacyBeforeRead = false) {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const rows = new SqlSessionRowStore(database)
  const records = new InMemorySessionRecordStore()
  const repository = new RowBackedSessionRepository({ records, rows, now: () => 1, migrateLegacyBeforeRead })
  const session = fixture(status)
  await repository.setSession(session)
  const search = new SessionSearchService(
    {
      listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
      readSessionSearchThreadsPage: (request) => repository.readSessionSearchThreadsPage(request),
      readSessionMessageWindow: (request) => repository.readSessionMessageWindow(request),
    },
    async () => {}
  )
  return { database, rows, records, repository, session, search }
}

describe('search storage on real SQLite', () => {
  it.each(['settled', 'generating', 'paused'] as const)(
    'searches selected forks and archived threads in bounded pages while %s',
    async (status) => {
      const { database, rows, repository, session, search } = await harness(status)
      const fullRead = vi
        .spyOn(repository, 'getSessionReadModel')
        .mockRejectedValue(new Error('Complete read model is forbidden'))
      const snapshot = vi.spyOn(rows, 'readSnapshot').mockRejectedValue(new Error('Full graph read is forbidden'))
      const messageReads = vi.spyOn(rows, 'readMessageWindow')
      const threadReads = vi.spyOn(rows, 'readThreadsPage')
      const queries: Array<{ sql: string; count: number }> = []
      const query = database.query.bind(database)
      vi.spyOn(database, 'query').mockImplementation(async <T>(sql: string, params: SessionRowSqlBindValue[] = []) => {
        const result = await query<T>(sql, params)
        queries.push({ sql, count: result.length })
        return result
      })
      const result = await search.search('needle', { sessionId: session.id })
      expect(result.failedSessionIds).toEqual([])
      expect(result.hits.map((hit) => hit.messageId)).toEqual(['m30', 'h0'])
      expect(fullRead).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
      expect(threadReads).toHaveBeenCalledTimes(2)
      expect(messageReads.mock.calls.every(([request]) => request.limit <= 50 && request.expectedRevision === 1)).toBe(
        true
      )
      expect(queries.filter(({ sql }) => sql.startsWith('WITH page AS')).every(({ count }) => count <= 21)).toBe(true)
      expect(
        queries.filter(({ sql }) => sql.startsWith('WITH RECURSIVE path AS')).every(({ count }) => count <= 51)
      ).toBe(true)
    }
  )

  it('rejects a new thread window after the session changes between threads', async () => {
    const { repository, session } = await harness()
    const page = await repository.readSessionSearchThreadsPage({ sessionId: session.id, limit: 20 })
    if (page?.kind !== 'rows') throw new Error('Expected bounded search source')
    await repository.readSessionMessageWindow({ sessionId: session.id, limit: 50, expectedRevision: page.revision })
    await repository.setSession({ ...session, name: 'Updated chat' }, { baseSession: session })
    await expect(
      repository.readSessionMessageWindow({
        sessionId: session.id,
        threadId: 'history-24',
        limit: 50,
        expectedRevision: page.revision,
      })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    if (!page.nextCursor) throw new Error('Expected history continuation')
    await expect(
      repository.readSessionSearchThreadsPage({ sessionId: session.id, limit: 20, cursor: page.nextCursor })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
  })

  it('stops before another SQLite window or thread page when search is canceled between batches', async () => {
    const { repository, rows, session } = await harness()
    const controller = new AbortController()
    const canceled = new Error('Canceled by a new query')
    const search = new SessionSearchService(
      {
        listSessionsMetaPage: async () => ({ items: [], nextCursor: null, total: 0 }),
        readSessionSearchThreadsPage: (request) => repository.readSessionSearchThreadsPage(request),
        readSessionMessageWindow: (request) => repository.readSessionMessageWindow(request),
      },
      async () => {
        controller.abort(canceled)
      }
    )
    const windows = vi.spyOn(rows, 'readMessageWindow')
    const threads = vi.spyOn(rows, 'readThreadsPage')
    await expect(search.search('needle', { sessionId: session.id, signal: controller.signal })).rejects.toBe(canceled)
    expect(windows).toHaveBeenCalledTimes(1)
    expect(threads).toHaveBeenCalledTimes(1)
  })

  it('rejects a row cursor when the next thread page has become a legacy source', async () => {
    const { repository, records, session } = await harness('settled', true)
    const page = await repository.readSessionSearchThreadsPage({ sessionId: session.id, limit: 20 })
    if (page?.kind !== 'rows' || !page.nextCursor) throw new Error('Expected row continuation')
    await records.setRecord(session)
    const fullRead = vi.spyOn(repository, 'getSession')
    const recordReads = vi.spyOn(records, 'getRecord')
    await expect(
      repository.readSessionSearchThreadsPage({ sessionId: session.id, limit: 20, cursor: page.nextCursor })
    ).rejects.toBeInstanceOf(SessionRowConflictError)
    expect(fullRead).not.toHaveBeenCalled()
    expect(recordReads).toHaveBeenCalledTimes(1)
  })

  it('retains complete-session fallback for an unmigrated record', async () => {
    const { repository, session, rows, records } = await harness()
    await rows.deleteRows(session.id)
    await records.setRecord(session)
    const result = await repository.readSessionSearchThreadsPage({ sessionId: session.id, limit: 20 })
    expect(result?.kind).toBe('full')
    if (result?.kind !== 'full') throw new Error('Expected compatibility source')
    expect(result.session.messages).toHaveLength(120)
    expect(result.session.messageForksHash?.m118.lists[1].messages[0].id).toBe('hidden-fork')
  })
})
