import { describe, expect, it } from 'vitest'
import type { SessionMeta } from '../types/session'
import { areSessionsInSameDragGroup, uniqueSessionRecords } from './session-sort'

describe('areSessionsInSameDragGroup', () => {
  const session = (starred: boolean, folderId?: string): Pick<SessionMeta, 'starred' | 'folderId'> => ({
    starred,
    folderId,
  })

  it('groups two pinned sessions together regardless of folder', () => {
    // A pinned session never shows inside a folder, so folderId must not split the pinned group.
    expect(areSessionsInSameDragGroup(session(true), session(true))).toBe(true)
    expect(areSessionsInSameDragGroup(session(true, 'folder-a'), session(true, 'folder-b'))).toBe(true)
  })

  it('keeps pinned and unpinned sessions in different groups', () => {
    expect(areSessionsInSameDragGroup(session(true), session(false))).toBe(false)
    expect(areSessionsInSameDragGroup(session(false), session(true))).toBe(false)
  })

  it('groups unpinned sessions only when they share the same folder', () => {
    expect(areSessionsInSameDragGroup(session(false, 'folder-a'), session(false, 'folder-a'))).toBe(true)
    expect(areSessionsInSameDragGroup(session(false, 'folder-a'), session(false, 'folder-b'))).toBe(false)
  })

  it('treats undefined and missing folderId as the unfiled "Chats" group', () => {
    expect(areSessionsInSameDragGroup(session(false), session(false))).toBe(true)
    expect(areSessionsInSameDragGroup(session(false, undefined), session(false))).toBe(true)
  })

  it('keeps foldered sessions out of the unfiled group', () => {
    expect(areSessionsInSameDragGroup(session(false), session(false, 'folder-a'))).toBe(false)
    expect(areSessionsInSameDragGroup(session(false, 'folder-a'), session(false))).toBe(false)
  })

  it('returns false when either session is missing', () => {
    expect(areSessionsInSameDragGroup(undefined, session(false))).toBe(false)
    expect(areSessionsInSameDragGroup(session(false), undefined)).toBe(false)
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
