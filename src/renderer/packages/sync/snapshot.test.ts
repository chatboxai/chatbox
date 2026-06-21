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

function meta(
  id: string,
  name: string,
  sortOrder = 1,
  type: SessionMetaRecord['type'] = 'chat'
): SessionMetaRecord {
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
