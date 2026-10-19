import type { Session, SessionMetaRecord, Settings } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { MemoryService } from '../application/memory/MemoryService'
import { createMemoryToolContext, createPausedMemoryTools } from '../application/memory/paused-memory-tools'
import { parseCopilotMemoryStateTokens } from '../types/agent-persona'
import { exportBackupArchiveWithRows as exportBackupArchive } from './export.test-support'
import { importBackupArchiveWithRows as importBackupArchive, readImportedSession } from './import.test-support'
import { BackupStorageKey, backupSessionStorageKey } from './storage-keys'
import type { BackupExportItem, BackupFile, BackupMetaStorage, BackupStorage } from './types'

class MemoryStorage implements BackupStorage {
  readonly values = new Map<string, unknown>()
  readonly blobs = new Map<string, string>()

  getAllKeys(): Promise<string[]> {
    return Promise.resolve(Array.from(this.values.keys()))
  }

  getItem<T>(key: string, initialValue: T): Promise<T> {
    return Promise.resolve((this.values.has(key) ? this.values.get(key) : initialValue) as T)
  }

  setItemNow<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  removeItem(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  getBlob(key: string): Promise<string | null> {
    return Promise.resolve(this.blobs.get(key) ?? null)
  }

  setBlob(key: string, value: string): Promise<void> {
    this.blobs.set(key, value)
    return Promise.resolve()
  }

  delBlob(key: string): Promise<void> {
    this.blobs.delete(key)
    return Promise.resolve()
  }
}

class MemoryMetaStorage implements BackupMetaStorage {
  readonly records = new Map<string, SessionMetaRecord>()

  getAllIncludingHidden(): Promise<SessionMetaRecord[]> {
    return Promise.resolve(Array.from(this.records.values()))
  }

  getById(id: string): Promise<SessionMetaRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null)
  }

  create(record: SessionMetaRecord): Promise<void> {
    this.records.set(record.id, record)
    return Promise.resolve()
  }

  update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    const existing = this.records.get(id)
    if (!existing) return Promise.resolve(null)
    const updated = { ...existing, ...updates }
    this.records.set(id, updated)
    return Promise.resolve(updated)
  }

  delete(id: string): Promise<void> {
    this.records.delete(id)
    return Promise.resolve()
  }
}

function combine(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function asBackupFile(bytes: Uint8Array): BackupFile {
  return {
    size: bytes.byteLength,
    readBytes: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length)),
    async *chunks() {
      await Promise.resolve()
      yield bytes
    },
    text: () => Promise.reject(new Error('ZIP import must not read the file as text')),
  }
}

function createMeta(session: Session): SessionMetaRecord {
  return { id: session.id, name: session.name, sortOrder: 1, createdAt: 1 }
}

async function createArchive(
  storage: MemoryStorage,
  metaStorage: MemoryMetaStorage,
  exportItems: BackupExportItem[]
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  await exportBackupArchive({
    exportItems,
    includeKeys: exportItems.includes('key'),
    exportedAt: new Date('2026-08-31T00:00:00.000Z'),
    storage,
    metaStorage,
    application: { version: 'test', platform: 'test' },
    writeArchive: async (dataCallback) => {
      for await (const chunk of dataCallback()) chunks.push(chunk)
      return { boundedMemory: true }
    },
  })
  return combine(chunks)
}

type PromptSnapshot = NonNullable<NonNullable<Session['settings']>['sessionPromptContextSnapshot']>

function snapshot(memoryStateToken: string, content: string): PromptSnapshot {
  return {
    version: 1,
    soul: '',
    memories: [{ id: content, content, createdAt: 1 }],
    memoryEnabled: true,
    memoryStateToken,
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: 1,
    scope: 'chat',
  }
}

function pausedSession(id: string, current: PromptSnapshot, earlier: PromptSnapshot = current): Session {
  const messages: Session['messages'] = [
    {
      id: 'paused-assistant',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          toolCallId: 'memory-call',
          toolName: 'save_memory',
          state: 'paused',
          args: { content: 'Paused fact' },
          pauseReason: { type: 'tool_call_limit', maxToolCalls: 1 },
        },
      ],
    },
  ]
  return {
    id,
    name: id,
    copilotId: 'tutor',
    messages,
    settings: { sessionPromptContextSnapshot: current },
    threads: [{ id: 'earlier-thread', name: 'Earlier', createdAt: 1, messages, sessionPromptContextSnapshot: earlier }],
  }
}

function memoryService(storage: MemoryStorage): MemoryService {
  return new MemoryService({
    storage: {
      get: <T>(key: string) => storage.getItem<T | null>(key, null),
      set: (key, value) => storage.setItemNow(key, value),
    },
  })
}

describe('Memory state backup translation', () => {
  it.each([false, true])(
    'imports call identities across current, thread and fork messages (with Copilot: %s)',
    async (withCopilot) => {
      const source = new MemoryStorage()
      const destination = new MemoryStorage()
      const sourceMemory = memoryService(source)
      const destinationMemory = memoryService(destination)
      for (const memory of [sourceMemory, destinationMemory]) {
        await memory.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
      }
      await sourceMemory.addCopilotMemory('tutor', 'Source fact')
      await destinationMemory.addCopilotMemory('tutor', 'Destination fact')
      const sourceState = await sourceMemory.resolveState('tutor', {})
      const destinationState = await destinationMemory.resolveState('tutor', {})
      if (sourceState.scope.type !== 'copilot' || destinationState.scope.type !== 'copilot')
        throw new Error('Expected Copilot')
      expect(sourceState.scope.lifecycleToken).toEqual(expect.any(String))
      expect(sourceState.scope.lifecycleToken).not.toBe(destinationState.scope.lifecycleToken)
      const captured = {
        ...snapshot(sourceState.memoryStateToken, 'Captured'),
        memoryCopilotId: 'tutor',
        memoryCopilotLifecycleToken: sourceState.scope.lifecycleToken,
      }
      const session = pausedSession('call-context-import', captured)
      const originalPart = session.messages[0].contentParts[0]
      if (originalPart.type !== 'tool-call') throw new Error('Expected tool call')
      const context = createMemoryToolContext(sourceState.scope, true)
      const current = { ...session.messages[0], contentParts: [{ ...originalPart, memoryToolContext: context }] }
      const stale = {
        ...current,
        id: 'stale',
        contentParts: [
          {
            ...originalPart,
            memoryToolContext: {
              ...context,
              scope: { type: 'copilot' as const, copilotId: 'tutor', lifecycleToken: 'stale-source' },
            },
          },
        ],
      }
      session.messages = [
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Remember this' }] },
        current,
      ]
      if (session.threads) session.threads[0].messages = [{ ...current, id: 'thread-current' }]
      session.messageForksHash = {
        user: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'selected', messages: [] },
            { id: 'valid', messages: [{ ...current, id: 'fork-current' }] },
            { id: 'stale', messages: [stale] },
            { id: 'unknown', messages: [{ ...current, id: 'unknown', contentParts: [originalPart] }] },
          ],
        },
      }
      source.values.set(backupSessionStorageKey(session.id), session)
      const meta = new MemoryMetaStorage()
      meta.records.set(session.id, createMeta(session))
      const archive = await createArchive(source, meta, withCopilot ? ['copilot', 'conversations'] : ['conversations'])
      await importBackupArchive(asBackupFile(archive), {
        storage: destination,
        metaStorage: new MemoryMetaStorage(),
        createId: () => 'call-import',
      })
      const restored = await readImportedSession(destination, session.id)
      const memory = memoryService(destination)
      const targets = [
        restored.messages.find((message) => message.contentParts.some((part) => part.type === 'tool-call')),
        restored.threads?.[0].messages.find((message) =>
          message.contentParts.some((part) => part.type === 'tool-call')
        ),
        restored.messageForksHash?.user.lists
          .flatMap((list) => list.messages)
          .find((message) => message.id === 'fork-current'),
      ]
      for (const [index, targetMessage] of targets.entries()) {
        const tools = createPausedMemoryTools({ memory, targetMessage }).tools
        const result = await tools.save_memory.execute?.(
          { content: `Imported call ${index}` },
          { toolCallId: 'memory-call', messages: [], context: undefined }
        )
        expect(
          result,
          JSON.stringify({ index, target: targetMessage?.id, result, part: targetMessage?.contentParts[0] })
        ).toHaveProperty(withCopilot ? 'message' : 'error')
      }
      for (const list of restored.messageForksHash?.user.lists.filter((list) =>
        list.messages.some((message) => ['stale', 'unknown'].includes(message.id))
      ) ?? []) {
        const tools = createPausedMemoryTools({ memory, targetMessage: list.messages[0] }).tools
        expect(
          await tools.save_memory.execute?.(
            { content: 'Must not import stale call' },
            { toolCallId: 'memory-call', messages: [], context: undefined }
          )
        ).toHaveProperty('error')
      }
      expect(await memory.listMemories()).toEqual([])
      if (!withCopilot)
        expect((await memory.listCopilotMemories('tutor')).map((entry) => entry.content)).toEqual(['Destination fact'])
    }
  )

  it('keeps an unknown legacy conversation source unbound during a conversation-only import', async () => {
    const source = new MemoryStorage()
    const session = pausedSession('unknown-source', { ...snapshot('', 'Unknown'), memoryCopilotId: 'tutor' })
    const meta = new MemoryMetaStorage()
    source.values.set(backupSessionStorageKey(session.id), session)
    meta.records.set(session.id, createMeta(session))
    const archive = await createArchive(source, meta, ['conversations'])
    const destination = new MemoryStorage()
    const memory = memoryService(destination)
    await memory.enableCopilotMemory({ id: 'tutor', name: 'Destination' })
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'unknown-import',
    })
    const restored = await readImportedSession(destination, session.id)
    const scope = await memory.getPausedCallMemoryScope(restored.settings?.sessionPromptContextSnapshot, 'tutor')
    await expect(memory.addMemoryForScope(scope, 'Unknown old call')).resolves.toMatchObject({ ok: false })
  })

  it.each([
    { name: 'enabled Copilot', enabled: true, lifecycle: 'source-lifecycle', includeTokens: true },
    { name: 'disabled Copilot', enabled: false, lifecycle: 'source-lifecycle', includeTokens: true },
    { name: 'legacy token records', enabled: true, lifecycle: undefined, includeTokens: true },
    { name: 'legacy archive without token records', enabled: true, lifecycle: undefined, includeTokens: false },
  ])(
    'translates paused lifecycles independently of switches when restoring $name',
    async ({ enabled, lifecycle, includeTokens }) => {
      const captured: PromptSnapshot = {
        ...snapshot(enabled ? 'source-state:' : 'before-disable:', 'Captured memory'),
        memoryCopilotId: 'tutor',
        ...(lifecycle ? { memoryCopilotLifecycleToken: lifecycle } : {}),
      }
      const stale = { ...captured, memoryCopilotLifecycleToken: 'retired-source-lifecycle' }
      const session = pausedSession('source-current', captured)
      const staleSession = pausedSession('source-stale', stale)
      const source = new MemoryStorage()
      const sourceMeta = new MemoryMetaStorage()
      for (const entry of [session, staleSession]) {
        source.values.set(backupSessionStorageKey(entry.id), entry)
        sourceMeta.records.set(entry.id, createMeta(entry))
      }
      source.values.set(BackupStorageKey.CopilotMemoryOwners, enabled ? [{ id: 'tutor', name: 'Tutor' }] : [])
      source.values.set(BackupStorageKey.CopilotMemories, { tutor: captured.memories })
      if (includeTokens)
        source.values.set(BackupStorageKey.CopilotMemoryTokens, [
          { id: 'tutor', token: 'source-state', ...(lifecycle ? { retirementToken: lifecycle } : {}) },
        ])
      const archive = await createArchive(source, sourceMeta, ['copilot', 'conversations'])

      const destination = new MemoryStorage()
      const previous: PromptSnapshot = {
        ...captured,
        memoryCopilotLifecycleToken: 'destination-lifecycle',
      }
      const existing = pausedSession('destination-existing', previous)
      destination.values.set(backupSessionStorageKey(existing.id), existing)
      destination.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'tutor', name: 'Existing tutor' }])
      destination.values.set(BackupStorageKey.CopilotMemoryTokens, [
        { id: 'tutor', token: 'destination-state', retirementToken: 'destination-lifecycle' },
      ])
      await importBackupArchive(asBackupFile(archive), {
        storage: destination,
        metaStorage: new MemoryMetaStorage(),
        createId: () => 'paused-lifecycle-import',
      })

      const token = parseCopilotMemoryStateTokens(destination.values.get(BackupStorageKey.CopilotMemoryTokens))[0]
      expect(token.retirementToken).toEqual(expect.any(String))
      expect(token.retirementToken).not.toBe(lifecycle)
      expect(token.retirementToken).not.toBe('destination-lifecycle')
      const restored = await readImportedSession(destination, session.id)
      const staleRestored = await readImportedSession(destination, staleSession.id)
      const memory = memoryService(destination)
      for (const [index, restoredSnapshot] of [
        restored.settings?.sessionPromptContextSnapshot,
        restored.threads?.[0].sessionPromptContextSnapshot,
      ].entries()) {
        const hasSourceIdentity = Boolean(lifecycle || includeTokens)
        expect(restoredSnapshot?.memoryCopilotLifecycleToken).toBe(
          hasSourceIdentity ? token.retirementToken : 'source-state'
        )
        const scope = await memory.getPausedCallMemoryScope(restoredSnapshot, 'tutor')
        await expect(memory.addMemoryForScope(scope, `Imported paused fact ${index}`)).resolves.toMatchObject({
          ok: hasSourceIdentity,
        })
      }
      expect(restored.messages[0].contentParts[0]).toMatchObject({ type: 'tool-call', state: 'paused' })
      expect(restored.threads?.[0].messages[0].contentParts[0]).toMatchObject({ type: 'tool-call', state: 'paused' })
      for (const rejectedSnapshot of [
        staleRestored.settings?.sessionPromptContextSnapshot,
        staleRestored.threads?.[0].sessionPromptContextSnapshot,
        existing.settings?.sessionPromptContextSnapshot,
        existing.threads?.[0].sessionPromptContextSnapshot,
      ]) {
        const scope = await memory.getPausedCallMemoryScope(rejectedSnapshot, 'tutor')
        await expect(memory.addMemoryForScope(scope, 'Retired paused fact')).resolves.toMatchObject({ ok: false })
      }
      expect(staleRestored.settings?.sessionPromptContextSnapshot?.memoryCopilotLifecycleToken).toBe(
        'retired-source-lifecycle'
      )
      expect(destination.values.get(backupSessionStorageKey(existing.id))).toEqual(existing)
    }
  )

  it('preserves conversation-only lifecycles instead of granting access to an unrelated destination Copilot', async () => {
    const captured: PromptSnapshot = {
      ...snapshot('source-state', 'Captured'),
      memoryCopilotId: 'tutor',
      memoryCopilotLifecycleToken: 'source-lifecycle',
    }
    const session = pausedSession('conversation-only-copilot', captured)
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session))
    const archive = await createArchive(source, sourceMeta, ['conversations'])
    const destination = new MemoryStorage()
    const destinationToken = { id: 'tutor', token: 'destination-state', retirementToken: 'destination-lifecycle' }
    destination.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'tutor', name: 'Destination tutor' }])
    destination.values.set(BackupStorageKey.CopilotMemoryTokens, [destinationToken])
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'conversation-lifecycle-import',
    })

    const restored = await readImportedSession(destination, session.id)
    const memory = memoryService(destination)
    for (const restoredSnapshot of [
      restored.settings?.sessionPromptContextSnapshot,
      restored.threads?.[0].sessionPromptContextSnapshot,
    ]) {
      expect(restoredSnapshot?.memoryCopilotLifecycleToken).toBe('source-lifecycle')
      const scope = await memory.getPausedCallMemoryScope(restoredSnapshot, 'tutor')
      await expect(memory.addMemoryForScope(scope, 'Unrelated fact')).resolves.toMatchObject({ ok: false })
    }
    expect(destination.values.get(BackupStorageKey.CopilotMemoryTokens)).toEqual([destinationToken])
  })

  it('preserves unaffected retirement records when importing legacy Copilot memory keys', async () => {
    const source = new MemoryStorage()
    source.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'tutor', name: 'Tutor' }])
    const archive = await createArchive(source, new MemoryMetaStorage(), ['copilot'])
    const destination = new MemoryStorage()
    const unrelated = { id: 'unrelated', token: 'unrelated-state', retirementToken: 'unrelated-lifecycle' }
    destination.values.set(BackupStorageKey.CopilotMemoryTokens, [unrelated])
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'legacy-lifecycle-import',
    })
    expect(parseCopilotMemoryStateTokens(destination.values.get(BackupStorageKey.CopilotMemoryTokens))).toContainEqual(
      unrelated
    )
  })

  it('rebases conversation and thread snapshots onto the destination Global Memory token', async () => {
    const frozenSnapshot = snapshot('source-global', 'Frozen source memory')
    const session: Session = {
      id: 'conversation-only',
      name: 'Conversation only',
      messages: [],
      settings: { sessionPromptContextSnapshot: frozenSnapshot },
      threads: [
        {
          id: 'thread-1',
          name: 'Earlier thread',
          messages: [],
          createdAt: 1,
          sessionPromptContextSnapshot: frozenSnapshot,
        },
      ],
    }
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session))

    const archive = await createArchive(source, sourceMeta, ['conversations'])
    const destination = new MemoryStorage()
    destination.values.set(BackupStorageKey.Settings, {
      memoryEnabled: true,
      memoryStateToken: 'destination-global',
    })
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'conversation-only-import',
    })

    const restored = await readImportedSession(destination, session.id)
    expect(restored.settings?.sessionPromptContextSnapshot).toEqual({
      ...frozenSnapshot,
      memoryStateToken: ':destination-global',
    })
    expect(restored.threads?.[0].sessionPromptContextSnapshot).toEqual({
      ...frozenSnapshot,
      memoryStateToken: ':destination-global',
    })
  })

  it('refreshes Global Memory and translates only matching snapshots in a settings and conversation restore', async () => {
    const currentSnapshot = snapshot(':source-global', 'Current source memory')
    const pendingSnapshot = snapshot(':source-stale', 'Pending source memory')
    const session: Session = {
      id: 'full-memory-state',
      name: 'Full memory state',
      messages: [],
      settings: { sessionPromptContextSnapshot: pendingSnapshot },
      threads: [
        {
          id: 'thread-1',
          name: 'Earlier thread',
          messages: [],
          createdAt: 1,
          sessionPromptContextSnapshot: currentSnapshot,
        },
      ],
    }
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(BackupStorageKey.Settings, { memoryEnabled: true, memoryStateToken: 'source-global' })
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session))

    const archive = await createArchive(source, sourceMeta, ['setting', 'conversations'])
    const destination = new MemoryStorage()
    await importBackupArchive(asBackupFile(archive), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
      createId: () => 'full-memory-import',
    })

    const restoredSettings = destination.values.get(BackupStorageKey.Settings) as Settings
    const restored = await readImportedSession(destination, session.id)
    expect(restoredSettings.memoryStateToken).toEqual(expect.any(String))
    expect(restoredSettings.memoryStateToken).not.toBe('source-global')
    expect(restored.settings?.sessionPromptContextSnapshot).toEqual(pendingSnapshot)
    expect(restored.threads?.[0].sessionPromptContextSnapshot).toEqual({
      ...currentSnapshot,
      memoryStateToken: `:${restoredSettings.memoryStateToken}`,
    })
  })
})
