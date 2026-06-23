import type { SessionGroup, SessionMeta } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  UNASSIGNED_ID,
  deriveInitialSelection,
  filterGroupsForExport,
  filterSessionsForExport,
} from './export-helpers'

const makeGroup = (id: string, parentId: string | null = null, sortIndex = 0): SessionGroup => ({
  id,
  name: id,
  parentId,
  sortIndex,
  createdAt: 0,
  updatedAt: 0,
})

const makeSession = (id: string, groupId?: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
  ({
    id,
    name: id,
    type: 'chat',
    groupId,
    ...extra,
  }) as SessionMeta

describe('filterGroupsForExport / filterSessionsForExport', () => {
  it('case 1: full selection keeps every group and every session, preserves groupId', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A'), makeSession('s2', 'B'), makeSession('s3')]

    const selectedGroupIds = new Set(['A', 'B', UNASSIGNED_ID])
    const selectedSessionIds = new Set(['s1', 's2', 's3'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    expect(filteredGroups.map((g) => g.id)).toEqual(['A', 'B'])

    const retainedIds = new Set(filteredGroups.map((g) => g.id))
    const filteredSessions = filterSessionsForExport(sessions, selectedSessionIds, retainedIds)
    expect(filteredSessions.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(filteredSessions.map((s) => s.groupId)).toEqual(['A', 'B', undefined])
  })

  it('case 2: deselecting a single session drops it but leaves groups intact', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A'), makeSession('s2', 'B'), makeSession('s3')]

    const selectedGroupIds = new Set(['A', 'B', UNASSIGNED_ID])
    const selectedSessionIds = new Set(['s2', 's3'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    expect(filteredGroups.map((g) => g.id)).toEqual(['A', 'B'])

    const retainedIds = new Set(filteredGroups.map((g) => g.id))
    const filteredSessions = filterSessionsForExport(sessions, selectedSessionIds, retainedIds)
    expect(filteredSessions.map((s) => s.id)).toEqual(['s2', 's3'])
  })

  it('case 3: deselecting an entire group narrows both sets', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A'), makeSession('s2', 'B')]

    const selectedGroupIds = new Set(['A'])
    const selectedSessionIds = new Set(['s1'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    expect(filteredGroups.map((g) => g.id)).toEqual(['A'])

    const retainedIds = new Set(filteredGroups.map((g) => g.id))
    const filteredSessions = filterSessionsForExport(sessions, selectedSessionIds, retainedIds)
    expect(filteredSessions.map((s) => s.id)).toEqual(['s1'])
    expect(filteredSessions[0]?.groupId).toBe('A')
  })

  it('case 4: parent chain is preserved when only the child group is selected', () => {
    const groups = [makeGroup('Parent'), makeGroup('Child', 'Parent')]
    const selectedGroupIds = new Set(['Child'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    expect(filteredGroups.map((g) => g.id)).toEqual(['Parent', 'Child'])
  })

  it('case 5: cross-group session subset keeps original groupId values', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A'), makeSession('s2', 'A'), makeSession('s3', 'B')]

    const selectedGroupIds = new Set(['A', 'B'])
    const selectedSessionIds = new Set(['s2', 's3'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    const retainedIds = new Set(filteredGroups.map((g) => g.id))
    const filteredSessions = filterSessionsForExport(sessions, selectedSessionIds, retainedIds)

    expect(filteredSessions).toHaveLength(2)
    expect(filteredSessions.find((s) => s.id === 's2')?.groupId).toBe('A')
    expect(filteredSessions.find((s) => s.id === 's3')?.groupId).toBe('B')
  })

  it('case 6: unassigned sessions stay unassigned', () => {
    const groups: SessionGroup[] = []
    const sessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')]

    const selectedGroupIds = new Set([UNASSIGNED_ID])
    const selectedSessionIds = new Set(['s1', 's2', 's3'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    expect(filteredGroups).toEqual([])

    const retainedIds = new Set(filteredGroups.map((g) => g.id))
    const filteredSessions = filterSessionsForExport(sessions, selectedSessionIds, retainedIds)
    expect(filteredSessions).toHaveLength(3)
    expect(filteredSessions.every((s) => s.groupId === undefined)).toBe(true)
  })

  it('case 7: orphaned session has its dangling groupId cleared', () => {
    const groups = [makeGroup('A')]
    const sessions = [makeSession('s1', 'A')]

    const selectedGroupIds = new Set<string>()
    const selectedSessionIds = new Set(['s1'])

    const filteredGroups = filterGroupsForExport(groups, selectedGroupIds)
    expect(filteredGroups).toEqual([])

    const retainedIds = new Set(filteredGroups.map((g) => g.id))
    const filteredSessions = filterSessionsForExport(sessions, selectedSessionIds, retainedIds)
    expect(filteredSessions).toHaveLength(1)
    expect(filteredSessions[0]?.groupId).toBeUndefined()
    expect(filteredSessions[0]?.id).toBe('s1')
  })

  it('case 8: empty datasets never crash', () => {
    expect(filterGroupsForExport([], new Set())).toEqual([])
    expect(filterGroupsForExport([], new Set(['anything']))).toEqual([])
    expect(filterSessionsForExport([], new Set(), new Set())).toEqual([])
    expect(filterSessionsForExport([], new Set(['x']), new Set(['y']))).toEqual([])
  })

  it('does not mutate input arrays', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A')]
    const groupsSnapshot = JSON.stringify(groups)
    const sessionsSnapshot = JSON.stringify(sessions)

    filterGroupsForExport(groups, new Set(['A']))
    filterSessionsForExport(sessions, new Set(['s1']), new Set())

    expect(JSON.stringify(groups)).toBe(groupsSnapshot)
    expect(JSON.stringify(sessions)).toBe(sessionsSnapshot)
  })

  it('parent chain walk handles cyclic parentId references defensively', () => {
    const cyclic = [
      { ...makeGroup('A'), parentId: 'B' },
      { ...makeGroup('B'), parentId: 'A' },
    ]
    const filtered = filterGroupsForExport(cyclic, new Set(['A']))
    expect(filtered.map((g) => g.id).sort()).toEqual(['A', 'B'])
  })
})

describe('deriveInitialSelection', () => {
  it('groups + grouped sessions, no orphans → no UNASSIGNED_ID', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A'), makeSession('s2', 'B')]
    const { groupIds, sessionIds } = deriveInitialSelection(groups, sessions)
    expect([...groupIds].sort()).toEqual(['A', 'B'])
    expect(groupIds.has(UNASSIGNED_ID)).toBe(false)
    expect([...sessionIds].sort()).toEqual(['s1', 's2'])
  })

  it('orphan sessions cause UNASSIGNED_ID to be included', () => {
    const groups = [makeGroup('A'), makeGroup('B')]
    const sessions = [makeSession('s1', 'A'), makeSession('s2'), makeSession('s3', 'B')]
    const { groupIds, sessionIds } = deriveInitialSelection(groups, sessions)
    expect(groupIds.has(UNASSIGNED_ID)).toBe(true)
    expect([...groupIds].sort()).toEqual(['A', 'B', UNASSIGNED_ID].sort())
    expect([...sessionIds].sort()).toEqual(['s1', 's2', 's3'])
  })

  it('hidden and system sessions are excluded from sessionIds', () => {
    const groups: SessionGroup[] = []
    const sessions = [
      makeSession('s1'),
      makeSession('s2', undefined, { hidden: true }),
      makeSession('s3', undefined, { system: true }),
    ]
    const { sessionIds } = deriveInitialSelection(groups, sessions)
    expect([...sessionIds]).toEqual(['s1'])
  })
})
