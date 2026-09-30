import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { RowBackedSessionRepository } from '@chatbox/core/application/session'
import { SqlSessionRowStore } from '@chatbox/core/persistence'
import type { SessionReadModel, SessionRowStorePort } from '@chatbox/core/ports'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySettingsStorage } from '@chatbox/core/testing'
import { createChatApplication, QueryKeys } from '@chatbox/react'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})

describe.each(['sqlite', 'indexeddb'] as const)('durable full-write baselines on %s', (driver) => {
  it('writes metadata after row commands and live cache changes without treating the display as a persisted baseline', async () => {
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
      { meta: new InMemorySessionRepository().meta }
    )
    await repository.setSession({
      id: 's',
      name: 'Named',
      threadName: 'Named',
      type: 'chat',
      settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
      messages: [
        { id: 'prompt', role: 'user', contentParts: [{ type: 'text', text: 'Original prompt' }], timestamp: 1 },
      ],
    })
    const application = createChatApplication({
      sessionRepository: repository,
      settingsStorage: new InMemorySettingsStorage(),
      session: { createId: () => 'unused' },
      settings: { isDesktopLike: false },
    })
    cleanup.push(() => application.dispose())
    const bridge = application.sessionQueryBridge
    await application.sessions.updateMessage('s', 'prompt', {
      contentParts: [{ type: 'text', text: 'Committed edit' }],
    })
    await application.sessions.insertMessage('s', {
      id: 'reply',
      role: 'assistant',
      generating: true,
      contentParts: [],
      timestamp: 2,
    })
    // Title eligibility and explicit message readers can load this full query.
    await bridge.getSession('s')
    await bridge.updateMessageCache('s', 'reply', {
      contentParts: [{ type: 'text', text: 'Live reply' }],
      model: 'Selected model',
      status: [],
      isStreamingMode: true,
      timestamp: 3,
    })
    await expect(application.sessions.updateSession('s', { starred: true })).resolves.toMatchObject({ starred: true })
    await expect(application.sessions.updateSession('s', { name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed',
    })
    const saved = await repository.getSession('s')
    expect(saved?.messages[0].contentParts).toEqual([{ type: 'text', text: 'Committed edit' }])
    expect(saved?.messages[1].contentParts).toEqual([])
    const model = application.queryClient.getQueryData<SessionReadModel>(QueryKeys.ChatSessionReadModel('s'))
    expect(model?.kind).toBe('full')
    if (model?.kind !== 'full') throw new Error('Expected complete generating view')
    expect(model.session.messages[1].contentParts).toEqual([{ type: 'text', text: 'Live reply' }])
    expect(model.session.name).toBe('Renamed')
    await application.sessions.updateMessage('s', 'reply', {
      generating: false,
      finishReason: 'stop',
      contentParts: [{ type: 'text', text: 'Final reply' }],
    })
    expect((await repository.getSession('s'))?.messages[1]).toMatchObject({
      generating: false,
      contentParts: [{ type: 'text', text: 'Final reply' }],
    })
  })
})
