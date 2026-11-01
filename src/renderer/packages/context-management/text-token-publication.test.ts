import { SessionEventBus } from '@chatbox/core'
import { RowBackedSessionRepository, SessionRowWriteQueue } from '@chatbox/core/application/session'
import { SESSION_TOKEN_CACHE_VERSION } from '@chatbox/core/ports'
import { InMemorySessionRecordStore } from '@chatbox/core/testing'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../../../packages/chatbox-core/src/persistence/session-row-sql'
import { QueryKeys } from '../../../../packages/chatbox-react/src/query/query-keys'
import { SessionQueryBridge } from '../../../../packages/chatbox-react/src/query/session-query-bridge'
import { SessionTranscriptWindowController } from '../../../../packages/chatbox-react/src/query/session-transcript-window'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
})

async function setup() {
  const db = openNodeSessionRowDatabase()
  const rows = new SqlSessionRowStore(db)
  const repo = new RowBackedSessionRepository({
    rows,
    records: new InMemorySessionRecordStore(),
    writes: new SessionRowWriteQueue((_id, action) => action()),
  })
  await repo.initialize()
  await repo.createSessionRows(
    { id: 's', name: 's', type: 'chat' },
    Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      timestamp: 1,
      tokenCount: 90,
      contentParts: [{ type: 'text', text: `text ${i}` }],
    }))
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const events = new SessionEventBus()
  const point = vi.fn(repo.readSessionMessages.bind(repo))
  const bridge = new SessionQueryBridge(
    client,
    {
      getSessionHeader: repo.getSessionHeader.bind(repo),
      readSessionMessages: point,
      readSessionThread: repo.readSessionThread.bind(repo),
      readSessionTranscriptWindow: repo.readSessionTranscriptWindow.bind(repo),
      readSessionThreadSummariesPage: repo.readSessionThreadSummariesPage.bind(repo),
      readSessionForkOptionsPage: repo.readSessionForkOptionsPage.bind(repo),
      listSessionsMetaPage: async () => ({ items: [], total: 0, nextCursor: null }),
      listArchivedSessionsMetaPage: async () => ({ items: [], total: 0, nextCursor: null }),
    },
    events
  )
  const window = new SessionTranscriptWindowController({ sessionId: 's', pageSize: 20, source: rows })
  const detach = bridge.registerWindow('s', window)
  await window.open()
  const layout = window.getSnapshot().layout
  if (layout) window.acknowledgeLayout(layout.requestId)
  await client.fetchQuery(bridge.definitions.header('s'))
  await client.fetchQuery(bridge.definitions.message('s', 'm0'))
  const plan = await repo.createSessionTokenPlan({ sessionId: 's' })
  if (!plan) throw new Error('Token plan missing')
  const request = { plan, offset: 0, limit: 16, cacheKey: `${SESSION_TOKEN_CACHE_VERSION}:default:0:0` }
  const page = await repo.readSessionTokenPage(request)
  const sources = Object.values(page.textTokens?.sources ?? {})
  if (!sources.length) throw new Error('Independent token sources missing')
  const results = sources.map((source) => ({
    source,
    value: {
      tokenizerType: 'default' as const,
      sourceDigest: source.textDigest,
      tokens: 123,
      calculatedAt: 10,
      approximate: false,
    },
  }))
  cleanup.push(() => {
    detach()
    bridge.dispose()
    client.clear()
    db.close()
  })
  return { rows, repo, client, events, bridge, window, point, results }
}

describe('independent token cache publication', () => {
  it('stores accepted numeric results without changing header, point-read or transcript identities', async () => {
    const h = await setup()
    const before = h.window.getSnapshot()
    const header = h.client.getQueryData(QueryKeys.ChatSessionHeader('s'))
    const message = h.client.getQueryData(QueryKeys.ChatSessionMessage('s', 'm0'))
    const accepted = await h.repo.acceptSessionTextTokenResults('s', h.results)
    await h.events.publish({ type: 'session-text-tokens-cached', ...accepted })
    expect(accepted.results).toHaveLength(h.results.length)
    expect(await h.rows.readTextTokenResults(h.results.map((result) => result.source))).toEqual(h.results)
    expect(h.window.getSnapshot()).toBe(before)
    expect(h.client.getQueryData(QueryKeys.ChatSessionHeader('s'))).toBe(header)
    expect(h.client.getQueryData(QueryKeys.ChatSessionMessage('s', 'm0'))).toBe(message)
    expect(before.rows.every((row) => row.message.tokenCount === 90 && row.message.tokenCountMap === undefined)).toBe(
      true
    )
    expect((await h.rows.readCommit('s'))?.revision).toBe(before.revision)
  })

  it('does not cancel or overlay an in-flight independent message read', async () => {
    const h = await setup()
    const old = await h.repo.readSessionMessages({ sessionId: 's', messageIds: ['m1'] })
    let release!: () => void
    h.point.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return old
    })
    const pending = h.client.fetchQuery(h.bridge.definitions.message('s', 'm1'))
    await vi.waitFor(() => expect(release).toBeDefined())
    await h.events.publish({
      type: 'session-text-tokens-cached',
      ...(await h.repo.acceptSessionTextTokenResults('s', h.results)),
    })
    release()
    const read = await pending
    expect(read?.message?.tokenCountMap).toBeUndefined()
    expect(read?.message?.tokenCount).toBe(90)
    expect(h.point).toHaveBeenCalledTimes(2)
  })

  it('rejects delayed results after the payload changes at the same message identity', async () => {
    const h = await setup()
    const target = h.results[0].source.messageId
    await h.repo.executeSessionCommand('s', {
      type: 'update',
      messageId: target,
      updater: (message) => {
        if (!message) throw new Error('Missing message')
        return { ...message, contentParts: [{ type: 'text', text: 'edited' }] }
      },
    })
    const accepted = await h.repo.acceptSessionTextTokenResults('s', [h.results[0]])
    expect(accepted.results).toEqual([])
    expect(await h.rows.readTextTokenResults([h.results[0].source])).toEqual([])
  })
})
