import { QueryClient } from '@tanstack/react-query'
import { SessionQueryBridge } from '../../packages/chatbox-react/src/query/session-query-bridge'
import * as codec from '../../packages/chatbox-core/src/session/session-tree/decode'
import * as compatibility from '../../packages/chatbox-core/src/application/session/compatibility/session-load'
import { getSessionMessageTokenizationDigest } from '../../packages/chatbox-core/src/application/session/message-derived-data'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../packages/chatbox-core/src/persistence/session-row-sql'
import { deriveContextReadProjection } from '../../packages/chatbox-core/src/persistence/session-context-read'
import type { SessionRowStorePort } from '../../packages/chatbox-core/src/ports/session-row-store'
import { encodeSessionTree } from '../../packages/chatbox-core/src/session/session-tree/encode'
import { deriveSessionTopologyFingerprint } from '../../packages/chatbox-core/src/session/session-tree/topology-fingerprint'
import { InMemorySessionRecordStore } from '../../packages/chatbox-core/src/testing/InMemorySessionRecordStore'
import { InMemorySessionRepository } from '../../packages/chatbox-core/src/testing/InMemorySessionRepository'
import type { Message, Session } from '../../packages/chatbox-core/src/types'
import { RowBackedSessionRepository } from '../../packages/chatbox-core/src/application/session/RowBackedSessionRepository'
import { SessionPersistenceProtocol } from '../../packages/chatbox-core/src/application/session/SessionPersistenceProtocol'
import { SessionService } from '../../packages/chatbox-core/src/application/session/SessionService'
import { SessionWriteCoordinator } from '../../packages/chatbox-core/src/application/session/SessionWriteCoordinator'
import { SessionEventBus } from '../../packages/chatbox-core/src/application/session/session-events'

const close: Array<() => void> = []
afterEach(() => {
  for (const dispose of close.splice(0)) dispose()
  vi.restoreAllMocks()
})
function message(id: string, role: Message['role'] = 'user'): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }], timestamp: 1 }
}
async function harness(driver: 'sqlite' | 'indexeddb') {
  let rows: SessionRowStorePort
  let sql: ReturnType<typeof openNodeSessionRowDatabase> | undefined
  if (driver === 'sqlite') {
    const db = openNodeSessionRowDatabase()
    sql = db
    close.push(() => db.close())
    rows = new SqlSessionRowStore(db)
  } else {
    globalThis.indexedDB = new IDBFactory()
    rows = new IndexedDBSessionRowStore()
  }
  const records = new InMemorySessionRecordStore()
  const repository = new RowBackedSessionRepository({ records, rows, requiresCompleteWorkModeView: false })
  await repository.initialize()
  const repo = Object.assign(repository, { meta: new InMemorySessionRepository().meta })
  const events = new SessionEventBus()
  const service = new SessionService(repo, new SessionWriteCoordinator(repo), events, { createId: () => 'unused' })
  return { rows, sql, records, repository, meta: repo.meta, events, service }
}

describe.each(['sqlite', 'indexeddb'] as const)('row commands on %s', (driver) => {
  it.each([false, true])(
    'keeps a canonical command projection equivalent to fresh decoding, forks=%s',
    async (forks) => {
      const h = await harness(driver)
      const legacy = { ...message('old'), contentParts: [], content: 'Imported text' }
      const source: Session = {
        id: 's',
        name: 'S',
        messages: [legacy, message('tail', 'assistant')],
        threads: [{ id: 'archived', name: 'Archived', createdAt: 0, messages: [message('archived-message')] }],
        ...(forks
          ? {
              messageForksHash: {
                old: {
                  position: 0,
                  createdAt: 1,
                  lists: [
                    { id: 'selected', messages: [] },
                    { id: 'alternative', messages: Array.from({ length: 26 }, (_, index) => message(`fork-${index}`)) },
                  ],
                },
              },
            }
          : {}),
      }
      const encoded = encodeSessionTree(source, { activeThreadId: 's', now: 0 })
      if (!encoded.ok) throw new Error(encoded.reason)
      await h.records.setRecord(encoded.tree.session)
      await h.rows.writeRows({
        record: encoded.tree.session,
        revision: 1,
        rows: {
          sessionId: 's',
          threads: encoded.tree.threads,
          messages: encoded.tree.messages,
        },
      })
      await h.service.getCompleteSessionSource('s')
      const decode = vi.spyOn(codec, 'decodeSessionTree')
      const migrate = vi.spyOn(compatibility, 'migrateSession')
      const fingerprint = vi.spyOn(SessionPersistenceProtocol.prototype, 'fingerprint')
      const commands = [
        () => h.service.insertMessages('s', [message('new-user'), message('new-reply', 'assistant')]),
        () => h.service.updateMessage('s', 'new-reply', { contentParts: [{ type: 'text', text: 'persisted reply' }] }),
        () => h.service.updateSessionHeader('s', { settings: undefined, threadName: undefined }),
        () =>
          h.repository.patchSessionMessageDerivedData('s', [
            {
              messageId: 'new-reply',
              text: [
                {
                  tokenizerType: 'default',
                  sourceDigest: getSessionMessageTokenizationDigest({
                    ...message('new-reply'),
                    contentParts: [{ type: 'text', text: 'persisted reply' }],
                  }),
                  tokens: 9,
                  calculatedAt: 100,
                },
              ],
            },
          ]),
      ]
      for (const command of commands) {
        decode.mockClear()
        migrate.mockClear()
        fingerprint.mockClear()
        await command()
        const actual = (await h.service.getCompleteSessionSource('s'))!
        expect(decode).not.toHaveBeenCalled()
        expect(migrate.mock.calls.every(([session]) => session.messages.length === 0)).toBe(true)
        expect(fingerprint).not.toHaveBeenCalled()
        const fresh = new RowBackedSessionRepository({ records: h.records, rows: h.rows })
        const expected = (await fresh.getCompleteSessionSource('s'))!
        expect(actual).toEqual(expected)
      }
      const complete = (await h.service.getCompleteSessionSource('s'))!
      fingerprint.mockClear()
      await h.repository.setSession({ ...complete.session, name: 'Full write' }, { baseSession: complete.session })
      expect(fingerprint).toHaveBeenCalled()
    }
  )

  it('keeps live display content out of canonical command projections', async () => {
    const h = await harness(driver)
    await h.repository.setSession({
      id: 's',
      name: 'S',
      messages: [{ ...message('reply', 'assistant'), generating: true }],
    })
    const queryClient = new QueryClient()
    const bridge = new SessionQueryBridge(queryClient, h.service, h.events)
    close.push(() => {
      bridge.dispose()
      queryClient.clear()
    })
    await bridge.requireCompleteSessionView('s')
    await bridge.updateMessageCache('s', 'reply', { contentParts: [{ type: 'text', text: 'live display' }] })
    expect((await bridge.getSessionWithLiveMessages('s'))?.messages[0].contentParts).toEqual([
      { type: 'text', text: 'live display' },
    ])
    await h.service.updateSessionHeader('s', { name: 'Renamed' })
    const complete = (await h.service.getCompleteSessionSource('s'))!
    expect(complete.session.messages[0].contentParts).toEqual([{ type: 'text', text: 'reply' }])
  })

  it('reuses committed row bodies after append, update and derived writes while refreshing token sources', async () => {
    const h = await harness(driver)
    await h.repository.setSession({ id: 's', name: 'S', messages: [message('old')] })
    const initial = (await h.service.getCompleteSessionSource('s'))!
    const read = vi.spyOn(h.rows, 'readSnapshot')
    await h.service.insertMessages('s', [message('next')])
    const appended = (await h.service.getCompleteSessionSource('s'))!
    expect(read).not.toHaveBeenCalled()
    expect(appended.session.messages.map((item) => item.id)).toEqual(['old', 'next'])
    expect(appended.textTokens?.sources.old).toEqual(initial.textTokens?.sources.old)
    const firstSource = appended.textTokens?.sources.next
    await h.service.updateMessage('s', 'next', { contentParts: [{ type: 'text', text: 'new body' }] })
    const updated = (await h.service.getCompleteSessionSource('s'))!
    expect(read).not.toHaveBeenCalled()
    if (firstSource) expect(updated.textTokens!.sources.next.payloadId).not.toBe(firstSource.payloadId)
    const sourceDigest = getSessionMessageTokenizationDigest(updated.session.messages[1])
    await h.repository.patchSessionMessageDerivedData('s', [
      {
        messageId: 'next',
        text: [{ tokenizerType: 'default', sourceDigest, tokens: 7, calculatedAt: 100 }],
      },
    ])
    const derived = (await h.service.getCompleteSessionSource('s'))!
    expect(read).not.toHaveBeenCalled()
    const currentSource = derived.textTokens?.sources.next
    if (currentSource)
      await h.repository.acceptSessionTextTokenResults('s', [
        {
          source: currentSource,
          value: { tokenizerType: 'default', sourceDigest: currentSource.textDigest, tokens: 11, calculatedAt: 200 },
        },
      ])
    await h.service.updateSessionHeader('s', { name: 'Renamed' })
    const late = (await h.service.getCompleteSessionSource('s'))!
    expect(late.textTokens?.sources.next).toEqual(currentSource)
    expect(late.session.messages[1].tokenCountMap?.default).toBe(currentSource ? 11 : 7)
    expect(read).not.toHaveBeenCalled()

    const other = new RowBackedSessionRepository({ records: h.records, rows: h.rows })
    await other.executeSessionCommand('s', {
      type: 'update',
      messageId: 'old',
      updater: { contentParts: [{ type: 'text', text: 'external' }] },
    })
    const external = (await h.service.getCompleteSessionSource('s'))!
    expect(read).toHaveBeenCalledTimes(1)
    expect(external.session.messages[0].contentParts).toEqual([{ type: 'text', text: 'external' }])
  })

  it.skipIf(driver !== 'sqlite')(
    'reloads when another writer changes the revision while missing token sources are read',
    async () => {
      const h = await harness(driver)
      await h.repository.setSession({ id: 's', name: 'S', messages: [message('old')] })
      await h.service.getCompleteSessionSource('s')
      await h.service.insertMessages('s', [message('next')])
      const read = vi.spyOn(h.rows, 'readSnapshot')
      const select = h.rows.readMessages.bind(h.rows)
      const other = new RowBackedSessionRepository({ records: h.records, rows: h.rows })
      vi.spyOn(h.rows, 'readMessages').mockImplementationOnce(async (request) => {
        await other.executeSessionCommand('s', {
          type: 'update',
          messageId: 'next',
          updater: { contentParts: [{ type: 'text', text: 'concurrent' }] },
        })
        return select(request)
      })
      const complete = (await h.service.getCompleteSessionSource('s'))!
      expect(read).toHaveBeenCalledTimes(1)
      expect(complete.session.messages[1].contentParts).toEqual([{ type: 'text', text: 'concurrent' }])
      expect(complete.textTokens!.sources.next.text).toBe('concurrent')
    }
  )

  it('normalizes cached imported row payloads after a command without trusting the write projection', async () => {
    const h = await harness(driver)
    const legacy = { ...message('old'), contentParts: [], content: 'Legacy body' }
    const source: Session = { id: 's', name: 'S', messages: [legacy] }
    const encoded = encodeSessionTree(source, { activeThreadId: 's', now: 0 })
    if (!encoded.ok) throw new Error(encoded.reason)
    await h.records.setRecord(encoded.tree.session)
    await h.rows.writeRows({
      record: encoded.tree.session,
      revision: 1,
      rows: { sessionId: 's', threads: encoded.tree.threads, messages: encoded.tree.messages },
    })
    await h.service.getCompleteSessionSource('s')
    const read = vi.spyOn(h.rows, 'readSnapshot')
    await h.service.insertMessages('s', [message('next')])
    const complete = (await h.service.getCompleteSessionSource('s'))!
    expect(read).not.toHaveBeenCalled()
    expect(complete.session.messages[0].contentParts).toEqual([{ type: 'text', text: 'Legacy body' }])
    const protocol = new SessionPersistenceProtocol(h.records, h.rows)
    const snapshot = (await h.rows.readSnapshot('s'))!
    const state = await protocol.inspectPersistedState('s', { snapshot })
    if (state.kind !== 'rows') throw new Error('Expected row state')
    expect(state.version.fingerprint).toBe(protocol.fingerprint(complete.session))
    expect(state.session.messages[0].contentParts).toEqual(complete.session.messages[0].contentParts)
    await h.repository.setSession(
      { ...complete.session, name: 'After canonical read' },
      { baseSession: complete.session }
    )
  })

  it('repairs metadata for empty and unchanged header patches without advancing row revision', async () => {
    const h = await harness(driver)
    await h.repository.setSession({ id: 's', name: 'S', threadName: 'Thread', messages: [message('old')] })
    const revision = await h.rows.getRevision('s')
    const commit = vi.spyOn(h.rows, 'applyDiff')
    const meta = vi.spyOn(h.meta, 'update')
    await h.service.updateSessionHeader('s', {})
    await h.service.updateSessionHeader('s', { name: 'S', threadName: 'Thread' })
    expect(await h.rows.getRevision('s')).toBe(revision)
    expect(commit).not.toHaveBeenCalled()
    expect(meta).toHaveBeenCalledTimes(2)
    expect(meta.mock.calls.at(-1)?.[1]).toMatchObject({ name: 'S' })
    meta.mockRejectedValueOnce(new Error('Metadata unavailable'))
    await expect(h.service.updateSessionHeader('s', { name: 'Changed' })).rejects.toThrow('Metadata unavailable')
    const changedRevision = await h.rows.getRevision('s')
    await vi.waitFor(() => expect(meta).toHaveBeenCalledTimes(4), { timeout: 2000 })
    expect(await h.rows.getRevision('s')).toBe(changedRevision)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(meta.mock.calls.at(-1)?.[1]).toMatchObject({ name: 'Changed' })
  })

  it('advances the canonical baseline across append, update and header commands for context reuse', async () => {
    const h = await harness(driver)
    await h.repository.setSession({
      id: 's',
      name: 'S',
      messages: Array.from({ length: 2738 }, (_, i) => message(`m${i}`)),
    })
    const initial = (await h.repository.getSession('s'))!
    const readContext = vi.spyOn(h.rows, 'readContext')
    const initialContext = await h.repository.getSessionContextSource({ sessionId: 's' })
    const canonical = readContext.mock.calls.at(-1)?.[1]
    const fullRead = vi.spyOn(h.rows, 'readSnapshot')
    const fingerprint = vi.spyOn(SessionPersistenceProtocol.prototype, 'fingerprint')
    const timings: number[] = []
    const operations = [
      () => h.service.insertMessages('s', [message('next')]),
      () => h.service.updateMessage('s', 'm2', { contentParts: [{ type: 'text', text: 'edited' }] }),
      () => h.service.updateSessionHeader('s', { name: 'Renamed' }),
    ]
    for (const operation of operations) {
      const started = performance.now()
      await operation()
      timings.push(performance.now() - started)
      h.sql?.reset()
      const context = (await h.repository.getSessionContextSource({ sessionId: 's' }))!
      const known = readContext.mock.calls.at(-1)?.[1]
      const payloadReads = h.sql?.executed.filter((sql) => sql.includes('FROM session_message_payload_chunks')).length
      process.stdout.write(
        JSON.stringify({ driver, contextRevision: context.revision, knownRevision: known?.revision, payloadReads }) +
          '\n'
      )
      expect(known?.revision).toBe(context.revision)
      expect(known?.rows.messages).toHaveLength(2739)
      for (const id of ['m0', 'm2737'])
        expect(known?.rows.messages.find((row) => row.messageId === id)?.message).toBe(
          canonical?.rows.messages.find((row) => row.messageId === id)?.message
        )
      expect(context.candidateMessages.map((item) => item.id)).toContain('next')
      if (driver === 'sqlite') expect(context.textTokens?.sources.m0).toEqual(initialContext?.textTokens?.sources.m0)
      if (driver === 'sqlite')
        expect(h.sql!.executed.filter((sql) => sql.includes('FROM session_message_payload_chunks'))).toEqual([])
    }
    expect(fullRead).not.toHaveBeenCalled()
    expect(fingerprint).not.toHaveBeenCalled()
    expect(
      (await h.repository.getSessionContextSource({ sessionId: 's' }))?.candidateMessages.find(
        (item) => item.id === 'm2'
      )?.contentParts
    ).toEqual([{ type: 'text', text: 'edited' }])
    await expect(
      h.repository.setSession({ ...initial, name: 'stale' }, { baseSession: initial })
    ).rejects.toMatchObject({ name: 'SessionWriteConflictError' })
    const latest = (await h.repository.getSession('s'))!
    await expect(
      h.repository.setSession({ ...latest, starred: true }, { baseSession: latest })
    ).resolves.toBeUndefined()
    expect((await h.repository.getSession('s'))?.starred).toBe(true)
    process.stdout.write(JSON.stringify({ driver, warmCanonicalRows: 2738, commandMs: timings }) + '\n')
  })

  it('does not reuse a baseline across another repository revision', async () => {
    const h = await harness(driver)
    await h.repository.setSession({ id: 's', name: 'S', messages: [message('old')] })
    await h.repository.getSession('s')
    const external = new RowBackedSessionRepository({ rows: h.rows, records: h.records })
    await external.executeSessionCommand('s', {
      type: 'update',
      messageId: 'old',
      updater: { contentParts: [{ type: 'text', text: 'external edit' }] },
    })
    h.sql?.reset()
    const externalContext = await h.repository.getSessionContextSource({ sessionId: 's' })
    expect(externalContext?.candidateMessages[0].contentParts).toEqual([{ type: 'text', text: 'external edit' }])
    if (driver === 'sqlite')
      expect(h.sql!.executed.some((sql) => sql.includes('FROM session_message_payload_chunks'))).toBe(true)
    await h.service.insertMessages('s', [message('next')])
    const readContext = vi.spyOn(h.rows, 'readContext')
    h.sql?.reset()
    const context = await h.repository.getSessionContextSource({ sessionId: 's' })
    expect(readContext.mock.calls[0][1]).toBeUndefined()
    expect(context?.candidateMessages.find((item) => item.id === 'old')?.contentParts).toEqual([
      { type: 'text', text: 'external edit' },
    ])
    if (driver === 'sqlite')
      expect(h.sql!.executed.some((sql) => sql.includes('FROM session_message_payload_chunks'))).toBe(true)
  })

  it.each([100, 1000, 10000])(
    'keeps repeated cold/warm command inputs bounded with %i historical messages',
    async (count) => {
      const h = await harness(driver)
      const source: Session = {
        id: 's',
        name: 'S',
        messages: Array.from({ length: count }, (_, i) => message(`old-${i}`)),
      }
      await h.repository.setSession(source)
      h.repository.forgetBaseline(source.id)
      const fullRead = vi.spyOn(h.rows, 'readSnapshot')
      const windows = vi.spyOn(h.rows, 'readMessageWindow')
      const selected = vi.spyOn(h.rows, 'readMessages')
      const hash = vi.spyOn(SessionPersistenceProtocol.prototype, 'fingerprint')
      const commit = vi.spyOn(h.rows, 'applyDiff')
      const publish = vi.spyOn(h.events, 'publish')
      const started = performance.now()
      await h.service.insertMessages('s', [message('u1'), message('a1', 'assistant')])
      await h.service.updateMessage('s', 'a1', {
        contentParts: [{ type: 'text', text: 'chunk one' }],
        generating: true,
      })
      await h.service.updateMessage('s', 'a1', {
        contentParts: [{ type: 'text', text: 'chunk two' }],
        generating: false,
      })
      await h.service.insertMessages('s', [message('u2'), message('a2', 'assistant')])
      await h.service.updateMessage('s', 'old-1', { contentParts: [{ type: 'text', text: 'edited old message' }] })
      await h.service.updateSessionHeader('s', { name: 'Renamed' })
      const elapsedMs = performance.now() - started
      expect(fullRead).not.toHaveBeenCalled()
      expect(hash).not.toHaveBeenCalled()
      expect(windows).toHaveBeenCalledTimes(6)
      expect(selected).toHaveBeenCalledTimes(5)
      expect(commit.mock.calls.map(([diff]) => diff.messages.upsert.length)).toEqual([3, 1, 1, 3, 1, 0])
      expect(publish.mock.calls.every(([event]) => event.type === 'session-command-committed')).toBe(true)
      const reads = await Promise.all([...windows.mock.results, ...selected.mock.results].map((result) => result.value))
      const readBodies = reads.reduce((sum, read) => sum + read.messages.length, 0)
      const readBytes = new TextEncoder().encode(JSON.stringify(reads)).byteLength
      process.stdout.write(
        JSON.stringify({
          driver,
          historicalMessages: count,
          elapsedMs,
          selectedReadCalls: reads.length,
          readBodies,
          readBytes,
        }) + '\n'
      )
      expect(readBodies).toBe(9)
      expect(readBytes).toBeLessThan(22000)
      expect((await h.repository.getSession('s'))?.messages).toHaveLength(count + 4)
    }
  )

  it('moves only the inactive suffix and preserves projection/topology across repeated append and tail updates', async () => {
    const h = await harness(driver)
    const alternate = {
      ...message('alternate'),
      files: [{ id: 'f', name: 'f.txt', storageKey: 'f', fileType: 'text/plain' }],
    }
    const summary = { ...message('summary', 'assistant'), isSummary: true }
    const source: Session = {
      id: 's',
      name: 'S',
      messages: [message('pivot'), message('answer', 'assistant')],
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'selected', messages: [] },
            { id: 'other', messages: [alternate, summary] },
          ],
        },
      },
      compactionPoints: [{ boundaryMessageId: 'alternate', summaryMessageId: 'summary', createdAt: 2 }],
      threads: [{ id: 'archive', name: 'Archive', createdAt: 0, messages: [message('archived')] }],
    }
    await h.repository.setSession(source)
    const before = (await h.rows.readSnapshot('s'))!
    const suffixIds = before.rows.messages
      .filter((row) => row.threadId === 's' && row.seq > 1)
      .map((row) => row.messageId)
    expect(suffixIds).toEqual(['alternate', 'summary'])
    const fullRead = vi.spyOn(h.rows, 'readSnapshot')
    const write = vi.spyOn(h.rows, 'applyDiff')
    await h.service.updateSessionHeader('s', { name: 'New name' })
    await h.service.updateMessage('s', 'answer', { contentParts: [{ type: 'text', text: 'changed' }] })
    await h.service.insertMessages('s', [message('new-user'), message('new-assistant', 'assistant')])
    await h.service.insertMessages('s', [message('last-user'), message('last-assistant', 'assistant')])
    expect(fullRead).not.toHaveBeenCalled()
    for (const [diff] of write.mock.calls.slice(2))
      expect(diff.unchangedPayloadMessageIds).toEqual(expect.arrayContaining(suffixIds))
    const after = (await h.rows.readSnapshot('s'))!
    expect(after.record.topologyFingerprint).toBe(
      deriveSessionTopologyFingerprint(after.rows.threads, after.rows.messages)
    )
    expect(after.record.contextReadProjection).toEqual(
      deriveContextReadProjection(after.rows.threads, after.rows.messages)
    )
    expect(after.rows.messages.find((row) => row.messageId === 'archived')).toEqual(
      before.rows.messages.find((row) => row.messageId === 'archived')
    )
    const read = (await h.repository.getSession('s'))!
    expect(read.messages.map((item) => item.id)).toEqual([
      'pivot',
      'answer',
      'new-user',
      'new-assistant',
      'last-user',
      'last-assistant',
    ])
    expect(read.messageForksHash?.pivot.lists[1].messages.map((item) => item.id)).toEqual(['alternate', 'summary'])
  })

  it('passes only the header to functional legacy header commands', async () => {
    const h = await harness(driver)
    await h.records.setRecord({ id: 's', name: 'S', messages: [message('old')], threadName: 'Thread' })
    const update = vi.fn((header) => ({ ...header, settings: { temperature: 0.4 } }))
    await h.service.updateSessionHeader('s', update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).not.toHaveProperty('messages')
    expect((await h.repository.getSession('s'))?.messages.map((message) => message.id)).toEqual(['old'])
  })

  it('publishes durable row deltas and repairs metadata without a full snapshot', async () => {
    const h = await harness(driver)
    await h.repository.setSession({ id: 's', name: 'S', messages: [message('old')] })
    const fullRead = vi.spyOn(h.rows, 'readSnapshot')
    const publish = vi.spyOn(h.events, 'publish')
    const failure = new Error('Metadata unavailable')
    const updateMeta = vi.spyOn(h.meta, 'update').mockRejectedValueOnce(failure)
    await expect(h.service.insertMessages('s', [message('next')])).rejects.toBe(failure)
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'session-command-committed',
      delta: { appendedMessageIds: ['next'] },
    })
    await vi.waitFor(() => expect(updateMeta).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(fullRead).not.toHaveBeenCalled()
    await h.service.updateMessage('s', 'next', { contentParts: [{ type: 'text', text: 'Recovered' }] })
    expect(fullRead).not.toHaveBeenCalled()
  })

  it('returns persisted complete-source identity through the service after a row command', async () => {
    const h = await harness(driver)
    await h.repository.setSession({ id: 's', name: 'S', messages: [message('old')] })
    await h.service.insertMessages('s', [message('next')])
    const persisted = (await h.rows.readSnapshot('s'))!
    const complete = (await h.service.getCompleteSessionSource('s'))!
    expect(complete.revision).toBe(persisted.revision)
    expect(complete.topologyFingerprint).toBe(persisted.record.topologyFingerprint)
    expect(complete.topologyFingerprint).toMatch(/^v2:/)
    expect(complete.session.messages.map((message) => message.id)).toEqual(['old', 'next'])
    await h.service.updateSessionHeader('s', { name: 'Updated' })
    const updated = (await h.service.getCompleteSessionSource('s'))!
    const stored = (await h.rows.readSnapshot('s'))!
    expect(updated.revision).toBe(stored.revision)
    expect(updated.revision).toBeGreaterThan(complete.revision!)
    expect(updated.topologyFingerprint).toBe(stored.record.topologyFingerprint)
    expect(updated.session.name).toBe('Updated')
  })

  it('passes only the header when the repository has no command capability', async () => {
    const repository = new InMemorySessionRepository()
    await repository.setSession({ id: 's', name: 'S', messages: [message('old')], threadName: 'Thread' })
    const service = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
      createId: () => 'unused',
    })
    const update = vi.fn((header) => ({ ...header, settings: { temperature: 0.4 } }))
    await service.updateSessionHeader('s', update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).not.toHaveProperty('messages')
    expect((await repository.getSession('s'))?.messages.map((message) => message.id)).toEqual(['old'])
  })

  it('migrates selected legacy payloads after a raw row import without reading the whole snapshot', async () => {
    const h = await harness(driver)
    const legacy = {
      ...message('legacy'),
      contentParts: [],
      content: 'Imported old text',
      tokenCalculatedAt: { default: 100 },
    }
    const source: Session = { id: 's', name: 'S', messages: [legacy] }
    const encoded = encodeSessionTree(source, { activeThreadId: 's', now: 0 })
    if (!encoded.ok) throw new Error('Fixture cannot be encoded')
    await h.records.setRecord(encoded.tree.session)
    await h.rows.writeRows({
      record: encoded.tree.session,
      revision: 1,
      rows: { sessionId: 's', threads: encoded.tree.threads, messages: encoded.tree.messages },
    })
    const fullRead = vi.spyOn(h.rows, 'readSnapshot')
    expect(
      (await h.repository.readSessionMessages({ sessionId: 's', messageIds: ['legacy'] }))?.messages[0].contentParts
    ).toEqual([{ type: 'text', text: 'Imported old text' }])
    await h.service.updateMessage('s', 'legacy', (current) => {
      if (!current) throw new Error('Missing imported message')
      return { ...current, contentParts: [{ type: 'text', text: 'Edited text' }] }
    })
    await h.service.insertMessages('s', [message('next')])
    expect(fullRead).not.toHaveBeenCalled()
    const updated = (await h.repository.readSessionMessages({ sessionId: 's', messageIds: ['legacy'] }))!.messages[0]
    expect(updated.contentParts).toEqual([{ type: 'text', text: 'Edited text' }])
    expect(updated.tokenCalculatedAt).toBeUndefined()
    expect((await h.repository.getSession('s'))?.messages[0].contentParts).toEqual(updated.contentParts)
  })
})
