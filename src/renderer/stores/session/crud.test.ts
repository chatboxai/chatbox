import type { Message, Session, SessionMetaRecord } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory chatStore fake shared across mocks (hoisted so vi.mock can see it).
const fake = vi.hoisted(() => {
  let nextId = 1
  const sessions = new Map<string, Session>()
  let metas: SessionMetaRecord[] = []
  const metaStorageUpdate = vi.fn((id: string, updates: Partial<SessionMetaRecord>) => {
    metas = metas.map((m) => (m.id === id ? { ...m, ...updates } : m))
    return Promise.resolve(null)
  })
  return {
    sessions,
    getMetas: () => metas,
    setMetas: (m: SessionMetaRecord[]) => {
      metas = m
    },
    metaStorageUpdate,
    nextIdRef: { get: () => nextId, bump: () => nextId++ },
    reset() {
      nextId = 1
      sessions.clear()
      metas = []
      metaStorageUpdate.mockClear()
    },
  }
})

const mocks = vi.hoisted(() => ({
  routerNavigate: vi.fn(),
  clearAutoScroll: vi.fn(),
  deleteSessionAttachments: vi.fn(() => Promise.resolve()),
  deleteSessions: vi.fn((ids: string[]) => {
    for (const id of ids) fake.sessions.delete(id)
    fake.setMetas(fake.getMetas().filter((m) => !ids.includes(m.id)))
    return Promise.resolve()
  }),
  updateSession: vi.fn((id: string, partial: Partial<Session>) => {
    const s = fake.sessions.get(id)
    if (s) fake.sessions.set(id, { ...s, ...partial })
    return Promise.resolve(fake.sessions.get(id))
  }),
}))

vi.mock('../chatStore', () => ({
  createSession: vi.fn((newSession: Omit<Session, 'id'>) => {
    const id = `s${fake.nextIdRef.bump()}`
    const session = { ...newSession, id } as Session
    fake.sessions.set(id, session)
    return Promise.resolve(session)
  }),
  getSession: vi.fn((id: string) => Promise.resolve(fake.sessions.get(id) ?? null)),
  listSessionsMeta: vi.fn(() => Promise.resolve(fake.getMetas())),
  listAllSessionsMeta: vi.fn(() => Promise.resolve(fake.getMetas())),
  deleteSessions: mocks.deleteSessions,
  updateSession: mocks.updateSession,
  updateSessionWithMessages: vi.fn((id: string, partial: Partial<Session>) => {
    const s = fake.sessions.get(id)
    if (!s) throw new Error(`Session ${id} not found`)
    const updated = { ...s, ...partial }
    fake.sessions.set(id, updated)
    return Promise.resolve(updated)
  }),
  getMetaStorage: vi.fn(() => Promise.resolve({ update: fake.metaStorageUpdate })),
  updateSessionListData: vi.fn((updater: (items: SessionMetaRecord[]) => SessionMetaRecord[]) => {
    fake.setMetas(updater(fake.getMetas()))
  }),
}))

vi.mock('../atoms', async () => {
  const { atom } = await import('jotai')
  return { currentSessionIdAtom: atom<string | null>(null) }
})

vi.mock('../scrollActions', () => ({
  clearAutoScroll: mocks.clearAutoScroll,
}))

vi.mock('../sessionHelpers', () => ({
  initEmptyChatSession: () => ({ name: 'New Chat', type: 'chat', messages: [] }),
  initEmptyPictureSession: () => ({ name: 'New Image', type: 'picture', messages: [] }),
}))

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    getSessionAttachmentRagController: () => ({
      deleteMessageAttachments: vi.fn(),
      deleteSessionAttachments: mocks.deleteSessionAttachments,
    }),
  },
}))

vi.mock('@/router', () => ({
  router: { navigate: mocks.routerNavigate },
}))

import * as atoms from '../atoms'
import * as crud from './crud'

function msg(id: string, role: Message['role'] = 'user', text = `text-${id}`): Message {
  return { id, role, contentParts: [{ type: 'text', text }] } as Message
}

function meta(id: string, sortOrder: number, starred = false): SessionMetaRecord {
  return { id, name: id, type: 'chat', sortOrder, starred, hidden: false } as unknown as SessionMetaRecord
}

const store = getDefaultStore()

beforeEach(() => {
  fake.reset()
  mocks.routerNavigate.mockClear()
  mocks.clearAutoScroll.mockClear()
  mocks.deleteSessionAttachments.mockClear()
  mocks.deleteSessions.mockClear()
  mocks.updateSession.mockClear()
  store.set(atoms.currentSessionIdAtom, null)
})

describe('switchCurrentSession', () => {
  it('sets the atom, navigates, and clears auto-scroll', () => {
    crud.switchCurrentSession('s42')
    expect(store.get(atoms.currentSessionIdAtom)).toBe('s42')
    expect(mocks.routerNavigate).toHaveBeenCalledWith({ to: '/session/$sessionId', params: { sessionId: 's42' } })
    expect(mocks.clearAutoScroll).toHaveBeenCalled()
  })
})

describe('createEmpty', () => {
  it('creates a chat/picture session and switches to it', async () => {
    const chat = await crud.createEmpty('chat')
    expect(chat.type).toBe('chat')
    expect(store.get(atoms.currentSessionIdAtom)).toBe(chat.id)

    const picture = await crud.createEmpty('picture')
    expect(picture.type).toBe('picture')
    expect(store.get(atoms.currentSessionIdAtom)).toBe(picture.id)
  })

  it('throws for an unknown type', async () => {
    await expect(crud.createEmpty('task' as never)).rejects.toThrow(/Unknown session type/)
  })
})

describe('copyAndSwitchSession', () => {
  it('deep-copies messages with fresh ids and switches to the copy', async () => {
    fake.sessions.set('src', {
      id: 'src',
      name: 'Source',
      type: 'chat',
      messages: [msg('m1', 'system', 'sys'), msg('m2', 'user', 'hello')],
    } as Session)

    await crud.copyAndSwitchSession({ id: 'src', name: 'Source', type: 'chat' } as never)

    const newId = store.get(atoms.currentSessionIdAtom)
    expect(newId).not.toBe('src')
    const copy = fake.sessions.get(newId as string)
    expect(copy).toBeTruthy()
    expect(copy?.messages).toHaveLength(2)
    // fresh ids, same content
    expect(copy?.messages.map((m) => m.id)).not.toContain('m1')
    expect(copy?.messages[1].contentParts).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('throws when the source session does not exist', async () => {
    await expect(crud.copyAndSwitchSession({ id: 'nope', name: 'x', type: 'chat' } as never)).rejects.toThrow(
      /not found/
    )
  })
})

describe('reorderSessions (fractional indexing)', () => {
  beforeEach(() => {
    fake.setMetas([meta('a', 4000), meta('b', 3000), meta('c', 2000)])
  })

  it('is a no-op when the index does not change', async () => {
    await crud.reorderSessions(1, 1)
    expect(fake.metaStorageUpdate).not.toHaveBeenCalled()
  })

  it('moving between two sessions takes the midpoint sortOrder', async () => {
    await crud.reorderSessions(2, 1) // move c between a and b
    expect(fake.metaStorageUpdate).toHaveBeenCalledWith('c', { sortOrder: 3500, starred: false })
    expect(fake.getMetas().map((m) => m.id)).toEqual(['a', 'c', 'b'])
  })

  it('moving to the top goes above the previous head', async () => {
    await crud.reorderSessions(2, 0)
    expect(fake.metaStorageUpdate).toHaveBeenCalledWith('c', { sortOrder: 5000, starred: false })
    expect(fake.getMetas().map((m) => m.id)).toEqual(['c', 'a', 'b'])
  })

  it('moving to the bottom goes below the previous tail', async () => {
    await crud.reorderSessions(0, 2)
    expect(fake.metaStorageUpdate).toHaveBeenCalledWith('a', { sortOrder: 1000, starred: false })
    expect(fake.getMetas().map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps the moved session’s starred flag and ranks it within its own group', async () => {
    // After the splice, reordered[newIndex] IS the moved session, so nextStarred
    // always equals its own flag — moving next to a starred session does not star it.
    fake.setMetas([meta('star', 9000, true), meta('a', 4000), meta('b', 3000)])

    await crud.reorderSessions(2, 0) // drag b to the top, above the starred session
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(fake.metaStorageUpdate).toHaveBeenCalledWith('b', expect.objectContaining({ starred: false }))
  })
})

describe('switchToIndex / switchToNext', () => {
  beforeEach(() => {
    fake.setMetas([meta('a', 3000), meta('b', 2000), meta('c', 1000)])
  })

  it('switchToIndex ignores out-of-range indexes', async () => {
    await crud.switchToIndex(99)
    expect(store.get(atoms.currentSessionIdAtom)).toBeNull()
    await crud.switchToIndex(1)
    expect(store.get(atoms.currentSessionIdAtom)).toBe('b')
  })

  it('switchToNext advances and wraps around', async () => {
    store.set(atoms.currentSessionIdAtom, 'c')
    await crud.switchToNext()
    expect(store.get(atoms.currentSessionIdAtom)).toBe('a') // wrapped

    await crud.switchToNext(true) // reversed wraps back
    expect(store.get(atoms.currentSessionIdAtom)).toBe('c')
  })

  it('switchToNext falls back to the first session when the current one is unknown', async () => {
    store.set(atoms.currentSessionIdAtom, 'ghost')
    await crud.switchToNext()
    expect(store.get(atoms.currentSessionIdAtom)).toBe('a')
  })
})

describe('clearConversationList', () => {
  beforeEach(() => {
    fake.setMetas([meta('a', 3000), meta('b', 2000), meta('c', 1000)])
  })

  it('keeps the first N sessions and deletes the rest', async () => {
    await crud.clearConversationList(1)
    expect(mocks.deleteSessions).toHaveBeenCalledWith(['b', 'c'])
    expect(mocks.routerNavigate).not.toHaveBeenCalled()
  })

  it('navigates home when the current session was deleted', async () => {
    store.set(atoms.currentSessionIdAtom, 'c')
    await crud.clearConversationList(1)
    expect(mocks.routerNavigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('does nothing when everything is kept', async () => {
    await crud.clearConversationList(5)
    expect(mocks.deleteSessions).not.toHaveBeenCalled()
  })
})

describe('clear', () => {
  it('keeps only the first system message, cancels in-flight messages, and purges RAG attachments', async () => {
    const cancel = vi.fn()
    const generating = { ...msg('m3', 'assistant'), cancel } as Message & { cancel: () => void }
    fake.sessions.set('s1', {
      id: 's1',
      name: 's1',
      type: 'chat',
      messages: [msg('m0', 'system', 'prompt'), msg('m1'), msg('m2', 'assistant'), generating],
      threads: [{ id: 't1', name: 't', messages: [], createdAt: 0 }],
    } as unknown as Session)

    const result = await crud.clear('s1')

    expect(cancel).toHaveBeenCalled()
    expect(mocks.deleteSessionAttachments).toHaveBeenCalledWith('s1')
    expect(result?.messages.map((m) => m.id)).toEqual(['m0'])
    expect(result?.threads).toBeUndefined()
  })

  it('survives a failing RAG cleanup and still clears', async () => {
    mocks.deleteSessionAttachments.mockRejectedValueOnce(new Error('rag down'))
    fake.sessions.set('s1', {
      id: 's1',
      name: 's1',
      type: 'chat',
      messages: [msg('m1')],
    } as unknown as Session)

    const result = await crud.clear('s1')
    expect(result?.messages).toEqual([])
  })

  it('is a no-op for unknown sessions', async () => {
    await expect(crud.clear('ghost')).resolves.toBeUndefined()
  })
})
