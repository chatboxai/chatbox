import { describe, expect, it } from 'vitest'
import type { SessionMetaRecord } from '../types/session'
import {
  areSessionsInSameListGroup,
  excludeCollapsedFolderSessions,
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
