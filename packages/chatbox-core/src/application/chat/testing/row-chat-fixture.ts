import { vi } from 'vitest'
import { InMemorySessionRecordStore } from '../../../testing/InMemorySessionRecordStore'
import { InMemorySessionRowStore } from '../../../testing/InMemorySessionRowStore'
import { decodeSessionTree } from '../../../session/session-tree/decode'
import { encodeSessionTree } from '../../../session/session-tree/encode'
import type { Session } from '../../../types'
import { RowBackedSessionRepository } from '../../session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../../session/SessionRowWriteQueue'
import { convertLegacyTreeToRowFormat } from '../../session/compatibility/row-format'
import type { ChatMessageSessionPort } from '../ChatMessageService'
import type { SessionUseCasePort } from '../../session/session-use-case-port'

/** Full objects are fixture input/output only; application calls exercise the row repository. */
export function rowChatFixture(createId: () => string, initial?: Session) {
  const sessions = new Map<string, Session>(initial ? [[initial.id, initial]] : [])
  const storedFixtures = new Map<string, Session>()
  const rows = new InMemorySessionRowStore()
  const records = new InMemorySessionRecordStore()
  const repository = new RowBackedSessionRepository({
    rows,
    records,
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })
  async function prepare(sessionId: string) {
    const fixture = sessions.get(sessionId)
    if (!fixture || fixture === storedFixtures.get(sessionId)) return
    storedFixtures.set(sessionId, fixture)
    const encoded = encodeSessionTree(fixture, { activeThreadId: fixture.id, now: 1 })
    if (!encoded.ok) throw new Error(encoded.reason)
    const tree = convertLegacyTreeToRowFormat(encoded.tree, encoded.normalized.messageForksHash)
    const previous = await rows.getRevision(sessionId)
    await rows.writeRows(
      {
        record: tree.session,
        revision: (previous ?? 0) + 1,
        rows: { sessionId, threads: tree.threads, messages: tree.messages },
      },
      previous
    )
  }
  function publish(sessionId: string) {
    const snapshot = rows.snapshot().find((entry) => entry.record.id === sessionId)
    if (!snapshot) throw new Error('Missing fixture session')
    const decoded = decodeSessionTree({
      session: snapshot.record,
      threads: snapshot.rows.threads,
      messages: snapshot.rows.messages,
    })
    if (!decoded.ok) throw new Error(decoded.reason)
    sessions.set(sessionId, decoded.session)
    storedFixtures.set(sessionId, decoded.session)
  }
  const port = {
    createSession: vi.fn<ChatMessageSessionPort['createSession']>(async (input) => {
      const { messages = [], ...fields } = input
      const delta = await repository.createSessionRows({ ...fields, id: createId() }, messages)
      publish(delta.sessionId)
      return delta.header
    }),
    getSessionHeader: async (id: string) => {
      await prepare(id)
      return repository.getSessionHeader(id)
    },
    readSessionMessages: async (request: Parameters<ChatMessageSessionPort['readSessionMessages']>[0]) => {
      await prepare(request.sessionId)
      return repository.readSessionMessages(request)
    },
    readSessionGenerationControl: async (
      request: Parameters<ChatMessageSessionPort['readSessionGenerationControl']>[0]
    ) => {
      await prepare(request.sessionId)
      return repository.readSessionGenerationControl(request)
    },
    executeStructureCommand: vi.fn<ChatMessageSessionPort['executeStructureCommand']>(
      async (id, operation, onCommitted) => {
        await prepare(id)
        const { delta } = await repository.executeSessionCommand(id, { type: 'structure', operation })
        publish(id)
        if (delta.structureResult) onCommitted?.(delta.structureResult)
        return delta.structureResult ?? null
      }
    ),
    insertMessagesAtRevision: async (
      id: string,
      messages: Parameters<ChatMessageSessionPort['insertMessagesAtRevision']>[1],
      revision: number,
      onPersisted?: Parameters<ChatMessageSessionPort['insertMessagesAtRevision']>[3]
    ) => {
      await prepare(id)
      const { delta } = await repository.executeSessionCommand(id, { type: 'append', messages }, revision)
      publish(id)
      onPersisted?.(delta.header)
      return delta.header
    },
    updateMessage: async (
      id: string,
      messageId: string,
      updater: Parameters<ChatMessageSessionPort['updateMessage']>[2]
    ) => {
      await prepare(id)
      await repository.executeSessionCommand(id, { type: 'update', messageId, updater })
      publish(id)
    },
  } satisfies ChatMessageSessionPort
  const useCases: SessionUseCasePort = {
    async readSessionNamingMessages(request) {
      await prepare(request.sessionId)
      return repository.readSessionNamingMessages(request)
    },
    getSessionHeader: port.getSessionHeader,
    readSessionMessages: port.readSessionMessages,
    executeStructureCommand: port.executeStructureCommand,
    async getCurrentThreadIdentity(id) {
      await prepare(id)
      return repository.getCurrentThreadIdentity(id)
    },
    async readSessionThread(request) {
      await prepare(request.sessionId)
      return repository.readSessionThread(request)
    },
    async readSessionTranscriptWindow(request) {
      await prepare(request.sessionId)
      return repository.readSessionTranscriptWindow(request)
    },
    async updateSessionHeader(id, updater) {
      await prepare(id)
      const { delta } = await repository.executeSessionCommand(id, { type: 'header', updater })
      publish(id)
      return delta.header
    },
  }
  return { sessions, rows, records, repository, port, useCases, prepare, publish }
}
