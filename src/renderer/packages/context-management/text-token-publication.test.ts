import { type Session, SessionEventBus } from '@chatbox/core'
import { RowBackedSessionRepository } from '@chatbox/core/application/session'
import type { SessionContextSource, SessionMessageWindow, SessionReadModel } from '@chatbox/core/ports'
import { InMemorySessionRecordStore } from '@chatbox/core/testing'
import { type InfiniteData, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessContextPressure } from '@/packages/context-management/context-pressure'
import { sumCachedTokensFromMessages } from '@/packages/token'
import { openNodeSessionRowDatabase } from '../../../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../../../packages/chatbox-core/src/persistence/session-row-sql'
import { QueryKeys } from '../../../../packages/chatbox-react/src/query/query-keys'
import { SessionQueryBridge } from '../../../../packages/chatbox-react/src/query/session-query-bridge'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
})

async function setup() {
  const db = openNodeSessionRowDatabase()
  const repo = new RowBackedSessionRepository({
    rows: new SqlSessionRowStore(db),
    records: new InMemorySessionRecordStore(),
  })
  const session: Session = {
    id: 's',
    name: 's',
    type: 'chat',
    settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      timestamp: 1,
      tokenCount: 90,
      contentParts: [{ type: 'text', text: `text ${i}` }],
    })),
  }
  await repo.setSession(session)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const events = new SessionEventBus()
  const complete = vi.fn((id: string) => repo.getCompleteSessionSource(id))
  const page = async () => ({ items: [], total: 0, nextCursor: null })
  const bridge = new SessionQueryBridge(
    client,
    {
      getSession: (id) => repo.getSession(id),
      getCompleteSessionSource: complete,
      getSessionReadModel: (id) => repo.getSessionReadModel(id),
      getSessionContextSource: (request) => repo.getSessionContextSource(request),
      listSessionsMetaPage: page,
      listArchivedSessionsMetaPage: page,
    },
    events
  )
  cleanup.push(() => {
    bridge.dispose()
    client.clear()
    db.close()
  })
  const model = await client.fetchQuery(bridge.definitions.readModel('s'))
  if (model?.kind !== 'window') throw new Error('fixture must use a window')
  const context = await client.fetchQuery(bridge.definitions.contextSource('s'))
  if (!context?.textTokens) throw new Error('missing source fixture')
  const pageKey = [...QueryKeys.ChatSessionWindows('s'), model.window.revision]
  client.setQueryData(pageKey, { pages: [model.window], pageParams: [null] })
  const results = Object.values(context.textTokens.sources).map((source) => ({
    source,
    value: { tokenizerType: 'default' as const, sourceDigest: source.textDigest, tokens: 123, calculatedAt: 10 },
  }))
  return { repo, client, events, bridge, complete, context, results, pageKey, model }
}

describe('source-bound token cache publication', () => {
  it('retains same-revision windows and updates complete, context, pressure and arbitrary tails together', async () => {
    const h = await setup()
    await h.bridge.getSession('s')
    const result = await h.repo.acceptSessionTextTokenResults('s', h.results)
    await h.events.publish({ type: 'session-text-tokens-cached', ...result })
    const full = h.client.getQueryData<Session>(QueryKeys.ChatSession('s'))
    const context = h.client.getQueryData<SessionContextSource>(QueryKeys.ChatSessionContextSource('s'))
    const model = h.client.getQueryData<SessionReadModel>(QueryKeys.ChatSessionReadModel('s'))
    const pages = h.client.getQueryData<InfiniteData<SessionMessageWindow>>(h.pageKey)
    if (!full || !context || !model || !pages) throw new Error('Missing published fixture')
    expect(model.kind).toBe('window')
    if (model.kind === 'window') expect(model.window.revision).toBe(h.model.window.revision)
    expect(pages.pages[0].messages.every((row) => row.message.tokenCountMap?.default === 123)).toBe(true)
    expect(full.messages.every((message) => message.tokenCount === 90 && message.tokenCountMap?.default === 123)).toBe(
      true
    )
    for (const tail of [0, 10, 37, 59]) {
      const expected = full.messages.slice(tail)
      const actual = context.candidateMessages.slice(tail)
      expect(sumCachedTokensFromMessages(actual)).toBe(sumCachedTokensFromMessages(expected))
      for (const sandboxMode of [false, true])
        expect(assessContextPressure({ contextMessages: actual, sandboxMode })).toEqual(
          assessContextPressure({ contextMessages: expected, sandboxMode })
        )
    }
    expect(h.complete).toHaveBeenCalledTimes(1)
  })

  it('fences an older in-flight complete read and reads the accepted overlay at the same row revision', async () => {
    const h = await setup()
    const old = await h.repo.getCompleteSessionSource('s')
    let release!: () => void
    h.complete.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return old
    })
    const pending = h.bridge.getSession('s')
    await vi.waitFor(() => expect(release).toBeDefined())
    const result = await h.repo.acceptSessionTextTokenResults('s', h.results)
    await h.events.publish({ type: 'session-text-tokens-cached', ...result })
    release()
    expect((await pending)?.messages[0].tokenCountMap?.default).toBe(123)
    expect(h.client.getQueryData<Session>(QueryKeys.ChatSession('s'))?.messages[0].tokenCountMap?.default).toBe(123)
    expect(h.client.getQueryData(h.pageKey)).toBeDefined()
  })

  it('does not apply a result to an edited cached text even with copied message identity and timestamps', async () => {
    const h = await setup()
    const full = await h.bridge.getSession('s')
    if (!full) throw new Error('missing full')
    h.client.setQueryData(QueryKeys.ChatSession('s'), {
      ...full,
      messages: full.messages.map((message) => ({
        ...message,
        contentParts: [{ type: 'text', text: 'edited locally' }],
      })),
    })
    await h.events.publish({
      type: 'session-text-tokens-cached',
      ...(await h.repo.acceptSessionTextTokenResults('s', h.results)),
    })
    expect(
      h.client
        .getQueryData<Session>(QueryKeys.ChatSession('s'))
        ?.messages.every((message) => message.tokenCountMap === undefined)
    ).toBe(true)
  })
})
