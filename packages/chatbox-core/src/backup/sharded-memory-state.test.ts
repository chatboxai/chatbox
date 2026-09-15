import type { Message, Session, SessionPromptContextSnapshot } from '@shared/types'
import { afterEach, expect, it } from 'vitest'
import { MemoryService } from '../application/memory/MemoryService'
import { createPausedMemoryTools } from '../application/memory/paused-memory-tools'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from '../persistence/node-sqlite.test-support'
import { contextSnapshot } from '../persistence/session-context-read.test-support'
import { SqlSessionRowStore } from '../persistence/session-row-sql'
import { decodeSessionTree } from '../session/session-tree/decode'
import type { MemoryToolContext } from '../types/agent-persona'
import { parseCopilotMemoryStateTokens } from '../types/agent-persona'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { MemoryMetaStorage, MemoryStorage } from './sharded.test-support'
import { BackupStorageKey } from './storage-keys'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function store() {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  return new SqlSessionRowStore(db)
}

function context(copilotId: string, lifecycleToken: string): MemoryToolContext {
  return { version: 1, enabled: true, scope: { type: 'copilot', copilotId, lifecycleToken } }
}

function pausedMessage(id: string, payload: boolean): Message {
  const contexts: Array<MemoryToolContext | undefined> = [
    context('tutor', 'source-life'),
    context('tutor', 'retired-life'),
    context('other', 'source-life'),
    { version: 1, enabled: true, scope: { type: 'global' } },
    undefined,
  ]
  return {
    id,
    role: 'assistant',
    contentParts: [
      { type: 'text', text: payload ? '🙂\n'.repeat(4096) : 'Continuing' },
      ...contexts.map((memoryToolContext, index) => ({
        type: 'tool-call' as const,
        toolName: 'save_memory',
        toolCallId: `${id}-${index}`,
        state: 'paused' as const,
        args: { content: `${id}-${index}` },
        pauseReason: { type: 'tool_call_limit' as const, maxToolCalls: 1 },
        ...(memoryToolContext ? { memoryToolContext } : {}),
      })),
    ],
  }
}

it.each([
  { payload: false, importLibrary: true },
  { payload: true, importLibrary: true },
  { payload: false, importLibrary: false },
  { payload: true, importLibrary: false },
])('preserves per-call memory ownership across v3 branches (%j)', async ({ payload, importLibrary }) => {
  const source = store()
  const destination = store()
  const frozen: SessionPromptContextSnapshot = {
    version: 1,
    scope: 'chat',
    soul: '',
    memories: [],
    memoryEnabled: true,
    memoryCopilotId: 'tutor',
    memoryCopilotLifecycleToken: 'source-life',
    memoryStateToken: 'source-state:',
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: 1,
  }
  const session: Session = {
    id: 'memory-branches',
    name: 'Memory branches',
    copilotId: 'tutor',
    settings: { sessionPromptContextSnapshot: frozen },
    messages: [{ id: 'pivot', role: 'user', contentParts: [] }, pausedMessage('current', payload)],
    threads: [
      {
        id: 'archived',
        name: 'Archived',
        createdAt: 1,
        messages: [pausedMessage('earlier', payload)],
        sessionPromptContextSnapshot: frozen,
      },
    ],
    messageForksHash: {
      pivot: {
        position: 1,
        createdAt: 1,
        lists: [
          { id: 'alternate', messages: [pausedMessage('fork', payload)] },
          { id: 'selected', messages: [] },
        ],
      },
    },
  }
  await source.writeRows(contextSnapshot(session))
  const storage = new MemoryStorage()
  storage.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'tutor', name: 'Tutor' }])
  storage.values.set(BackupStorageKey.CopilotMemoryTokens, [
    { id: 'tutor', token: 'source-state', retirementToken: 'source-life' },
  ])
  storage.values.set(BackupStorageKey.CopilotMemories, { tutor: [] })
  const limits = { maxRecordBytes: 16 * 1024, maxPageBytes: 32 * 1024 }
  let archive = new Blob()
  const exported = await exportBackupArchive({
    storage,
    metaStorage: new MemoryMetaStorage(),
    exportItems: importLibrary ? ['conversations', 'copilot'] : ['conversations'],
    includeKeys: false,
    application: { version: 'test', platform: 'test' },
    sharded: { store: source, limits },
    writeArchive: async (stream) => {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for await (const part of stream()) parts.push(new Uint8Array(part))
      archive = new Blob(parts)
      return { boundedMemory: true }
    },
  })
  expect(exported.manifest.formatVersion).toBe(3)
  if (exported.manifest.formatVersion !== 3) throw new Error('Expected sharded backup')
  expect(exported.manifest.sessions[0].payloads.length > 0).toBe(payload)

  const restoredStorage = new MemoryStorage()
  restoredStorage.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'tutor', name: 'Destination tutor' }])
  restoredStorage.values.set(BackupStorageKey.CopilotMemoryTokens, [
    { id: 'tutor', token: 'destination-state', retirementToken: 'destination-life' },
  ])
  await importBackupArchive(archive, {
    storage: restoredStorage,
    metaStorage: new MemoryMetaStorage(),
    sharded: { store: destination, limits },
  })
  const restoredRows = await destination.readSnapshot(session.id)
  if (!restoredRows) throw new Error('Restored session is missing')
  const decoded = decodeSessionTree({ session: restoredRows.record, ...restoredRows.rows })
  if (!decoded.ok) throw new Error(decoded.reason)
  const restored = decoded.session
  const finalToken = parseCopilotMemoryStateTokens(restoredStorage.values.get(BackupStorageKey.CopilotMemoryTokens))[0]
  const expectedLife = importLibrary ? finalToken.retirementToken : 'source-life'
  if (!expectedLife) throw new Error('Restored memory lifecycle is missing')
  expect(finalToken.retirementToken).not.toBe('source-life')
  expect(restored.settings?.sessionPromptContextSnapshot?.memoryCopilotLifecycleToken).toBe(expectedLife)
  expect(restored.threads?.[0].sessionPromptContextSnapshot?.memoryCopilotLifecycleToken).toBe(expectedLife)
  const messages = [
    restored.messages[1],
    restored.threads?.[0].messages[0],
    restored.messageForksHash?.pivot.lists[0].messages[0],
  ]
  const memory = new MemoryService({
    storage: {
      get: <T>(key: string) => restoredStorage.getItem<T | null>(key, null),
      set: (key, value) => restoredStorage.setItemNow(key, value),
    },
  })
  for (const message of messages) {
    if (!message) throw new Error('Restored branch message is missing')
    const original = pausedMessage(message.id, payload)
    expect(message.contentParts).toEqual(
      original.contentParts.map((part, index) =>
        index === 1 ? { ...part, memoryToolContext: context('tutor', expectedLife) } : part
      )
    )
    const { tools } = createPausedMemoryTools({ memory, targetMessage: message })
    const result = await tools.save_memory.execute?.(
      { content: message.id },
      { toolCallId: `${message.id}-0`, messages: [] }
    )
    expect(result).toHaveProperty(importLibrary ? 'message' : 'error')
  }
})
