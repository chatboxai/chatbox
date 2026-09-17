import { type Message, type Session, SessionWriteConflictError } from '@chatbox/core'
import {
  RowBackedSessionRepository,
  snapshotStreamingMessage,
  StreamingWriteCoordinator,
} from '@chatbox/core/application/session'
import { SqlSessionRowStore } from '@chatbox/core/persistence'
import type { SessionReadModel } from '@chatbox/core/ports'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySettingsStorage } from '@chatbox/core/testing'
import { createChatApplication, createChatQueryClient, QueryKeys } from '@chatbox/react'
import { QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'

const cleanup: Array<() => void> = []

afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function assistant(text: string, generating = true): Message {
  return { id: 'assistant', role: 'assistant', generating, contentParts: [{ type: 'text', text }] }
}

function messageText(session: Session | null | undefined): string | undefined {
  return session?.messages
    .find((message) => message.id === 'assistant')
    ?.contentParts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
}

async function setup() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const database = openNodeSessionRowDatabase()
  cleanup.push(() => database.close())
  class Repository extends RowBackedSessionRepository {
    readonly meta = new InMemorySessionRepository().meta
  }
  const repository = new Repository({
    rows: new SqlSessionRowStore(database),
    records: new InMemorySessionRecordStore(),
    requiresCompleteWorkModeView: false,
  })
  const session: Session = {
    id: 'existing-session',
    name: 'Existing conversation',
    type: 'chat',
    messages: [
      { id: 'old-user', role: 'user', contentParts: [{ type: 'text', text: 'Earlier question' }] },
      { id: 'old-assistant', role: 'assistant', contentParts: [{ type: 'text', text: 'Earlier reply' }] },
      { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Continue the conversation' }] },
    ],
  }
  await repository.setSession(session)
  const client = createChatQueryClient()
  const fullKey = QueryKeys.ChatSession(session.id)
  const modelKey = QueryKeys.ChatSessionReadModel(session.id)
  client.setQueryDefaults(fullKey, { gcTime: 30 })
  cleanup.push(() => client.clear())
  const application = createChatApplication({
    queryClient: client,
    sessionRepository: repository,
    settingsStorage: new InMemorySettingsStorage(),
    session: { createId: () => 'unused' },
    settings: { isDesktopLike: false },
  })
  cleanup.push(() => application.dispose())
  await application.bootstrap()
  const bridge = application.sessionQueryBridge
  const initialReadModel = await client.fetchQuery(bridge.definitions.readModel(session.id))
  expect(bridge.getCachedSession(session.id)).toBeUndefined()
  await bridge.requireCompleteSessionView(session.id)
  await application.sessions.insertMessage(session.id, assistant('A'))

  const visible = () => {
    const model = client.getQueryData<SessionReadModel>(modelKey)
    return model?.kind === 'full' ? model.session : undefined
  }
  const violations: string[] = []
  let lastText = messageText(visible()) ?? ''
  let removedFullQueries = 0
  let conflicts = 0
  const sample = () => {
    const state = client.getQueryState(modelKey)
    const current = messageText(visible())
    if (state?.status !== 'success' || current === undefined) {
      violations.push('Visible conversation became missing or loading')
      return
    }
    if (!current.startsWith(lastText)) violations.push(`Text regressed: ${lastText} -> ${current}`)
    lastText = current
  }
  const observer = new QueryObserver(client, bridge.definitions.readModel(session.id))
  cleanup.push(observer.subscribe(sample))
  cleanup.push(
    client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[1] !== session.id) return
      if (event.type === 'removed' && event.query.queryKey[0] === fullKey[0]) removedFullQueries += 1
      if (event.query.queryKey[0] === modelKey[0]) sample()
    })
  )
  const writeSession = repository.setSession.bind(repository)
  vi.spyOn(repository, 'setSession').mockImplementation(async (...args) => {
    try {
      await writeSession(...args)
    } catch (error) {
      if (error instanceof SessionWriteConflictError) conflicts += 1
      throw error
    }
  })

  const scheduler = new StreamingWriteCoordinator()
  const key = `${session.id}\u0000assistant`
  const stream = (message: Message) => {
    const snapshot = snapshotStreamingMessage(message)
    return scheduler.runCacheUpdate(key, (isCurrent) =>
      bridge.updateMessageCache(session.id, snapshot.id, snapshot, { shouldApply: isCurrent })
    )
  }
  const persist = (message: Message, checkpoint = false) => {
    const snapshot = snapshotStreamingMessage(message)
    const write = () => application.sessions.updateMessage(session.id, snapshot.id, snapshot)
    return checkpoint
      ? scheduler.scheduleCheckpoint(key, write)
      : snapshot.generating === false
        ? scheduler.persistTerminal(key, write)
        : write()
  }
  const collectFullQuery = async () => {
    expect(client.getQueryCache().find({ queryKey: fullKey, exact: true })?.getObserversCount()).toBe(0)
    const before = removedFullQueries
    await vi.advanceTimersByTimeAsync(31)
    expect(bridge.getCachedSession(session.id)).toBeUndefined()
    expect(removedFullQueries).toBeGreaterThan(before)
    sample()
  }
  const assertFinished = async (text: string) => {
    const stored = await repository.getSession(session.id)
    expect(messageText(stored)).toBe(text)
    expect(stored?.messages.slice(0, 3)).toEqual(session.messages)
    expect(stored?.messages.at(-1)).toMatchObject({ generating: false })
    expect(stored?.messages.at(-1)?.error).toBeUndefined()
    expect(messageText(visible())).toBe(text)
    expect(visible()?.messages.at(-1)?.generating).toBe(false)
    expect(conflicts).toBe(0)
    expect(violations).toEqual([])
  }
  return {
    application,
    repository,
    client,
    bridge,
    session,
    initialReadModel,
    visible,
    stream,
    persist,
    collectFullQuery,
    assertFinished,
  }
}

describe('shared streaming writes in one application instance', () => {
  test('continues an existing session through repeated unobserved cache collection', async () => {
    const h = await setup()
    const live = assistant('AB')
    await h.stream(live)
    const part = live.contentParts[0]
    if (part.type !== 'text') throw new Error('Missing text fixture')
    part.text = 'ABC'
    expect(messageText(h.visible())).toBe('AB')
    await h.collectFullQuery()
    await h.stream(live)
    expect(messageText(h.visible())).toBe('ABC')
    await h.persist(live, true)
    await h.collectFullQuery()
    part.text = 'ABCD'
    await h.stream(live)
    await h.persist(assistant('ABCD', false))
    await h.assertFinished('ABCD')
  })

  test('keeps the latest visible text when a slow checkpoint completes after full-cache collection', async () => {
    const h = await setup()
    await h.stream(assistant('AB'))
    const started = deferred<void>()
    const release = deferred<void>()
    const write = h.repository.setSession.bind(h.repository)
    vi.spyOn(h.repository, 'setSession').mockImplementationOnce(async (...args) => {
      started.resolve()
      await release.promise
      await write(...args)
    })
    const checkpoint = h.persist(assistant('AB'), true)
    await started.promise
    await h.stream(assistant('ABCD'))
    await h.collectFullQuery()
    expect(messageText(h.visible())).toBe('ABCD')
    release.resolve()
    await checkpoint
    await h.stream(assistant('ABCDE'))
    await h.persist(assistant('ABCDE', false))
    await h.assertFinished('ABCDE')
  })

  test('does not let a delayed cache read overwrite the terminal result', async () => {
    const h = await setup()
    await h.stream(assistant('AB'))
    await h.collectFullQuery()
    const old = await h.repository.getCompleteSessionSource(h.session.id)
    const started = deferred<void>()
    const read = deferred<typeof old>()
    vi.spyOn(h.repository, 'getCompleteSessionSource').mockImplementationOnce(async () => {
      started.resolve()
      return read.promise
    })
    const cacheUpdate = h.stream(assistant('ABC'))
    await started.promise
    await h.persist(assistant('ABCD', false))
    read.resolve(old)
    await cacheUpdate
    await h.assertFinished('ABCD')
  })

  test('keeps the newest chunk when a cold cache read resumes after a newer cache hit', async () => {
    const h = await setup()
    await h.collectFullQuery()
    const stored = await h.repository.getCompleteSessionSource(h.session.id)
    const started = deferred<void>()
    const read = deferred<typeof stored>()
    vi.spyOn(h.repository, 'getCompleteSessionSource').mockImplementationOnce(async () => {
      started.resolve()
      return read.promise
    })
    const olderUpdate = h.stream(assistant('AB'))
    await started.promise
    let newerUpdate: Promise<void> | undefined
    const unsubscribe = h.client.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        event.query.queryKey[0] === QueryKeys.ChatSession(h.session.id)[0] &&
        !newerUpdate
      ) {
        newerUpdate = h.stream(assistant('ABCD'))
      }
    })
    cleanup.push(unsubscribe)
    read.resolve(stored)
    await olderUpdate
    expect(newerUpdate).toBeDefined()
    await newerUpdate
    expect(messageText(h.visible())).toBe('ABCD')
    await h.persist(assistant('ABCD', false))
    await h.assertFinished('ABCD')
  })

  test('does not project the stored snapshot while superseded updates await the same cold read', async () => {
    const h = await setup()
    await h.stream(assistant('AB'))
    await h.collectFullQuery()
    const stored = await h.repository.getCompleteSessionSource(h.session.id)
    const started = deferred<void>()
    const read = deferred<typeof stored>()
    vi.spyOn(h.repository, 'getCompleteSessionSource').mockImplementationOnce(async () => {
      started.resolve()
      return read.promise
    })
    const olderUpdate = h.stream(assistant('ABC'))
    await started.promise
    const newerUpdate = h.stream(assistant('ABCD'))
    read.resolve(stored)
    await Promise.all([olderUpdate, newerUpdate])
    await h.persist(assistant('ABCD', false))
    await h.assertFinished('ABCD')
  })

  test('does not recover streamed text from a retained read model when the complete cache is explicitly null', async () => {
    const h = await setup()
    const committed = await h.repository.getSession(h.session.id)
    if (!committed) throw new Error('Missing committed fixture')
    await h.stream(assistant('ABCD'))
    h.client.setQueryData(QueryKeys.ChatSession(h.session.id), null)
    expect(messageText(h.visible())).toBe('ABCD')
    expect(h.bridge.getCachedSession(h.session.id)).toBeNull()

    await h.application.sessionEvents.publish({
      type: 'session-updated',
      session: committed,
      meta: null,
      preserveCachedGeneratingMessages: true,
    })

    expect(messageText(h.visible())).toBe('A')
    expect(h.bridge.getCachedSession(h.session.id)?.messages).toEqual(committed.messages)
  })

  test('does not merge a partial message window into a complete committed session', async () => {
    const h = await setup()
    const committed = await h.repository.getSession(h.session.id)
    const window = await h.repository.readSessionMessageWindow({ sessionId: h.session.id, limit: 1 })
    if (!committed || !window || h.initialReadModel?.kind !== 'window') {
      throw new Error('Missing window fixture')
    }
    expect(window.messages).toHaveLength(1)
    expect(window.messages[0].messageId).toBe('assistant')
    const partial: SessionReadModel = {
      ...h.initialReadModel,
      window: {
        ...window,
        messages: window.messages.map((row) => ({ ...row, message: assistant('ABCD') })),
      },
    }
    h.client.setQueryData(QueryKeys.ChatSessionReadModel(h.session.id), partial)
    await h.collectFullQuery()

    await h.application.sessionEvents.publish({
      type: 'session-updated',
      session: committed,
      meta: null,
      preserveCachedGeneratingMessages: true,
    })

    expect(messageText(h.visible())).toBe('A')
    expect(h.visible()?.messages).toEqual(committed.messages)
    expect(h.visible()?.messages.slice(0, 3)).toEqual(h.session.messages)
    expect(h.bridge.getCachedSession(h.session.id)?.messages).toEqual(committed.messages)
  })
})
