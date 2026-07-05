import type { Session, SessionMetaRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { createSyncSnapshot, mergeRemoteSnapshot } from './snapshot'
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
    expect(synced.threads?.[0].messages[0].contentParts).toEqual([])
    expect(synced.messageForksHash?.fork.lists[0].messages[0].contentParts).toEqual([])
    expect(snapshot.metas[0].assistantAvatarKey).toBeUndefined()
    expect(snapshot.metas[0].backgroundImage).toBeUndefined()
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
      createId: () => 'unused',
    })

    expect(result.sessionsToSave.map((s) => s.id)).toEqual(['remote-1'])
    expect(result.metasToSave.map((m) => m.id)).toEqual(['remote-1'])
    expect(result.imported).toBe(1)
    expect(result.conflicts).toBe(0)
  })

  it('strips local-only blob references when importing remote sessions', () => {
    const remoteSession = session('remote-1', 'Remote', 'hello')
    remoteSession.assistantAvatarKey = 'avatar-key'
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
      createId: () => 'unused',
    })

    expect(result.sessionsToSave[0].assistantAvatarKey).toBeUndefined()
    expect(result.sessionsToSave[0].messages[0].contentParts).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.sessionsToSave[0].messages[0].files).toEqual([
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
      createId: () => 'unused',
    })

    expect(result.sessionsToSave.map((item) => item.id)).toEqual(['chat-1', 'legacy-1'])
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
      createId: () => 'copy-id',
    })

    expect(result.sessionsToSave).toHaveLength(1)
    expect(result.sessionsToSave[0].id).toBe('copy-id')
    expect(result.sessionsToSave[0].name).toBe('Project (Synced copy)')
    expect(result.metasToSave[0]).toMatchObject({
      id: 'copy-id',
      name: 'Project (Synced copy)',
      sortOrder: 2000,
      createdAt: 2000,
    })
    expect(result.imported).toBe(0)
    expect(result.conflicts).toBe(1)
  })
})
