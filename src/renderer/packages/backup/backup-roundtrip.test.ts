import type { CopilotDetail, Session, SessionMetaRecord, Settings } from '@shared/types'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesToBase64 } from './codec'
import { exportBackupArchive } from './export-backup'
import { importBackupArchive } from './import-backup'
import { BackupStorageKey, backupSessionStorageKey } from './storage-keys'
import type { BackupMetaStorage, BackupStorage } from './types'

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

class DelayedMemoryStorage extends MemoryStorage {
  override async setItemNow<T>(key: string, value: T): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1))
    await super.setItemNow(key, value)
  }

  override async setBlob(key: string, value: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1))
    await super.setBlob(key, value)
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

class FailOnceMetaStorage extends MemoryMetaStorage {
  private shouldFail = true

  override async update(id: string, updates: Partial<SessionMetaRecord>) {
    const result = await super.update(id, updates)
    if (this.shouldFail) {
      this.shouldFail = false
      throw new Error('Injected metadata write failure')
    }
    return result
  }
}

function createSession(id: string): Session {
  return {
    id,
    name: `Session ${id}`,
    messages: [
      {
        id: `message-${id}`,
        role: 'user',
        contentParts: [
          { type: 'text', text: 'look' },
          { type: 'image', storageKey: 'picture:shared' },
        ],
      },
    ],
  }
}

function createMeta(session: Session, sortOrder: number): SessionMetaRecord {
  return { id: session.id, name: session.name, sortOrder, createdAt: sortOrder }
}

function createAttachmentSession(id: string): Session {
  return {
    id,
    name: `Attachment ${id}`,
    messages: [
      {
        id: `message-${id}`,
        role: 'user',
        contentParts: [{ type: 'text', text: 'read this' }],
        files: [
          {
            id: `file-${id}`,
            name: 'report.pdf',
            fileType: 'application/pdf',
            storageKey: 'file:parsed',
            rawStorageKey: 'file:raw',
            localPath: '/Users/example/report.pdf',
            ragMode: 'session-retrieval',
            sessionAttachmentId: 99,
            sessionAttachmentIndexStatus: 'ready',
          },
        ],
      },
    ],
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

describe('ZIP backup round trip', () => {
  afterEach(() => vi.restoreAllMocks())

  it('restores independent sessions and shared resources, remapping conflicting blob keys', async () => {
    const nativeRandomUuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('Web Crypto randomUUID is unavailable')
    })
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    for (const [index, id] of ['one', 'two'].entries()) {
      const session = createSession(id)
      source.values.set(backupSessionStorageKey(id), session)
      sourceMeta.records.set(id, createMeta(session, index + 1))
    }
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')

    const chunks: Uint8Array[] = []
    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      exportedAt: new Date('2026-07-14T00:00:00.000Z'),
      storage: source,
      metaStorage: sourceMeta,
      application: { version: '1.22.0', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.sessions).toHaveLength(2)
    expect(exported.manifest.resources).toHaveLength(1)
    expect(exported.manifest.resources[0]).toMatchObject({ scope: 'shared', sessionIds: ['one', 'two'] })
    expect(new Set(exported.manifest.sessions.flatMap((session) => session.resourceIds))).toEqual(
      new Set([exported.manifest.resources[0].id])
    )

    const destination = new DelayedMemoryStorage()
    const destinationMeta = new MemoryMetaStorage()
    destination.blobs.set('picture:shared', 'data:image/png;base64,/w==')
    const archive = combine(chunks)
    const result = await importBackupArchive(
      new File([Uint8Array.from(archive).buffer], 'backup.zip', { type: 'application/zip' }),
      { storage: destination, metaStorage: destinationMeta }
    )

    expect(result.restoredSessionCount).toBe(2)
    expect(destination.blobs.get('picture:shared')).toBe('data:image/png;base64,/w==')
    const restoredOne = destination.values.get(backupSessionStorageKey('one')) as Session
    const restoredTwo = destination.values.get(backupSessionStorageKey('two')) as Session
    const restoredKey = restoredOne.messages[0].contentParts[1]
    expect(restoredKey).toMatchObject({ type: 'image' })
    if (restoredKey.type !== 'image') throw new Error('Expected an image part')
    expect(restoredKey.storageKey).not.toBe('picture:shared')
    expect(restoredTwo.messages[0].contentParts[1]).toMatchObject({ storageKey: restoredKey.storageKey })
    expect(destination.blobs.get(restoredKey.storageKey)).toBe('data:image/png;base64,AAECAw==')
    expect(destinationMeta.records.size).toBe(2)
    expect(nativeRandomUuid).not.toHaveBeenCalled()
  })

  it('rebases conversation-only snapshots without replacing frozen memories', async () => {
    const frozenSnapshot = {
      version: 1,
      soul: '',
      memories: [{ id: 'm1', content: 'Frozen source memory', createdAt: 1 }],
      memoryEnabled: true,
      memoryStateToken: 'source-global',
      workspaceInstructions: '',
      workspaceDirectories: [],
      capturedAt: 1,
      scope: 'chat' as const,
    }
    const session: Session = {
      id: 'memory-snapshot',
      name: 'Memory snapshot',
      messages: [{ id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] }],
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
    sourceMeta.records.set(session.id, createMeta(session, 1))
    const chunks: Uint8Array[] = []
    await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    const destination = new MemoryStorage()
    destination.values.set(BackupStorageKey.Settings, { memoryEnabled: true, memoryStateToken: 'destination-global' })
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'conversations.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })

    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    expect(restored.settings?.sessionPromptContextSnapshot).toEqual({
      ...frozenSnapshot,
      memoryStateToken: ':destination-global',
    })
    expect(restored.threads?.[0].sessionPromptContextSnapshot).toEqual({
      ...frozenSnapshot,
      memoryStateToken: ':destination-global',
    })
  })

  it('translates only current snapshots when settings and conversations are restored together', async () => {
    const currentSnapshot = {
      version: 1,
      soul: '',
      memories: [{ id: 'm1', content: 'Current source memory', createdAt: 1 }],
      memoryEnabled: true,
      memoryStateToken: ':source-global',
      workspaceInstructions: '',
      workspaceDirectories: [],
      capturedAt: 1,
      scope: 'chat' as const,
    }
    const pendingSnapshot = {
      ...currentSnapshot,
      memories: [{ id: 'm0', content: 'Pending source memory', createdAt: 0 }],
      memoryStateToken: ':source-stale',
    }
    const session: Session = {
      ...createSession('full-memory-state'),
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
    sourceMeta.records.set(session.id, createMeta(session, 1))
    const chunks: Uint8Array[] = []
    await exportBackupArchive({
      exportItems: ['setting', 'conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    const destination = new MemoryStorage()
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'full.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })

    const restoredSettings = destination.values.get(BackupStorageKey.Settings) as Settings
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    expect(restoredSettings.memoryStateToken).toEqual(expect.any(String))
    expect(restoredSettings.memoryStateToken).not.toBe('source-global')
    expect(restored.settings?.sessionPromptContextSnapshot).toEqual(pendingSnapshot)
    expect(restored.threads?.[0].sessionPromptContextSnapshot).toEqual({
      ...currentSnapshot,
      memoryStateToken: `:${restoredSettings.memoryStateToken}`,
    })
  })

  it('gives imported Global Memory settings a fresh token even when the source and destination tokens match', async () => {
    const source = new MemoryStorage()
    source.values.set(BackupStorageKey.Settings, { memoryEnabled: false, memoryStateToken: 'same-global' })
    const chunks: Uint8Array[] = []
    await exportBackupArchive({
      exportItems: ['setting'],
      includeKeys: false,
      storage: source,
      metaStorage: new MemoryMetaStorage(),
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    const existingSession: Session = {
      ...createSession('destination-global-session'),
      settings: {
        sessionPromptContextSnapshot: {
          version: 1,
          soul: '',
          memories: [],
          memoryEnabled: true,
          memoryStateToken: ':same-global',
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1,
        },
      },
    }
    const destination = new MemoryStorage()
    destination.values.set(BackupStorageKey.Settings, { memoryEnabled: true, memoryStateToken: 'same-global' })
    destination.values.set(backupSessionStorageKey(existingSession.id), existingSession)
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'settings.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })

    const restoredSettings = destination.values.get(BackupStorageKey.Settings) as Settings
    expect(restoredSettings.memoryStateToken).toEqual(expect.any(String))
    expect(restoredSettings.memoryStateToken).not.toBe('same-global')
    expect(destination.values.get(backupSessionStorageKey(existingSession.id))).toEqual(existingSession)
  })

  it('gives imported Copilot Memory state fresh tokens without rewriting destination conversations', async () => {
    const source = new MemoryStorage()
    source.values.set(BackupStorageKey.MyCopilots, [{ id: 'copilot-1', name: 'Copilot', prompt: 'Help' }])
    source.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'copilot-1', name: 'Copilot' }])
    source.values.set(BackupStorageKey.CopilotMemoryTokens, [{ id: 'copilot-1', token: 'same-copilot' }])
    const chunks: Uint8Array[] = []
    await exportBackupArchive({
      exportItems: ['copilot'],
      includeKeys: false,
      storage: source,
      metaStorage: new MemoryMetaStorage(),
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    const existingSession: Session = {
      ...createSession('destination-copilot-session'),
      copilotId: 'copilot-1',
      settings: {
        sessionPromptContextSnapshot: {
          version: 1,
          soul: '',
          memories: [],
          memoryCopilotId: 'copilot-1',
          memoryEnabled: true,
          memoryStateToken: 'same-copilot:',
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1,
        },
      },
    }
    const destination = new MemoryStorage()
    destination.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'copilot-1', name: 'Copilot' }])
    destination.values.set(BackupStorageKey.CopilotMemoryTokens, [{ id: 'copilot-1', token: 'same-copilot' }])
    destination.values.set(backupSessionStorageKey(existingSession.id), existingSession)
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'copilot.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })

    const restoredTokens = destination.values.get(BackupStorageKey.CopilotMemoryTokens) as Array<{
      id: string
      token: string
    }>
    expect(restoredTokens).toEqual([{ id: 'copilot-1', token: expect.any(String) }])
    expect(restoredTokens[0].token).not.toBe('same-copilot')
    expect(destination.values.get(backupSessionStorageKey(existingSession.id))).toEqual(existingSession)
  })

  it('round-trips global settings, copilots, and session settings while pruning unavailable images', async () => {
    const source = new MemoryStorage()
    const sourceSettings = {
      userAvatarKey: 'picture:missing',
      defaultAssistantAvatarKey: 'picture:kept',
      licenseKey: 'secret-license',
      providers: { custom: { apiKey: 'secret-api-key', apiHost: 'https://example.com' } },
    } as unknown as Settings
    const copilots: CopilotDetail[] = [
      {
        id: 'copilot-1',
        name: 'Copilot',
        prompt: 'Help',
        avatar: { type: 'storage-key', storageKey: 'picture:missing' },
        backgroundImage: { type: 'storage-key', storageKey: 'picture:kept' },
      },
    ]
    source.values.set(BackupStorageKey.Settings, sourceSettings)
    source.values.set(BackupStorageKey.MyCopilots, copilots)
    source.values.set(BackupStorageKey.ChatSessionSettings, { model: 'model-a' })
    source.values.set(BackupStorageKey.PictureSessionSettings, { model: 'model-b' })
    source.values.set(BackupStorageKey.AgentSoul, {
      content: '# Soul\n\nDirect and concise.',
      updatedAt: 1700000000000,
    })
    source.values.set(BackupStorageKey.AgentMemories, [
      { id: 'm1', content: 'User prefers pnpm', createdAt: 1700000000000 },
    ])
    source.values.set(BackupStorageKey.CopilotMemories, {
      'copilot-1': [{ id: 'cm1', content: 'Use short lessons', createdAt: 1700000000000 }],
    })
    source.values.set(BackupStorageKey.CopilotMemoryOwners, [{ id: 'copilot-1', name: 'Copilot' }])
    source.values.set(BackupStorageKey.CopilotMemoryTokens, [{ id: 'copilot-1', token: 'source-copilot' }])
    source.blobs.set('picture:kept', 'data:image/png;base64,AAECAw==')
    const chunks: Uint8Array[] = []

    const exported = await exportBackupArchive({
      exportItems: ['setting', 'conversations', 'copilot'],
      includeKeys: false,
      storage: source,
      metaStorage: new MemoryMetaStorage(),
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.warnings).toContainEqual(
      expect.objectContaining({ code: 'resource-read-failed', itemId: 'picture:missing' })
    )

    const destination = new MemoryStorage()
    const imported = await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'global.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })
    expect(imported.warnings).toHaveLength(1)
    expect(destination.values.get(BackupStorageKey.Settings)).toEqual({
      defaultAssistantAvatarKey: 'picture:kept',
      providers: { custom: { apiHost: 'https://example.com' } },
      memoryStateToken: expect.any(String),
    })
    expect(destination.values.get(BackupStorageKey.MyCopilots)).toEqual([
      {
        id: 'copilot-1',
        name: 'Copilot',
        prompt: 'Help',
        backgroundImage: { type: 'storage-key', storageKey: 'picture:kept' },
      },
    ])
    expect(destination.values.get(BackupStorageKey.ChatSessionSettings)).toEqual({ model: 'model-a' })
    expect(destination.values.get(BackupStorageKey.PictureSessionSettings)).toEqual({ model: 'model-b' })
    expect(destination.values.get(BackupStorageKey.AgentSoul)).toEqual({
      content: '# Soul\n\nDirect and concise.',
      updatedAt: 1700000000000,
    })
    expect(destination.values.get(BackupStorageKey.AgentMemories)).toEqual([
      { id: 'm1', content: 'User prefers pnpm', createdAt: 1700000000000 },
    ])
    expect(destination.values.get(BackupStorageKey.CopilotMemories)).toEqual({
      'copilot-1': [{ id: 'cm1', content: 'Use short lessons', createdAt: 1700000000000 }],
    })
    expect(destination.values.get(BackupStorageKey.CopilotMemoryOwners)).toEqual([{ id: 'copilot-1', name: 'Copilot' }])
    const restoredCopilotTokens = destination.values.get(BackupStorageKey.CopilotMemoryTokens)
    expect(restoredCopilotTokens).toEqual([{ id: 'copilot-1', token: expect.any(String) }])
    expect(restoredCopilotTokens).not.toEqual([{ id: 'copilot-1', token: 'source-copilot' }])
    expect(destination.blobs.get('picture:kept')).toBe('data:image/png;base64,AAECAw==')
  })

  it('round-trips parsed and raw attachments while dropping non-portable metadata', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createAttachmentSession('files')
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    source.blobs.set('file:parsed', 'parsed report')
    source.blobs.set('file:raw', 'data:application/pdf;base64,JVBERi0xLjQ=')
    const chunks: Uint8Array[] = []
    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    expect(exported.manifest.sessions[0].path).toBe('sessions/files/session.json')
    expect(exported.manifest.resources).toHaveLength(2)
    expect(new Set(exported.manifest.resources.map((resource) => resource.kind))).toEqual(
      new Set(['parsed-attachment', 'raw-attachment'])
    )

    const destination = new DelayedMemoryStorage()
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'backup.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    const restoredFile = restored.messages[0].files?.[0]
    expect(restoredFile?.localPath).toBeUndefined()
    expect(restoredFile?.sessionAttachmentId).toBeUndefined()
    expect(restoredFile?.sessionAttachmentIndexStatus).toBeUndefined()
    expect(destination.blobs.get(restoredFile?.storageKey ?? '')).toBe('parsed report')
    expect(destination.blobs.get(restoredFile?.rawStorageKey ?? '')).toBe('data:application/pdf;base64,JVBERi0xLjQ=')
  })

  it('round-trips DOCX, PPTX, and XLSX attachments without parsing their nested ZIP entries', async () => {
    const attachments = [
      {
        extension: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        innerDirectory: 'word/media/',
      },
      {
        extension: 'pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        innerDirectory: 'ppt/media/',
      },
      {
        extension: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        innerDirectory: 'xl/media/',
      },
    ]
    const session: Session = {
      id: 'office-files',
      name: 'Office files',
      messages: [
        {
          id: 'message-office-files',
          role: 'user',
          contentParts: [{ type: 'text', text: 'read these' }],
          files: attachments.map(({ extension, mimeType }) => ({
            id: `file-${extension}`,
            name: `report.${extension}`,
            fileType: mimeType,
            storageKey: `file:${extension}:parsed`,
            rawStorageKey: `file:${extension}:raw`,
          })),
        },
      ],
    }
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    const expectedRawValues = new Map<string, string>()
    for (const { extension, mimeType, innerDirectory } of attachments) {
      source.blobs.set(`file:${extension}:parsed`, `parsed ${extension}`)
      const officeDocument = zipSync({
        '[Content_Types].xml': new TextEncoder().encode('<Types />'),
        [innerDirectory]: new Uint8Array(),
        [`${innerDirectory}image1.png`]: new Uint8Array([0, 1, 2, 3]),
      })
      const rawValue = `data:${mimeType};base64,${bytesToBase64(officeDocument)}`
      source.blobs.set(`file:${extension}:raw`, rawValue)
      expectedRawValues.set(extension, rawValue)
    }
    const chunks: Uint8Array[] = []
    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    expect(
      exported.manifest.resources
        .filter((resource) => resource.kind === 'raw-attachment')
        .map((resource) => resource.path)
    ).toEqual(
      expect.arrayContaining(attachments.map(({ extension }) => expect.stringMatching(new RegExp(`\\.${extension}$`))))
    )

    const destination = new MemoryStorage()
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'backup.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    for (const file of restored.messages[0].files ?? []) {
      const extension = file.name.split('.').pop() ?? ''
      expect(destination.blobs.get(file.rawStorageKey ?? '')).toBe(expectedRawValues.get(extension))
    }
  })

  it('round-trips highly compressible sessions and long URL-based storage keys', async () => {
    const storageKey = `link:https://example.com/?payload=${'a'.repeat(20_000)}`
    const sessionId = `session-${'s'.repeat(5_000)}`
    const session: Session = {
      id: sessionId,
      name: 'Compressible session',
      messages: [
        {
          id: 'compressible-message',
          role: 'user',
          contentParts: [{ type: 'text', text: 'a'.repeat(2 * 1024 * 1024) }],
          links: [{ id: 'long-link', url: 'https://example.com', title: 'Long link', storageKey }],
        },
      ],
    }
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    source.blobs.set(storageKey, 'parsed link')
    const chunks: Uint8Array[] = []

    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    expect(exported.manifest.sessions[0].path.length).toBeLessThan(200)
    expect(exported.manifest.resources[0].path.length).toBeLessThan(200)

    const destination = new MemoryStorage()
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'backup.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    expect(restored.messages[0].contentParts[0]).toEqual({ type: 'text', text: 'a'.repeat(2 * 1024 * 1024) })
    expect(restored.messages[0].links?.[0].storageKey).toBe(storageKey)
    expect(destination.blobs.get(storageKey)).toBe('parsed link')
  })

  it('deduplicates identical resource content and preserves the resource graph', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const one = createSession('dedupe-one')
    const two = createSession('dedupe-two')
    const secondImage = two.messages[0].contentParts[1]
    if (secondImage.type !== 'image') throw new Error('Expected an image part')
    secondImage.storageKey = 'picture:copy'
    for (const [index, session] of [one, two].entries()) {
      source.values.set(backupSessionStorageKey(session.id), session)
      sourceMeta.records.set(session.id, createMeta(session, index + 1))
    }
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')
    source.blobs.set('picture:copy', 'data:image/png;base64,AAECAw==')

    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const _chunk of dataCallback()) {
          // Consume the stream so the manifest is finalized.
        }
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.resources).toHaveLength(1)
    expect(exported.manifest.resources[0]).toMatchObject({
      scope: 'shared',
      originalStorageKeys: ['picture:shared', 'picture:copy'],
      sessionIds: ['dedupe-one', 'dedupe-two'],
    })
    expect(exported.manifest.stats.deduplicatedResourceCount).toBe(1)
    expect(exported.manifest.sessions.every((entry) => entry.resourceIds.length === 1)).toBe(true)
  })

  it('imports the available data and removes references to managed resources that could not be exported', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createSession('missing')
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    const chunks: Uint8Array[] = []
    const result = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    expect(result.manifest.warnings).toContainEqual(
      expect.objectContaining({ code: 'resource-read-failed', itemId: 'picture:shared' })
    )
    const destination = new MemoryStorage()
    const imported = await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'incomplete.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })
    expect(imported.warnings).toContainEqual(
      expect.objectContaining({ code: 'resource-read-failed', itemId: 'picture:shared' })
    )
    expect(imported.restoredSessionCount).toBe(1)
    expect(destination.values.get(backupSessionStorageKey(session.id))).toMatchObject({
      messages: [{ contentParts: [{ type: 'text', text: 'look' }] }],
    })
  })

  it('preserves legacy message content when a ZIP v2 session has no contentParts', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = {
      id: 'legacy-content',
      name: 'Legacy content',
      messages: [{ id: 'legacy-message', role: 'user', content: 'keep legacy content' }],
    } as unknown as Session
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    const chunks: Uint8Array[] = []

    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.formatVersion).toBe(2)

    const destination = new MemoryStorage()
    await expect(
      importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'legacy-content.zip'), {
        storage: destination,
        metaStorage: new MemoryMetaStorage(),
      })
    ).resolves.toMatchObject({ restoredSessionCount: 1 })
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session & {
      messages: Array<Session['messages'][number] & { content?: string }>
    }
    expect(restored.messages[0].content).toBe('keep legacy content')
    expect(restored.messages[0].contentParts).toEqual([])
  })

  it('does not count unreadable resource payloads as deduplicated exports', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createSession('invalid-resource')
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    source.blobs.set('picture:shared', 'data:image/png;base64,%%%')

    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const _chunk of dataCallback()) {
          // Consume the stream so resource warnings and stats are finalized.
        }
        return { boundedMemory: true }
      },
    })

    expect(exported.manifest.resources).toEqual([])
    expect(exported.manifest.stats.deduplicatedResourceCount).toBe(0)
    expect(exported.manifest.warnings).toContainEqual(
      expect.objectContaining({ code: 'resource-read-failed', itemId: 'picture:shared' })
    )
  })

  it('removes undeclared empty resource references even when the export did not emit a warning', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session: Session = {
      id: 'empty-resource-keys',
      name: 'Empty resource keys',
      messages: [
        {
          id: 'empty-resource-message',
          role: 'user',
          contentParts: [
            { type: 'text', text: 'keep me' },
            { type: 'image', storageKey: '' },
          ],
          files: [{ id: 'empty-file', name: 'missing.pdf', fileType: 'application/pdf', storageKey: '' }],
          links: [{ id: 'empty-link', url: 'https://example.com', title: 'Example', storageKey: '' }],
        },
      ],
    }
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    const chunks: Uint8Array[] = []
    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    expect(exported.manifest.warnings).toEqual([])
    expect(exported.manifest.resources).toEqual([])

    const destination = new MemoryStorage()
    await importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'empty-keys.zip'), {
      storage: destination,
      metaStorage: new MemoryMetaStorage(),
    })
    const restored = destination.values.get(backupSessionStorageKey(session.id)) as Session
    expect(restored.messages[0].contentParts).toEqual([{ type: 'text', text: 'keep me' }])
    expect(restored.messages[0].files?.[0].storageKey).toBeUndefined()
    expect(restored.messages[0].links?.[0].storageKey).toBeUndefined()
  })

  it('validates the generated manifest before reporting export success', async () => {
    const source = new MemoryStorage()
    source.values.set(BackupStorageKey.ConfigVersion, -1)

    await expect(
      exportBackupArchive({
        exportItems: [],
        includeKeys: false,
        storage: source,
        metaStorage: new MemoryMetaStorage(),
        application: { version: 'test', platform: 'test' },
        writeArchive: async (dataCallback) => {
          for await (const _chunk of dataCallback()) {
            // Consume the stream so final manifest validation runs.
          }
          return { boundedMemory: true }
        },
      })
    ).rejects.toThrow()
  })

  it('ignores null orphan session slots that do not have session metadata', async () => {
    const source = new MemoryStorage()
    source.values.set(backupSessionStorageKey('new'), null)
    const result = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: new MemoryMetaStorage(),
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const _chunk of dataCallback()) {
          // Consume the stream so the manifest is finalized.
        }
        return { boundedMemory: true }
      },
    })

    expect(result.manifest.sessions).toEqual([])
    expect(result.manifest.warnings).toEqual([])
  })

  it('skips a corrupt session slot whose embedded id does not match its storage key', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createSession('embedded-id')
    source.values.set(backupSessionStorageKey('storage-id'), session)
    sourceMeta.records.set('storage-id', { ...createMeta(session, 1), id: 'storage-id' })
    const chunks: Uint8Array[] = []

    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    expect(exported.manifest.sessions).toEqual([])
    expect(exported.manifest.warnings).toContainEqual(
      expect.objectContaining({ code: 'session-read-failed', itemId: 'storage-id' })
    )
    const imported = await importBackupArchive(
      new File([Uint8Array.from(combine(chunks)).buffer], 'corrupt-slot.zip'),
      {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
      }
    )
    expect(imported.restoredSessionCount).toBe(0)
    expect(imported.warnings).toHaveLength(1)
  })

  it('does not export resource references from a session that fails after resource collection', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const invalidId = 'invalid-\ud800-session'
    const session = createSession(invalidId)
    source.values.set(backupSessionStorageKey(invalidId), session)
    sourceMeta.records.set(invalidId, createMeta(session, 1))
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')
    const chunks: Uint8Array[] = []

    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    expect(exported.manifest.sessions).toEqual([])
    expect(exported.manifest.resources).toEqual([])
    expect(exported.manifest.warnings).toContainEqual(
      expect.objectContaining({ code: 'session-read-failed', itemId: invalidId })
    )
    await expect(
      importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'failed-session.zip'), {
        storage: new MemoryStorage(),
        metaStorage: new MemoryMetaStorage(),
      })
    ).resolves.toMatchObject({ restoredSessionCount: 0, restoredResourceCount: 0 })
  })

  it('rejects a resource checksum mismatch before changing destination data', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createSession('checksum')
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')
    const chunks: Uint8Array[] = []
    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    const entries = unzipSync(combine(chunks))
    entries[exported.manifest.resources[0].path] = new Uint8Array([4, 3, 2, 1])

    const destination = new MemoryStorage()
    const destinationMeta = new MemoryMetaStorage()
    await expect(
      importBackupArchive(
        new File([Uint8Array.from(zipSync(entries)).buffer], 'tampered.zip', { type: 'application/zip' }),
        { storage: destination, metaStorage: destinationMeta }
      )
    ).rejects.toThrow('checksum mismatch')
    expect(destination.values.has(backupSessionStorageKey(session.id))).toBe(false)
    expect(destinationMeta.records.size).toBe(0)
  })

  it('rejects a manifest with a missing resource entry', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createSession('missing-entry')
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')
    const chunks: Uint8Array[] = []
    const exported = await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    const entries = unzipSync(combine(chunks))
    delete entries[exported.manifest.resources[0].path]
    await expect(
      importBackupArchive(
        new File([Uint8Array.from(zipSync(entries)).buffer], 'missing.zip', { type: 'application/zip' }),
        { storage: new MemoryStorage(), metaStorage: new MemoryMetaStorage() }
      )
    ).rejects.toThrow('entry is missing')
  })

  it('rolls back sessions, metadata, resources, and temporary staging after a commit failure', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const importedSession = createSession('rollback')
    source.values.set(backupSessionStorageKey(importedSession.id), importedSession)
    sourceMeta.records.set(importedSession.id, createMeta(importedSession, 2))
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')
    const chunks: Uint8Array[] = []
    await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    const destination = new MemoryStorage()
    const destinationMeta = new FailOnceMetaStorage()
    const previousSession: Session = { id: 'rollback', name: 'Previous', messages: [] }
    const previousMeta = createMeta(previousSession, 1)
    const rollbackRehydration = vi.fn(() => Promise.resolve())
    destination.values.set(backupSessionStorageKey(previousSession.id), previousSession)
    destinationMeta.records.set(previousSession.id, previousMeta)

    await expect(
      importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'rollback.zip'), {
        storage: destination,
        metaStorage: destinationMeta,
        rehydrateSession: (session) => Promise.resolve({ session, warnings: [], rollback: rollbackRehydration }),
      })
    ).rejects.toThrow('Injected metadata write failure')
    expect(destination.values.get(backupSessionStorageKey(previousSession.id))).toEqual(previousSession)
    expect(destinationMeta.records.get(previousSession.id)).toEqual(previousMeta)
    expect(destination.blobs.has('picture:shared')).toBe(false)
    expect(Array.from(destination.values.keys()).some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
    expect(Array.from(destination.blobs.keys()).some((key) => key.startsWith('__chatbox_backup_import:'))).toBe(false)
    expect(rollbackRehydration).toHaveBeenCalledOnce()
  })

  it('cleans staged and newly written data when import is canceled during commit', async () => {
    const source = new MemoryStorage()
    const sourceMeta = new MemoryMetaStorage()
    const session = createSession('cancel')
    source.values.set(backupSessionStorageKey(session.id), session)
    sourceMeta.records.set(session.id, createMeta(session, 1))
    source.blobs.set('picture:shared', 'data:image/png;base64,AAECAw==')
    const chunks: Uint8Array[] = []
    await exportBackupArchive({
      exportItems: ['conversations'],
      includeKeys: false,
      storage: source,
      metaStorage: sourceMeta,
      application: { version: 'test', platform: 'test' },
      writeArchive: async (dataCallback) => {
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })

    const destination = new MemoryStorage()
    const destinationMeta = new MemoryMetaStorage()
    const abortController = new AbortController()
    await expect(
      importBackupArchive(new File([Uint8Array.from(combine(chunks)).buffer], 'cancel.zip'), {
        storage: destination,
        metaStorage: destinationMeta,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (progress.phase === 'restoring' && progress.current === 1) {
            abortController.abort(new DOMException('Canceled by test', 'AbortError'))
          }
        },
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(destination.values.has(backupSessionStorageKey(session.id))).toBe(false)
    expect(destinationMeta.records.size).toBe(0)
    expect(destination.blobs.size).toBe(0)
  })
})
