import type { Session, SessionMetaRecord } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { describe, expect, it, vi } from 'vitest'
import { createSyncSnapshot, mergeRemoteSnapshot, sessionHasActiveGeneration } from './snapshot'
import type { SyncSnapshot } from './types'

function session(id: string, name: string, text: string, type: Session['type'] = 'chat'): Session {
  return {
    id,
    type,
    name,
    messages: [
      {
        id: `${id}-m1`,
        role: 'user',
        contentParts: [{ type: 'text', text }],
      },
    ],
  }
}

function legacySession(id: string, name: string, text: string): Session {
  const value = session(id, name, text)
  delete value.type
  return value
}

function meta(id: string, name: string, sortOrder = 1, type: SessionMetaRecord['type'] = 'chat'): SessionMetaRecord {
  return {
    id,
    name,
    type,
    sortOrder,
    createdAt: sortOrder,
  }
}

function legacyMeta(id: string, name: string, sortOrder = 1): SessionMetaRecord {
  const value = meta(id, name, sortOrder)
  delete value.type
  return value
}

describe('sync snapshot merge', () => {
  it('creates snapshots from only chat and legacy sessions with matching chat metas', () => {
    const snapshot = createSyncSnapshot({
      sessions: [
        session('chat-1', 'Chat', 'hello'),
        legacySession('legacy-1', 'Legacy', 'hello'),
        session('picture-1', 'Picture', 'image prompt', 'picture'),
        session('guide-1', 'Guide', 'setup', 'guide'),
      ],
      metas: [
        meta('chat-1', 'Chat'),
        legacyMeta('legacy-1', 'Legacy'),
        meta('picture-1', 'Picture', 1, 'picture'),
        meta('guide-1', 'Guide', 1, 'guide'),
        meta('orphan-1', 'Orphan'),
      ],
      deviceName: 'Mac',
      exportedAt: '2026-06-21T00:00:00.000Z',
    })

    expect(snapshot.sessions.map((item) => item.id)).toEqual(['chat-1', 'legacy-1'])
    expect(snapshot.metas.map((item) => item.id)).toEqual(['chat-1', 'legacy-1'])
  })

  it('strips local-only blob references when creating snapshots', () => {
    const local = session('chat-1', 'Chat', 'hello')
    local.assistantAvatarKey = 'avatar-key'
    local.backgroundImage = { type: 'storage-key', storageKey: 'background-key' }
    local.messages[0].contentParts.push({ type: 'image', storageKey: 'image-key' })
    local.messages[0].cancel = vi.fn()
    local.messages[0].generating = true
    local.messages[0].tokenCountMap = { default: 10 }
    local.messages[0].tokenCalculatedAt = { default: 1000 }
    local.messages[0].wordCount = 1
    local.messages[0].tokenCount = 2
    local.messages[0].status = [{ type: 'retrying', attempt: 1, maxAttempts: 3 }]
    local.messages[0].isStreamingMode = true
    local.messages[0].files = [
      {
        id: 'file:/tmp/doc.txt-123-456',
        name: 'doc.txt',
        fileType: 'text/plain',
        storageKey: 'file:/tmp/doc.txt-123-456',
        localPath: '/tmp/doc.txt',
        ragMode: 'session-retrieval',
        sessionAttachmentId: 12,
        sessionAttachmentAvailability: 'allowed',
        tokenCountMap: { default: 10 },
        lineCount: 5,
        byteLength: 123,
      },
      {
        id: 'custom-file-id',
        name: 'custom.txt',
        fileType: 'text/plain',
        storageKey: 'file:/tmp/custom.txt-789-123',
      },
    ]
    local.messages[0].links = [
      {
        id: 'link-1',
        title: 'Example',
        url: 'https://example.com',
        storageKey: 'link-key',
        tokenCountMap: { default: 20 },
        lineCount: 10,
        byteLength: 456,
      },
    ]
    ;(local.messages[0] as unknown as { pictures: Array<{ storageKey: string }> }).pictures = [
      { storageKey: 'legacy-picture-key' },
    ]
    local.threads = [
      {
        id: 'thread-1',
        name: 'Thread',
        createdAt: 1,
        messages: [
          {
            id: 'thread-message-1',
            role: 'user',
            generating: true,
            status: [{ type: 'loading_webpage' }],
            isStreamingMode: true,
            contentParts: [{ type: 'image', storageKey: 'thread-image-key' }],
          },
        ],
      },
    ]
    local.messageForksHash = {
      fork: {
        position: 0,
        createdAt: 1,
        lists: [
          {
            id: 'fork-list',
            messages: [
              {
                id: 'fork-message-1',
                role: 'user',
                generating: true,
                status: [{ type: 'sending_file' }],
                isStreamingMode: true,
                contentParts: [{ type: 'image', storageKey: 'fork-image-key' }],
              },
            ],
          },
        ],
      },
    }

    const snapshot = createSyncSnapshot({
      sessions: [local],
      metas: [
        {
          ...meta('chat-1', 'Chat'),
          assistantAvatarKey: 'avatar-key',
          backgroundImage: { type: 'storage-key', storageKey: 'background-key' },
        },
      ],
      deviceName: 'Mac',
      exportedAt: '2026-06-21T00:00:00.000Z',
    })
    const synced = snapshot.sessions[0]
    const message = synced.messages[0]

    expect(synced.assistantAvatarKey).toBeUndefined()
    expect(synced.backgroundImage).toBeUndefined()
    expect(message.contentParts).toEqual([{ type: 'text', text: 'hello' }])
    expect(message.files).toEqual([
      { id: 'synced-file:0:doc.txt', name: 'doc.txt', fileType: 'text/plain' },
      { id: 'custom-file-id', name: 'custom.txt', fileType: 'text/plain' },
    ])
    expect(message.links).toEqual([{ id: 'link-1', title: 'Example', url: 'https://example.com' }])
    expect(message).not.toHaveProperty('pictures')
    expect(message).not.toHaveProperty('cancel')
    expect(message).not.toHaveProperty('generating')
    expect(message).not.toHaveProperty('tokenCountMap')
    expect(message).not.toHaveProperty('tokenCalculatedAt')
    expect(message).not.toHaveProperty('wordCount')
    expect(message).not.toHaveProperty('tokenCount')
    expect(message).not.toHaveProperty('status')
    expect(message).not.toHaveProperty('isStreamingMode')
    expect(synced.threads?.[0].messages[0].contentParts).toEqual([])
    expect(synced.messageForksHash?.fork.lists[0].messages[0].contentParts).toEqual([])
    expect(synced.threads?.[0].messages[0]).not.toHaveProperty('generating')
    expect(synced.threads?.[0].messages[0]).not.toHaveProperty('status')
    expect(synced.threads?.[0].messages[0]).not.toHaveProperty('isStreamingMode')
    expect(synced.messageForksHash?.fork.lists[0].messages[0]).not.toHaveProperty('generating')
    expect(synced.messageForksHash?.fork.lists[0].messages[0]).not.toHaveProperty('status')
    expect(synced.messageForksHash?.fork.lists[0].messages[0]).not.toHaveProperty('isStreamingMode')
    expect(snapshot.metas[0].assistantAvatarKey).toBeUndefined()
    expect(snapshot.metas[0].backgroundImage).toBeUndefined()
  })

  it('detects active generation in main messages, threads, and forks', () => {
    const main = session('main', 'Main', 'hello')
    main.messages[0].generating = true

    const thread = session('thread', 'Thread', 'hello')
    thread.threads = [
      {
        id: 'thread-1',
        name: 'Thread',
        createdAt: 1,
        messages: [{ ...thread.messages[0], generating: true }],
      },
    ]

    const fork = session('fork', 'Fork', 'hello')
    fork.messageForksHash = {
      fork: {
        position: 0,
        createdAt: 1,
        lists: [{ id: 'fork-list', messages: [{ ...fork.messages[0], generating: true }] }],
      },
    }

    expect(sessionHasActiveGeneration(session('idle', 'Idle', 'hello'))).toBe(false)
    expect(sessionHasActiveGeneration(main)).toBe(true)
    expect(sessionHasActiveGeneration(thread)).toBe(true)
    expect(sessionHasActiveGeneration(fork)).toBe(true)
  })

  it('imports missing remote sessions and metadata', () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Mac',
      sessions: [session('remote-1', 'Remote', 'hello')],
      metas: [meta('remote-1', 'Remote')],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [],
      localMetas: [],
      remote,
      now: 1000,
    })

    expect(result.sessionChanges).toEqual([
      expect.objectContaining({ kind: 'create', session: expect.objectContaining({ id: 'remote-1' }) }),
    ])
    expect(result.metasToSave.map((m) => m.id)).toEqual(['remote-1'])
    expect(result.imported).toBe(1)
    expect(result.conflicts).toBe(0)
  })

  it('ignores device-local message token cache differences', () => {
    const local = session('same-id', 'Project', 'same text')
    const remoteSession = session('same-id', 'Project', 'same text')
    remoteSession.messages[0].tokenCountMap = { default: 2 }
    remoteSession.messages[0].tokenCalculatedAt = { default: 1234 }
    remoteSession.messages[0].wordCount = 2
    remoteSession.messages[0].tokenCount = 3

    const result = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project')],
      remote: {
        version: 1,
        exportedAt: '2026-07-23T00:00:00.000Z',
        deviceName: 'Device B',
        sessions: [remoteSession],
        metas: [meta('same-id', 'Project')],
      },
      now: 2000,
    })

    expect(result.sessionChanges).toEqual([])
    expect(result.metasToSave).toEqual([])
    expect(result.conflicts).toBe(0)
  })

  it('strips local-only blob references when importing remote sessions', () => {
    const remoteSession = session('remote-1', 'Remote', 'hello')
    remoteSession.assistantAvatarKey = 'avatar-key'
    remoteSession.messages[0].cancel = vi.fn()
    remoteSession.messages[0].generating = true
    remoteSession.messages[0].status = [{ type: 'loading_webpage' }]
    remoteSession.messages[0].isStreamingMode = true
    remoteSession.messages[0].contentParts.push({ type: 'image', storageKey: 'image-key' })
    remoteSession.messages[0].files = [
      {
        id: 'file:/tmp/doc.txt-123-456',
        name: 'doc.txt',
        fileType: 'text/plain',
        storageKey: 'file:/tmp/doc.txt-123-456',
        localPath: '/tmp/doc.txt',
      },
    ]
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteSession],
      metas: [
        {
          ...meta('remote-1', 'Remote'),
          assistantAvatarKey: 'avatar-key',
          backgroundImage: { type: 'storage-key', storageKey: 'background-key' },
        },
      ],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [],
      localMetas: [],
      remote,
      now: 1000,
    })

    const created = result.sessionChanges[0]
    expect(created.kind).toBe('create')
    if (created.kind !== 'create') throw new Error('Expected a created session')
    expect(created.session.assistantAvatarKey).toBeUndefined()
    expect(created.session.messages[0].contentParts).toEqual([{ type: 'text', text: 'hello' }])
    expect(created.session.messages[0]).not.toHaveProperty('cancel')
    expect(created.session.messages[0]).not.toHaveProperty('generating')
    expect(created.session.messages[0]).not.toHaveProperty('status')
    expect(created.session.messages[0]).not.toHaveProperty('isStreamingMode')
    expect(created.session.messages[0].files).toEqual([
      { id: 'synced-file:0:doc.txt', name: 'doc.txt', fileType: 'text/plain' },
    ])
    expect(result.metasToSave[0].assistantAvatarKey).toBeUndefined()
    expect(result.metasToSave[0].backgroundImage).toBeUndefined()
  })

  it('ignores non-chat remote sessions and repairs non-chat metas for imported chat sessions', () => {
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [
        session('chat-1', 'Chat', 'hello'),
        legacySession('legacy-1', 'Legacy', 'hello'),
        session('picture-1', 'Picture', 'image prompt', 'picture'),
        session('guide-1', 'Guide', 'setup', 'guide'),
      ],
      metas: [
        meta('chat-1', 'Wrong type meta', 5, 'picture'),
        legacyMeta('legacy-1', 'Legacy', 4),
        meta('picture-1', 'Picture', 3, 'picture'),
        meta('guide-1', 'Guide', 2, 'guide'),
      ],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [],
      localMetas: [],
      remote,
      now: 1000,
    })

    expect(
      result.sessionChanges.filter((change) => change.kind === 'create').map((change) => change.session.id)
    ).toEqual(['chat-1', 'legacy-1'])
    expect(result.metasToSave.map((item) => [item.id, item.type])).toEqual([
      ['chat-1', 'chat'],
      ['legacy-1', undefined],
    ])
  })

  it('preserves local data by importing changed remote sessions as synced copies', () => {
    const local = session('same-id', 'Project', 'local text')
    const remoteSession = session('same-id', 'Project', 'remote text')
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteSession],
      metas: [meta('same-id', 'Project')],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project')],
      remote,
      now: 2000,
      createConflictId: () => 'copy-id',
    })

    expect(result.sessionChanges).toHaveLength(1)
    expect(result.sessionChanges[0]).toEqual(
      expect.objectContaining({
        kind: 'create',
        session: expect.objectContaining({ id: 'copy-id', name: 'Project (Synced copy)' }),
      })
    )
    expect(result.metasToSave[0]).toMatchObject({
      id: 'copy-id',
      name: 'Project (Synced copy)',
      sortOrder: 2000,
      createdAt: 2000,
    })
    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(1)
  })

  it('does not create another copy when the same conflict is merged again', () => {
    const local = session('same-id', 'Project', 'local text')
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('same-id', 'Project', 'remote text')],
      metas: [meta('same-id', 'Project')],
    }
    const createConflictId = () => 'stable-copy-id'
    const first = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project')],
      remote,
      now: 2000,
      createConflictId,
      preferRemoteMetadata: true,
    })
    const created = first.sessionChanges[0]
    if (created.kind !== 'create') throw new Error('Expected a created conflict copy')

    const second = mergeRemoteSnapshot({
      localSessions: [local, created.session],
      localMetas: [meta('same-id', 'Project'), first.metasToSave[0]],
      remote,
      now: 3000,
      createConflictId,
      preferRemoteMetadata: true,
    })

    expect(second.sessionChanges).toEqual([])
    expect(second.metasToSave).toEqual([])
    expect(second.conflicts).toBe(0)
  })

  it('deduplicates a source conflict when the remote snapshot already contains its stable copy', () => {
    const local = session('same-id', 'Project', 'local text')
    const remoteSource = session('same-id', 'Project', 'remote text')
    const sourceSnapshot: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteSource],
      metas: [meta('same-id', 'Project')],
    }
    const initial = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project')],
      remote: sourceSnapshot,
      now: 2000,
    })
    const stableCopy = initial.sessionChanges[0]
    if (stableCopy.kind !== 'create') throw new Error('Expected a created conflict copy')
    const remoteWithCopy: SyncSnapshot = {
      ...sourceSnapshot,
      sessions: [remoteSource, stableCopy.session],
      metas: [sourceSnapshot.metas[0], initial.metasToSave[0]],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project')],
      remote: remoteWithCopy,
      now: 2000,
    })

    expect(result.sessionChanges).toHaveLength(1)
    expect(result.sessionChanges[0]).toEqual(
      expect.objectContaining({
        kind: 'create',
        session: expect.objectContaining({ id: stableCopy.session.id }),
      })
    )
    expect(result.metasToSave).toHaveLength(1)
    expect(result.conflicts).toBe(1)
  })

  it('does not import a remote conflict copy already owned by its local source session', () => {
    const deviceA = session('same-id', 'Project', 'device A text')
    const deviceB = session('same-id', 'Project', 'device B text')
    const deviceBCopyResult = mergeRemoteSnapshot({
      localSessions: [deviceA],
      localMetas: [meta('same-id', 'Project')],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:00:00.000Z',
        deviceName: 'Device B',
        sessions: [deviceB],
        metas: [meta('same-id', 'Project')],
      },
      now: 2000,
    })
    const deviceBCopy = deviceBCopyResult.sessionChanges[0]
    if (deviceBCopy.kind !== 'create') throw new Error('Expected a Device B conflict copy')
    expect(deviceBCopy.session.syncConflictSourceId).toBe('same-id')

    const result = mergeRemoteSnapshot({
      localSessions: [deviceB],
      localMetas: [meta('same-id', 'Project')],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:01:00.000Z',
        deviceName: 'Device A',
        sessions: [deviceA, deviceBCopy.session],
        metas: [meta('same-id', 'Project'), deviceBCopyResult.metasToSave[0]],
      },
      now: 3000,
    })

    expect(result.sessionChanges).toHaveLength(1)
    expect(result.sessionChanges[0]).toEqual(
      expect.objectContaining({
        kind: 'create',
        session: expect.objectContaining({ syncConflictSourceId: 'same-id' }),
      })
    )
    expect(
      result.sessionChanges.some((change) => change.kind === 'create' && change.session.id === deviceBCopy.session.id)
    ).toBe(false)
    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(1)
  })

  it('recognizes existing stable conflict copies created before provenance was recorded', () => {
    const deviceA = session('same-id', 'Project', 'device A text')
    const deviceB = session('same-id', 'Project', 'device B text')
    const deviceBCopyResult = mergeRemoteSnapshot({
      localSessions: [deviceA],
      localMetas: [meta('same-id', 'Project')],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:00:00.000Z',
        deviceName: 'Device B',
        sessions: [deviceB],
        metas: [meta('same-id', 'Project')],
      },
      now: 2000,
    })
    const deviceBCopy = deviceBCopyResult.sessionChanges[0]
    if (deviceBCopy.kind !== 'create') throw new Error('Expected a Device B conflict copy')
    const legacyCopy = { ...deviceBCopy.session }
    delete legacyCopy.syncConflictSourceId

    const result = mergeRemoteSnapshot({
      localSessions: [deviceB],
      localMetas: [meta('same-id', 'Project')],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:01:00.000Z',
        deviceName: 'Device A',
        sessions: [deviceA, legacyCopy],
        metas: [meta('same-id', 'Project'), deviceBCopyResult.metasToSave[0]],
      },
      now: 3000,
    })

    expect(result.sessionChanges).toHaveLength(1)
    expect(result.sessionChanges[0]).not.toEqual(
      expect.objectContaining({
        kind: 'create',
        session: expect.objectContaining({ id: legacyCopy.id }),
      })
    )
  })

  it('does not scan local sessions for ordinary UUIDv4 remote sessions', () => {
    const sessionCount = 512
    const localSessions = Array.from({ length: sessionCount }, (_, index) =>
      session(uuidv4(), `Local ${index}`, `local ${index}`)
    )
    const remoteSessions = Array.from({ length: sessionCount }, (_, index) =>
      session(uuidv4(), `Remote ${index}`, `remote ${index}`)
    )
    const startedAt = performance.now()

    const result = mergeRemoteSnapshot({
      localSessions,
      localMetas: localSessions.map((item, index) => meta(item.id, item.name, index)),
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:01:00.000Z',
        deviceName: 'Device B',
        sessions: remoteSessions,
        metas: remoteSessions.map((item, index) => meta(item.id, item.name, index)),
      },
      now: 3000,
    })

    expect(result.sessionChanges).toHaveLength(sessionCount)
    expect(performance.now() - startedAt).toBeLessThan(1500)
  })

  it('keeps nested conflict provenance tied to the immediate source copy', () => {
    const localRoot = session('same-id', 'Project', 'local text')
    const firstRemote = session('same-id', 'Project', 'remote text')
    const first = mergeRemoteSnapshot({
      localSessions: [localRoot],
      localMetas: [meta('same-id', 'Project')],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:00:00.000Z',
        deviceName: 'Device B',
        sessions: [firstRemote],
        metas: [meta('same-id', 'Project')],
      },
      now: 1000,
    })
    const firstCopyChange = first.sessionChanges[0]
    if (firstCopyChange.kind !== 'create') throw new Error('Expected the first conflict copy')

    const deviceACopy = {
      ...firstCopyChange.session,
      messages: [
        {
          ...firstCopyChange.session.messages[0],
          contentParts: [{ type: 'text' as const, text: 'device A edit' }],
        },
      ],
    }
    const deviceBCopy = {
      ...firstCopyChange.session,
      messages: [
        {
          ...firstCopyChange.session.messages[0],
          contentParts: [{ type: 'text' as const, text: 'device B edit' }],
        },
      ],
    }
    const nested = mergeRemoteSnapshot({
      localSessions: [localRoot, deviceACopy],
      localMetas: [meta('same-id', 'Project'), meta(deviceACopy.id, deviceACopy.name)],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:01:00.000Z',
        deviceName: 'Device B',
        sessions: [deviceBCopy],
        metas: [meta(deviceBCopy.id, deviceBCopy.name)],
      },
      now: 2000,
    })
    const nestedCopyChange = nested.sessionChanges[0]
    if (nestedCopyChange.kind !== 'create') throw new Error('Expected the nested conflict copy')

    expect(nestedCopyChange.session.syncConflictSourceId).toBe(firstCopyChange.session.id)

    const replay = mergeRemoteSnapshot({
      localSessions: [localRoot, deviceBCopy],
      localMetas: [meta('same-id', 'Project'), meta(deviceBCopy.id, deviceBCopy.name)],
      remote: {
        version: 1,
        exportedAt: '2026-06-21T00:02:00.000Z',
        deviceName: 'Device A',
        sessions: [nestedCopyChange.session],
        metas: [nested.metasToSave[0]],
      },
      now: 3000,
    })

    expect(replay.sessionChanges).toEqual([])
    expect(replay.metasToSave).toEqual([])
    expect(replay.imported).toBe(0)
    expect(replay.conflicts).toBe(0)
  })

  it('uses different stable conflict IDs when remote content changes', () => {
    const local = session('same-id', 'Project', 'local text')
    const merge = (text: string) =>
      mergeRemoteSnapshot({
        localSessions: [local],
        localMetas: [meta('same-id', 'Project')],
        remote: {
          version: 1,
          exportedAt: '2026-06-21T00:00:00.000Z',
          deviceName: 'Phone',
          sessions: [session('same-id', 'Project', text)],
          metas: [meta('same-id', 'Project')],
        },
        now: 2000,
      })
    const first = merge('remote text 1').sessionChanges[0]
    const second = merge('remote text 2').sessionChanges[0]
    if (first.kind !== 'create' || second.kind !== 'create') throw new Error('Expected conflict copies')

    expect(first.session.id).not.toBe(second.session.id)
  })

  it('uses locale-independent stable conflict IDs for Unicode object keys', () => {
    const local = session('same-id', 'Project', 'local text')
    const remoteSession = session('same-id', 'Project', 'remote text')
    const unicodeKey = '\u00e4'
    remoteSession.messages[0].contentParts = [
      {
        type: 'tool-call',
        state: 'call',
        toolCallId: 'tool-1',
        toolName: 'search',
        args: { z: 1, [unicodeKey]: 2 },
      },
    ]
    const conflictIdForLocale = (locale: string) => {
      const collator = new Intl.Collator(locale)
      const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
        this: string,
        other: string
      ) {
        return collator.compare(String(this), other)
      })
      try {
        const result = mergeRemoteSnapshot({
          localSessions: [local],
          localMetas: [meta('same-id', 'Project')],
          remote: {
            version: 1,
            exportedAt: '2026-06-21T00:00:00.000Z',
            deviceName: 'Phone',
            sessions: [remoteSession],
            metas: [meta('same-id', 'Project')],
          },
          now: 2000,
        })
        const change = result.sessionChanges[0]
        if (change.kind !== 'create') throw new Error('Expected a conflict copy')
        return change.session.id
      } finally {
        localeCompare.mockRestore()
      }
    }

    expect(conflictIdForLocale('en')).toBe(conflictIdForLocale('sv'))
  })

  it('keeps the stable conflict ID when only remote metadata changes', () => {
    const local = session('same-id', 'Local', 'local text')
    const merge = (name: string, starred: boolean) =>
      mergeRemoteSnapshot({
        localSessions: [local],
        localMetas: [meta('same-id', 'Local')],
        remote: {
          version: 1,
          exportedAt: '2026-06-21T00:00:00.000Z',
          deviceName: 'Phone',
          sessions: [{ ...session('same-id', name, 'remote text'), starred }],
          metas: [{ ...meta('same-id', name), starred }],
        },
        now: 2000,
      })
    const first = merge('Remote Name', false).sessionChanges[0]
    const second = merge('Renamed Remote', true).sessionChanges[0]
    if (first.kind !== 'create' || second.kind !== 'create') throw new Error('Expected conflict copies')

    expect(first.session.id).toBe(second.session.id)
  })

  it('preserves an edited synced copy instead of aborting the merge', () => {
    const local = session('same-id', 'Local', 'local text')
    // The user kept chatting in the synced copy after importing it, so its
    // content no longer matches the remote snapshot it was imported from.
    const editedCopy = session('stable-copy-id', 'Unrelated', 'different content')
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('same-id', 'Remote', 'remote text')],
      metas: [meta('same-id', 'Remote')],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [local, editedCopy],
      localMetas: [meta('same-id', 'Local'), meta('stable-copy-id', 'Unrelated')],
      remote,
      now: 2000,
      createConflictId: () => 'stable-copy-id',
    })

    // The copy is user-owned local data: it must be left completely untouched
    // (no session change, no meta save, no new conflict) without failing.
    expect(result.sessionChanges).toHaveLength(0)
    expect(result.metasToSave).toHaveLength(0)
    expect(result.conflicts).toBe(0)
    expect(result.imported).toBe(0)
  })

  it('replays an unchanged remote conflict without touching the locally edited copy', () => {
    // Reviewer reproduction: import a conflict copy, append one local message
    // to it, then merge the same remote snapshot again. The merge must succeed
    // and the copy must keep the user's appended message.
    const local = session('same-id', 'Local', 'local text')
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [session('same-id', 'Remote', 'remote text')],
      metas: [meta('same-id', 'Remote')],
    }
    const deps = { now: 2000, createConflictId: () => 'stable-copy-id' }

    const first = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Local')],
      remote,
      ...deps,
    })
    const created = first.sessionChanges.find((change) => change.kind === 'create')
    if (!created || created.kind !== 'create') throw new Error('Expected a synced copy to be created')

    const copyWithUserMessage: Session = {
      ...created.session,
      messages: [
        ...created.session.messages,
        {
          id: 'user-msg',
          role: 'user',
          contentParts: [{ type: 'text' as const, text: 'user follow-up' }],
        },
      ],
    }
    const replay = mergeRemoteSnapshot({
      localSessions: [local, copyWithUserMessage],
      localMetas: [meta('same-id', 'Local'), meta('stable-copy-id', 'Remote (Synced copy)')],
      remote,
      ...deps,
    })

    expect(replay.sessionChanges).toHaveLength(0)
    expect(replay.metasToSave).toHaveLength(0)
    expect(copyWithUserMessage.messages.map((item) => item.id)).toContain('user-msg')
  })

  it('updates remote metadata for same-content sessions without creating synced copies when requested', () => {
    const local = session('same-id', 'Project', 'same text')
    const remoteSession = {
      ...session('same-id', 'Project Remote', 'same text'),
      starred: true,
    }
    const remoteMeta = {
      ...meta('same-id', 'Project Remote', 99),
      starred: true,
    }
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteSession],
      metas: [remoteMeta],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project', 1)],
      remote,
      now: 2000,
      createConflictId: () => 'copy-id',
      preferRemoteMetadata: true,
    })

    expect(result.sessionChanges).toEqual([
      expect.objectContaining({
        kind: 'update-metadata',
        sessionId: 'same-id',
        patch: expect.objectContaining({ name: 'Project Remote', starred: true }),
      }),
    ])
    expect(result.metasToSave).toEqual([remoteMeta])
    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(0)
  })

  it('preserves device-local avatar and background references during remote metadata updates', () => {
    const local = session('same-id', 'Project', 'same text')
    local.assistantAvatarKey = 'local-avatar'
    local.backgroundImage = { type: 'storage-key', storageKey: 'local-background' }
    const localMeta = {
      ...meta('same-id', 'Project', 1),
      assistantAvatarKey: 'local-avatar',
      backgroundImage: { type: 'storage-key' as const, storageKey: 'local-background' },
    }
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-07-23T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [
        {
          ...session('same-id', 'Project Remote', 'same text'),
          starred: true,
        },
      ],
      metas: [{ ...meta('same-id', 'Project Remote', 99), starred: true }],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [localMeta],
      remote,
      now: 2000,
      preferRemoteMetadata: true,
    })

    const metadataChange = result.sessionChanges[0]
    expect(metadataChange).toMatchObject({
      kind: 'update-metadata',
      sessionId: 'same-id',
      patch: { name: 'Project Remote', starred: true },
    })
    if (metadataChange.kind !== 'update-metadata') throw new Error('Expected a metadata update')
    expect(metadataChange.patch).not.toHaveProperty('assistantAvatarKey')
    expect(metadataChange.patch).not.toHaveProperty('backgroundImage')
    expect(result.metasToSave[0]).toMatchObject({
      name: 'Project Remote',
      starred: true,
      sortOrder: 99,
      assistantAvatarKey: 'local-avatar',
      backgroundImage: { type: 'storage-key', storageKey: 'local-background' },
    })
  })

  it('keeps local metadata for same-content sessions during upload merges', () => {
    const local = session('same-id', 'Project', 'same text')
    const remoteSession = {
      ...session('same-id', 'Project Remote', 'same text'),
      starred: true,
    }
    const remote: SyncSnapshot = {
      version: 1,
      exportedAt: '2026-06-21T00:00:00.000Z',
      deviceName: 'Phone',
      sessions: [remoteSession],
      metas: [{ ...meta('same-id', 'Project Remote', 99), starred: true }],
    }

    const result = mergeRemoteSnapshot({
      localSessions: [local],
      localMetas: [meta('same-id', 'Project', 1)],
      remote,
      now: 2000,
      createConflictId: () => 'copy-id',
    })

    expect(result.sessionChanges).toEqual([])
    expect(result.metasToSave).toEqual([])
    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(0)
  })
})
