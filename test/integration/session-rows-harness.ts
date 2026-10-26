import 'fake-indexeddb/auto'
import type { Message, Session } from '@chatbox/core'
import {
  createSessionMetaRecord,
  RowBackedSessionRepository,
  SessionRowWriteQueue,
} from '@chatbox/core/application/session'
import { SqlSessionRowStore } from '@chatbox/core/persistence'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySettingsStorage } from '@chatbox/core/testing'
import { createChatApplication } from '@chatbox/react'
import { SessionTranscriptWindowController } from '@chatbox/react/query'
import { IDBFactory } from 'fake-indexeddb'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'

export const drivers = ['sqlite', 'indexeddb'] as const
export type Driver = (typeof drivers)[number]
export const message = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  timestamp: 1,
  contentParts: [{ type: 'text', text: id }],
})
export const source = (): Session => ({
  id: 's',
  name: 'Session',
  type: 'chat',
  threadName: 'Current',
  settings: { provider: 'test', modelId: 'test', agentMode: { value: 'off', locked: false, lockReason: null } },
  messages: [message('prompt'), message('answer', 'assistant')],
})

/** External legacy input is migrated once; every assertion and subsequent operation uses rows. */
export async function setupRows(driver: Driver, initial = source()) {
  let rows: SqlSessionRowStore | IndexedDBSessionRowStore
  let closeDatabase = () => {}
  if (driver === 'sqlite') {
    const db = openNodeSessionRowDatabase()
    rows = new SqlSessionRowStore(db)
    closeDatabase = () => db.close()
  } else {
    globalThis.indexedDB = new IDBFactory()
    const store = new IndexedDBSessionRowStore()
    rows = store
    closeDatabase = () => store.close()
  }
  const records = new InMemorySessionRecordStore()
  const createRepository = () =>
    new RowBackedSessionRepository({
      rows,
      records,
      writes: new SessionRowWriteQueue((_id, run) => run()),
    })
  const repository = Object.assign(createRepository(), {
    meta: new InMemorySessionRepository().meta,
  })
  await records.setRecord(initial)
  const initialHeader = await repository.getSessionHeader(initial.id)
  if (!initialHeader) throw new Error('Test input did not publish a row header')
  await repository.meta.create(createSessionMetaRecord(initialHeader.header, 1, 1))
  let sequence = 0
  const application = createChatApplication({
    sessionRepository: repository,
    settingsStorage: new InMemorySettingsStorage(),
    session: { createId: () => `generated-${++sequence}` },
    settings: { isDesktopLike: false },
  })
  const controllers: SessionTranscriptWindowController[] = []
  const unsubscribe: Array<() => void> = []
  const openWindow = async (pageSize = 20) => {
    const controller = new SessionTranscriptWindowController({
      sessionId: initial.id,
      pageSize,
      source: {
        readTranscriptWindow: (request) => repository.readSessionTranscriptWindow(request),
      },
    })
    controllers.push(controller)
    unsubscribe.push(application.sessionQueryBridge.registerWindow(initial.id, controller))
    await controller.open()
    acknowledge(controller)
    return controller
  }
  const readMessage = async (id: string) =>
    (await repository.readSessionMessages({ sessionId: initial.id, messageIds: [id] }))?.messages[0]
  const activeMessages = async () => {
    const page = await repository.readSessionTranscriptWindow({
      sessionId: initial.id,
      origin: { threadId: (await repository.getSessionHeader(initial.id))!.activeThreadId, edge: 'head' },
      limit: 200,
    })
    if (!page) throw new Error('Missing test transcript')
    if (page.newer) throw new Error('Test assertion exceeds its bounded message page')
    return page.messages.filter((row) => row.threadId === page.record.activeThreadId).map((row) => row.message)
  }
  return {
    rows,
    records,
    repository,
    createRepository,
    application,
    service: application.sessions,
    events: application.sessions.events,
    meta: repository.meta,
    openWindow,
    readMessage,
    activeMessages,
    dispose: () => {
      for (const stop of unsubscribe) stop()
      for (const controller of controllers) controller.close()
      application.dispose()
      closeDatabase()
    },
  }
}

export function acknowledge(controller: SessionTranscriptWindowController): void {
  const layout = controller.getSnapshot().layout
  if (layout) controller.acknowledgeLayout(layout.requestId)
}
