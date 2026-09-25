import { describe, expect, it } from 'vitest'
import type { SessionMetaRecord } from '../types/session'
import {
  applySortedSessionRecord,
  areSessionsInSameListGroup,
  excludeCollapsedFolderSessions,
  findGroupSuccessor,
  getSessionListGroup,
  getSessionListGroupRank,
  sortSessionRecords,
  uniqueSessionRecords,
} from './session-sort'

describe('areSessionsInSameListGroup', () => {
  it('treats false and undefined as the same unpinned group', () => {
    expect(areSessionsInSameListGroup({ starred: false }, {}, [])).toBe(true)
  })

  it('keeps pinned and unpinned sessions in different groups', () => {
    expect(areSessionsInSameListGroup({ starred: true }, { starred: false }, [])).toBe(false)
    expect(areSessionsInSameListGroup({ starred: true }, {}, [])).toBe(false)
  })

  it('separates folders and treats a deleted folder as unfiled', () => {
    expect(areSessionsInSameListGroup({ folderId: 'a' }, { folderId: 'b' }, ['a', 'b'])).toBe(false)
    expect(areSessionsInSameListGroup({ folderId: 'a' }, { folderId: 'a' }, ['a'])).toBe(true)
    expect(areSessionsInSameListGroup({ folderId: 'gone' }, {}, ['a'])).toBe(true)
  })

  it('returns false when either session is missing', () => {
    expect(areSessionsInSameListGroup(undefined, {}, [])).toBe(false)
    expect(areSessionsInSameListGroup({}, undefined, [])).toBe(false)
  })
})

describe('sortSessionRecords', () => {
  const record = (id: string, sortOrder: number, extra: Partial<SessionMetaRecord> = {}): SessionMetaRecord => ({
    id,
    name: id,
    sortOrder,
    createdAt: 0,
    ...extra,
  })

  it('orders pinned, then folders in folder order, then unfiled, each by sortOrder', () => {
    const sorted = sortSessionRecords(
      [
        record('unfiled-old', 1),
        record('b-new', 9, { folderId: 'b' }),
        record('pinned', 0, { starred: true, folderId: 'a' }),
        record('a', 5, { folderId: 'a' }),
        record('orphan', 7, { folderId: 'deleted' }),
        record('hidden', 100, { hidden: true }),
        record('b-old', 2, { folderId: 'b' }),
      ],
      ['a', 'b']
    )
    expect(sorted.map((item) => item.id)).toEqual(['pinned', 'a', 'b-new', 'b-old', 'orphan', 'unfiled-old'])
  })

  it('keeps the pinned-then-sortOrder order without folders', () => {
    const sorted = sortSessionRecords([
      record('x', 1, { folderId: 'a' }),
      record('y', 2),
      record('z', 0, { starred: true }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['z', 'y', 'x'])
  })

  it('ranks groups for pagination boundaries', () => {
    expect(getSessionListGroupRank({ starred: true, folderId: 'b' }, ['a', 'b'])).toBe(0)
    expect(getSessionListGroupRank({ folderId: 'b' }, ['a', 'b'])).toBe(2)
    expect(getSessionListGroupRank({ folderId: 'x' }, ['a', 'b'])).toBe(3)
    expect(getSessionListGroup({ folderId: 'x' }, ['a'])).toEqual({ kind: 'unfiled' })
  })
})

describe('excludeCollapsedFolderSessions', () => {
  it('drops members of collapsed folders but keeps pinned and orphaned sessions', () => {
    const sessions = [
      { id: 'pinned', starred: true, folderId: 'closed' },
      { id: 'closed-member', folderId: 'closed' },
      { id: 'open-member', folderId: 'open' },
      { id: 'orphan', folderId: 'deleted' },
    ]
    expect(
      excludeCollapsedFolderSessions(sessions, ['closed', 'open'], ['closed', 'deleted']).map(({ id }) => id)
    ).toEqual(['pinned', 'open-member', 'orphan'])
  })
})

describe('uniqueSessionRecords', () => {
  it('keeps the first occurrence of each id', () => {
    expect(uniqueSessionRecords([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'b' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ])
  })
})

describe('findGroupSuccessor', () => {
  const record = (id: string, sortOrder: number, extra: Partial<SessionMetaRecord> = {}): SessionMetaRecord => ({
    id,
    name: id,
    sortOrder,
    createdAt: sortOrder,
    ...extra,
  })
  const records = [
    record('a1', 100, { folderId: 'a' }),
    record('b1', 90, { folderId: 'b' }),
    record('a2', 80, { folderId: 'a' }),
    record('a3', 70, { folderId: 'a' }),
    record('pinned', 60, { folderId: 'a', starred: true }),
    record('archived', 75, { folderId: 'a', hidden: true }),
    record('moving', 50, { folderId: 'a' }),
  ]

  it('returns the next stored session of the same group below the upper neighbor', () => {
    expect(findGroupSuccessor(records, { sortOrder: 100 }, { folderId: 'a' }, 'moving', ['a', 'b'])?.id).toBe('a2')
    expect(findGroupSuccessor(records, { sortOrder: 80 }, { folderId: 'a' }, 'moving', ['a', 'b'])?.id).toBe('a3')
  })

  it('skips the moved session, hidden sessions and other groups', () => {
    expect(findGroupSuccessor(records, { sortOrder: 70 }, { folderId: 'a' }, 'moving', ['a', 'b'])).toBeUndefined()
    expect(findGroupSuccessor(records, { sortOrder: 100 }, { folderId: 'b' }, 'moving', ['a', 'b'])?.id).toBe('b1')
  })
})

describe('applySortedSessionRecord', () => {
  const folderIds = ['f1', 'f2']
  const record = (id: string, sortOrder: number, extra: Partial<SessionMetaRecord> = {}): SessionMetaRecord => ({
    id,
    name: id,
    sortOrder,
    createdAt: 0,
    ...extra,
  })

  it('replaces a record in place when its position is unchanged', () => {
    const records = sortSessionRecords([record('a', 3), record('b', 2), record('c', 1)], folderIds)
    const renamed = record('b', 2, { name: 'Renamed' })
    applySortedSessionRecord(records, renamed, folderIds)
    expect(records.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(records[1]).toBe(renamed)
  })

  it('moves, inserts and removes records to match a full sort', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const stored = new Map<string, SessionMetaRecord>()
    const records: SessionMetaRecord[] = []
    for (let step = 0; step < 500; step++) {
      const id = `s${Math.floor(random() * 40)}`
      const next = record(id, Math.floor(random() * 20), {
        starred: random() < 0.15 ? true : undefined,
        hidden: random() < 0.1 ? true : undefined,
        folderId: [undefined, 'f1', 'f2', 'gone'][Math.floor(random() * 4)],
      })
      stored.set(id, next)
      applySortedSessionRecord(records, next, folderIds)
      const expected = sortSessionRecords([...stored.values()], folderIds)
      expect(records.map((item) => [getRank(item), item.sortOrder])).toEqual(
        expected.map((item) => [getRank(item), item.sortOrder])
      )
      expect(new Set(records.map((item) => item.id))).toEqual(new Set(expected.map((item) => item.id)))
    }

    function getRank(item: SessionMetaRecord) {
      if (item.starred) return 0
      const index = item.folderId ? folderIds.indexOf(item.folderId) : -1
      return index >= 0 ? index + 1 : folderIds.length + 1
    }
  })
})
