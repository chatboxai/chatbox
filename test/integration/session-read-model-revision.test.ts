import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { RowBackedSessionRepository } from '@chatbox/core/application/session'
import { SqlSessionRowStore } from '@chatbox/core/persistence'
import type { SessionRowStorePort } from '@chatbox/core/ports'
import type { Session } from '@chatbox/core'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySettingsStorage } from '@chatbox/core/testing'
import { createChatApplication } from '@chatbox/react'
import { QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})
async function setup(
  driver: 'sqlite' | 'indexeddb',
  repairSessionOnRead?: (session: Session) => { session: Session; changed: boolean }
) {
  let rows: SessionRowStorePort
  if (driver === 'sqlite') {
    const database = openNodeSessionRowDatabase()
    cleanup.push(() => database.close())
    rows = new SqlSessionRowStore(database)
  } else {
    globalThis.indexedDB = new IDBFactory()
    rows = new IndexedDBSessionRowStore()
  }
  const repository = Object.assign(
    new RowBackedSessionRepository({ rows, records: new InMemorySessionRecordStore() }),
    {
      meta: new InMemorySessionRepository().meta,
    }
  )
  const application = createChatApplication({
    sessionRepository: repository,
    settingsStorage: new InMemorySettingsStorage(),
    session: { createId: () => 'unused', repairSessionOnRead },
    settings: { isDesktopLike: false },
  })
  cleanup.push(() => application.dispose())
  return { rows, repository, application }
}
const session = (): Session => ({
  id: 's',
  name: 'Named',
  threadName: 'Named',
  type: 'chat',
  settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
  messages: Array.from({ length: 120 }, (_, i) => ({
    id: `m${i}`,
    role: 'user',
    contentParts: [{ type: 'text', text: `text ${i}` }],
  })),
})

describe.each(['sqlite', 'indexeddb'] as const)('full read-model identity through the application on %s', (driver) => {
  it.each(['initial-full', 'window-to-full'] as const)(
    'projects continuous commands after %s without reloading history',
    async (entry) => {
      const h = await setup(driver)
      const original = session()
      if (entry === 'initial-full') original.messages.at(-1)!.generating = true
      await h.repository.setSession(original)
      const observer = new QueryObserver(
        h.application.queryClient,
        h.application.sessionQueryBridge.definitions.readModel('s')
      )
      const unsubscribe = observer.subscribe(() => {})
      cleanup.push(unsubscribe)
      await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
      if (entry === 'window-to-full') {
        expect(observer.getCurrentResult().data?.kind).toBe('window')
        await h.application.sessions.insertMessage('s', {
          id: 'reply',
          role: 'assistant',
          generating: true,
          contentParts: [],
        })
      }
      const snapshot = vi.spyOn(h.rows, 'readSnapshot')
      const complete = vi.spyOn(h.repository, 'getCompleteSessionSource')
      for (const operation of [
        () =>
          h.application.sessions.updateMessage('s', entry === 'initial-full' ? 'm119' : 'reply', {
            contentParts: [{ type: 'text', text: 'checkpoint' }],
          }),
        () => h.application.sessions.updateSessionHeader('s', { name: 'Renamed' }),
        () => h.application.sessions.insertMessage('s', { id: 'next', role: 'user', contentParts: [] }),
      ]) {
        await operation()
        const model = observer.getCurrentResult().data
        expect(model?.kind).toBe('full')
        if (model?.kind !== 'full') throw new Error('Expected complete history')
        expect(model.revision).toBe(await h.rows.getRevision('s'))
        expect(model.session.messages[0].id).toBe('m0')
      }
      expect(complete).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
    }
  )

  it.each(
    driver === 'sqlite'
      ? (['stream', 'newer-commit', 'full-update', 'delete', 'tokens'] as const)
      : (['stream', 'newer-commit', 'full-update', 'delete'] as const)
  )('keeps committed replies visible during atomic recovery (%s)', async (concurrent) => {
    const h = await setup(driver)
    const original = session()
    original.messages.push(
      ...['a', 'b'].map((id) => ({
        id,
        role: 'assistant' as const,
        generating: true,
        contentParts: [{ type: 'text' as const, text: 'initial' }],
      }))
    )
    await h.repository.setSession(original)
    const observer = new QueryObserver(
      h.application.queryClient,
      h.application.sessionQueryBridge.definitions.readModel('s')
    )
    cleanup.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    await h.application.sessions.updateSession('s', { starred: true })
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    const read = h.repository.getCompleteSessionSource.bind(h.repository)
    vi.spyOn(h.repository, 'getCompleteSessionSource').mockImplementationOnce(async (id) => {
      const result = await read(id)
      started()
      await waiting
      return result
    })
    const terminal = h.application.sessions.updateMessage('s', 'a', {
      generating: false,
      contentParts: [{ type: 'text', text: 'final a' }],
    })
    try {
      await reading
      await h.application.sessionQueryBridge.updateMessageCache('s', 'b', {
        contentParts: [{ type: 'text', text: 'live b' }],
      })
      if (concurrent === 'full-update') await h.application.sessions.updateSession('s', { name: 'Later full update' })
      if (concurrent === 'delete') await h.application.sessions.deleteSession('s')
      if (concurrent === 'tokens') {
        const sources = (await read('s'))!.textTokens!.sources
        for (const [id, tokens] of [
          ['m118', 66],
          ['m119', 77],
        ] as const) {
          const source = sources[id]
          await h.application.sessions.acceptSessionTextTokenResults('s', [
            { source, value: { tokenizerType: 'default', sourceDigest: source.textDigest, tokens, calculatedAt: 1 } },
          ])
        }
      }
      if (concurrent === 'newer-commit')
        await h.application.sessions.updateMessage('s', 'b', {
          generating: false,
          contentParts: [{ type: 'text', text: 'final b' }],
        })
    } finally {
      release()
      await terminal
    }
    if (concurrent === 'delete') {
      expect(
        h.application.queryClient.getQueryData(h.application.sessionQueryBridge.definitions.readModel('s').queryKey)
      ).toBeNull()
      return
    }
    const model = observer.getCurrentResult().data
    expect(model?.kind).toBe('full')
    if (model?.kind !== 'full') throw new Error('Expected full history')
    expect(model.session.messages.find((message) => message.id === 'a')).toMatchObject({
      generating: false,
      contentParts: [{ type: 'text', text: 'final a' }],
    })
    expect(model.session.messages.find((message) => message.id === 'b')?.contentParts).toEqual([
      { type: 'text', text: concurrent === 'newer-commit' ? 'final b' : 'live b' },
    ])
    if (concurrent === 'full-update') {
      expect(model.session.name).toBe('Later full update')
      expect(model.revision).toBeUndefined()
    } else expect(model.revision).toBe(await h.rows.getRevision('s'))
    if (concurrent === 'tokens') {
      expect(model.session.messages.find((message) => message.id === 'm118')?.tokenCountMap?.default).toBe(66)
      expect(model.session.messages.find((message) => message.id === 'm119')?.tokenCountMap?.default).toBe(77)
      expect(model.textTokens?.results.map((result) => result.source.messageId)).toEqual(
        expect.arrayContaining(['m118', 'm119'])
      )
    }
  })

  it.skipIf(driver !== 'sqlite')(
    'selects full history when token results arrive during the selection read',
    async () => {
      const h = await setup(driver)
      await h.repository.setSession(session())
      const observer = new QueryObserver(
        h.application.queryClient,
        h.application.sessionQueryBridge.definitions.readModel('s')
      )
      cleanup.push(observer.subscribe(() => {}))
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.kind).toBe('window'))
      const source = (await h.repository.getCompleteSessionSource('s'))!.textTokens!.sources.m119
      let release!: () => void
      let started!: () => void
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      const reading = new Promise<void>((resolve) => {
        started = resolve
      })
      const read = h.repository.getSessionReadModel.bind(h.repository)
      vi.spyOn(h.repository, 'getSessionReadModel').mockImplementationOnce(async (id) => {
        const result = await read(id)
        started()
        await waiting
        return result
      })
      const insertion = h.application.sessions.insertMessage('s', {
        id: 'reply',
        role: 'assistant',
        generating: true,
        contentParts: [],
      })
      try {
        await reading
        await h.application.sessions.acceptSessionTextTokenResults('s', [
          { source, value: { tokenizerType: 'default', sourceDigest: source.textDigest, tokens: 77, calculatedAt: 1 } },
        ])
      } finally {
        release()
        await insertion
      }
      const model = observer.getCurrentResult().data
      expect(model?.kind).toBe('full')
      if (model?.kind !== 'full') throw new Error('Expected full history')
      expect(model.session.messages.at(-1)?.id).toBe('reply')
      expect(model.session.messages.find((message) => message.id === 'm119')?.tokenCountMap?.default).toBe(77)
      expect(model.revision).toBe(await h.rows.getRevision('s'))
    }
  )

  it('retains live reply text when history navigation loads its first complete query', async () => {
    const h = await setup(driver)
    const original = session()
    original.messages.push({
      id: 'reply',
      role: 'assistant',
      generating: true,
      contentParts: [{ type: 'text', text: 'A' }],
    })
    await h.repository.setSession(original)
    const bridge = h.application.sessionQueryBridge
    const observer = new QueryObserver(h.application.queryClient, bridge.definitions.readModel('s'))
    cleanup.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    await bridge.updateMessageCache('s', 'reply', { contentParts: [{ type: 'text', text: 'ABC' }] })
    expect(h.application.queryClient.getQueryData(bridge.definitions.session('s').queryKey)).toBeUndefined()
    const viewed = await bridge.requireCompleteSessionView('s')
    expect(viewed?.messages.at(-1)?.contentParts).toEqual([{ type: 'text', text: 'ABC' }])
    const model = observer.getCurrentResult().data
    if (model?.kind !== 'full') throw new Error('Expected full history')
    expect(model.session.messages.at(-1)?.contentParts).toEqual([{ type: 'text', text: 'ABC' }])
    expect(model.revision).toBe(await h.rows.getRevision('s'))
    expect((await h.repository.getSession('s'))?.messages.at(-1)?.contentParts).toEqual([{ type: 'text', text: 'A' }])
  })

  it('returns repaired content with its newly committed atomic identity and token sources', async () => {
    const h = await setup(driver, (current) =>
      current.name === 'Repaired'
        ? { session: current, changed: false }
        : {
            changed: true,
            session: {
              ...current,
              name: 'Repaired',
              messages: current.messages.map((message, index) =>
                index ? message : { ...message, contentParts: [{ type: 'text', text: 'repaired text' }] }
              ),
            },
          }
    )
    const original = session()
    original.messages.at(-1)!.generating = true
    await h.repository.setSession(original)
    const previousRevision = await h.rows.getRevision('s')
    const model = await h.application.sessions.getSessionReadModel('s')
    expect(model?.kind).toBe('full')
    if (model?.kind !== 'full') throw new Error('Expected complete repaired history')
    const committed = (await h.repository.getCompleteSessionSource('s'))!
    expect(model.revision).toBe(committed.revision)
    expect(model.revision).toBeGreaterThan(previousRevision!)
    expect(model.session).toEqual(committed.session)
    expect(model.session.messages[0].contentParts).toEqual([{ type: 'text', text: 'repaired text' }])
    expect(model.textTokens).toEqual(committed.textTokens)
  })
})
