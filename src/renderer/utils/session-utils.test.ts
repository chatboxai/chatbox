import { SESSION_MANAGER_ID } from '@shared/defaults'
import type { SessionMeta } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'
import { createSessionMetaRecordsFromLegacyList, isSystemSession, sortSessions } from './session-utils'

const meta = (overrides: Partial<SessionMeta> & { system?: boolean } = {}): SessionMeta =>
  ({
    id: overrides.id ?? 'sess-normal',
    name: overrides.name ?? 'normal',
    ...overrides,
  }) as SessionMeta

describe('isSystemSession', () => {
  it('returns true when id matches SESSION_MANAGER_ID', () => {
    expect(isSystemSession({ id: SESSION_MANAGER_ID })).toBe(true)
  })

  it('returns true when system flag is set', () => {
    expect(isSystemSession({ id: 'a-uuid', system: true })).toBe(true)
  })

  it('returns false for a normal uuid without system flag', () => {
    expect(isSystemSession({ id: '550e8400-e29b-41d4-a716-446655440000' })).toBe(false)
  })

  it('returns false when neither reserved id nor system flag is present', () => {
    expect(isSystemSession({ id: 'plain' })).toBe(false)
  })
})

describe('sortSessions', () => {
  it('returns empty array for empty input', () => {
    expect(sortSessions([])).toEqual([])
  })

  it('drops sessions whose id is in RESERVED_SESSION_IDS', () => {
    const result = sortSessions([meta({ id: SESSION_MANAGER_ID, name: 'manager' }), meta({ id: 'a', name: 'a' })])
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('drops sessions with system: true', () => {
    const result = sortSessions([meta({ id: 'sys-1', name: 'sys', system: true }), meta({ id: 'a', name: 'a' })])
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('still drops hidden sessions', () => {
    const result = sortSessions([meta({ id: 'h', hidden: true }), meta({ id: 'a' })])
    expect(result.map((s) => s.id)).toEqual(['a'])
  })

  it('keeps starred sessions pinned at the front in original order', () => {
    const result = sortSessions([
      meta({ id: 'p1', starred: true }),
      meta({ id: 'n1' }),
      meta({ id: 'p2', starred: true }),
      meta({ id: 'n2' }),
    ])
    expect(result.map((s) => s.id)).toEqual(['p1', 'p2', 'n2', 'n1'])
  })

  it('reverses normal sessions', () => {
    const result = sortSessions([meta({ id: 'a' }), meta({ id: 'b' }), meta({ id: 'c' })])
    expect(result.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('handles mixed pinned + regular + hidden sessions', () => {
    const result = sortSessions([
      meta({ id: 'r1' }),
      meta({ id: 'p1', starred: true }),
      meta({ id: 'h1', hidden: true }),
      meta({ id: 'r2' }),
      meta({ id: 'p2', starred: true }),
    ])
    expect(result.map((s) => s.id)).toEqual(['p1', 'p2', 'r2', 'r1'])
  })
})

describe('createSessionMetaRecordsFromLegacyList', () => {
  it('preserves legacy display order when records are sorted by sortOrder', () => {
    const justChat = { id: 'just-chat', name: 'Just chat', starred: true } as SessionMeta
    const markdown = { id: 'markdown', name: 'Markdown', starred: true } as SessionMeta
    const travel = { id: 'travel', name: 'Travel' } as SessionMeta
    const social = { id: 'social', name: 'Social' } as SessionMeta
    const software = { id: 'software', name: 'Software', starred: true } as SessionMeta
    const translator = { id: 'translator', name: 'Translator' } as SessionMeta

    const legacyList = [justChat, markdown, travel, social, software, translator]
    const records = createSessionMetaRecordsFromLegacyList(legacyList, 10_000)

    expect(sortSessionRecords(records).map((record) => record.id)).toEqual(
      sortSessions(legacyList).map((session) => session.id)
    )
    expect(sortSessionRecords(records).map((record) => record.id)).toEqual([
      'just-chat',
      'markdown',
      'software',
      'translator',
      'social',
      'travel',
    ])
  })

  it('preserves groupId / system / sortIndex on the produced records', () => {
    const grouped = { id: 'g1', name: 'Grouped', groupId: 'group:abc', sortIndex: 2 } as SessionMeta
    const records = createSessionMetaRecordsFromLegacyList([grouped], 10_000)
    expect(records[0].groupId).toBe('group:abc')
    expect(records[0].sortIndex).toBe(2)
  })
})
