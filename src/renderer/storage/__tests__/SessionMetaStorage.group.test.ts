import 'fake-indexeddb/auto'
import type { SessionMetaRecord } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IndexedDBSessionMetaStorage } from '../SessionMetaStorage'

const DB_NAME = 'chatbox-session-meta'

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

function rec(
  id: string,
  sortOrder: number,
  groupId?: string,
  extra: Partial<SessionMetaRecord> = {}
): SessionMetaRecord {
  return { id, name: id, sortOrder, createdAt: sortOrder, groupId, ...extra }
}

describe('IndexedDBSessionMetaStorage — group-filtered pagination', () => {
  let store: IndexedDBSessionMetaStorage
  beforeEach(async () => {
    await deleteDb()
    store = new IndexedDBSessionMetaStorage()
    await store.initialize()
  })
  afterEach(() => {
    ;(store as unknown as { db: IDBDatabase | null }).db?.close()
  })

  it('returns only the requested group, newest sortOrder first, paging via keyset cursor', async () => {
    await store.createMany([
      rec('a3', 100, 'group:A'),
      rec('a2', 90, 'group:A'),
      rec('a1', 80, 'group:A'),
      rec('b1', 95, 'group:B'),
      rec('u1', 70),
    ])

    const p1 = await store.getPageByGroup('group:A', null, 2)
    expect(p1.items.map((r) => r.id)).toEqual(['a3', 'a2'])
    expect(p1.total).toBe(3)
    expect(p1.nextCursor).toBe(90)

    const p2 = await store.getPageByGroup('group:A', p1.nextCursor, 2)
    expect(p2.items.map((r) => r.id)).toEqual(['a1'])
    expect(p2.nextCursor).toBeNull()
  })

  it('treats groupId null as the ungrouped bucket', async () => {
    await store.createMany([rec('u1', 70), rec('u2', 60), rec('g', 50, 'group:A')])
    const page = await store.getPageByGroup(null, null, 10)
    expect(page.items.map((r) => r.id)).toEqual(['u1', 'u2'])
    expect(page.total).toBe(2)
    expect(await store.getTotalByGroup(null)).toBe(2)
  })

  it('omits hidden sessions from the page and follows group changes via update', async () => {
    await store.createMany([rec('a', 100, 'group:A'), rec('h', 90, 'group:A', { hidden: true })])
    expect((await store.getPageByGroup('group:A', null, 10)).items.map((r) => r.id)).toEqual(['a'])

    await store.update('a', { groupId: 'group:B' })
    expect((await store.getPageByGroup('group:A', null, 10)).items).toEqual([])
    expect((await store.getPageByGroup('group:B', null, 10)).items.map((r) => r.id)).toEqual(['a'])
  })

  it('moving a session to ungrouped (groupId undefined) makes it appear under null', async () => {
    await store.create(rec('s', 100, 'group:A'))
    await store.update('s', { groupId: undefined })
    expect((await store.getPageByGroup('group:A', null, 10)).items).toEqual([])
    expect((await store.getPageByGroup(null, null, 10)).items.map((r) => r.id)).toEqual(['s'])
  })
})
