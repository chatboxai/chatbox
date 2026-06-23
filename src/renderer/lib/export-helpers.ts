import type { SessionGroup, SessionMeta } from '@shared/types'

export const UNASSIGNED_ID = '__unassigned__'

/**
 * Filter groups for export based on user selection, preserving the parent chain
 * of every kept group so dangling parentId references cannot occur in the export.
 *
 * The reserved {@link UNASSIGNED_ID} sentinel is ignored here — it is not a real
 * group id and only appears in selection state for the unassigned bucket.
 *
 * Returned array keeps the original order from {@link allGroups} (stable).
 */
export function filterGroupsForExport(
  allGroups: SessionGroup[],
  selectedGroupIds: Set<string>,
): SessionGroup[] {
  if (allGroups.length === 0) {
    return []
  }

  const byId = new Map<string, SessionGroup>()
  for (const g of allGroups) {
    byId.set(g.id, g)
  }

  const retained = new Set<string>()
  const visited = new Set<string>()

  for (const group of allGroups) {
    if (group.id === UNASSIGNED_ID) {
      continue
    }
    if (!selectedGroupIds.has(group.id)) {
      continue
    }
    let cursor: SessionGroup | undefined = group
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      retained.add(cursor.id)
      const parentId = cursor.parentId
      if (parentId === null || parentId === undefined) {
        break
      }
      cursor = byId.get(parentId)
    }
  }

  const result: SessionGroup[] = []
  for (const g of allGroups) {
    if (retained.has(g.id)) {
      result.push(g)
    }
  }
  return result
}

/**
 * Filter sessions for export, clearing groupId on any session whose group was
 * deselected by the user (the session itself was kept). Such sessions land in
 * the unassigned bucket on the import side.
 *
 * @param retainedGroupIds The id set of groups returned by
 *   {@link filterGroupsForExport}; required so we can tell which groupId values
 *   are still valid post-filter.
 */
export function filterSessionsForExport(
  allMetas: SessionMeta[],
  selectedSessionIds: Set<string>,
  retainedGroupIds: Set<string>,
): SessionMeta[] {
  const result: SessionMeta[] = []
  for (const meta of allMetas) {
    if (!selectedSessionIds.has(meta.id)) {
      continue
    }
    if (meta.groupId !== undefined && !retainedGroupIds.has(meta.groupId)) {
      const cleared = { ...meta }
      cleared.groupId = undefined
      result.push(cleared)
    } else {
      result.push({ ...meta })
    }
  }
  return result
}

/**
 * Compute the default selection state for the export UI: every group + every
 * non-system, non-hidden session is selected. The {@link UNASSIGNED_ID}
 * sentinel is added when at least one orphan session exists.
 */
export function deriveInitialSelection(
  groups: SessionGroup[],
  sessions: SessionMeta[],
): { groupIds: Set<string>; sessionIds: Set<string> } {
  const groupIds = new Set<string>()
  for (const g of groups) {
    groupIds.add(g.id)
  }

  const sessionIds = new Set<string>()
  let hasOrphan = false
  for (const s of sessions) {
    if (s.groupId === undefined || s.groupId === null) {
      hasOrphan = true
    }
    if (s.hidden === true) {
      continue
    }
    if (s.system === true) {
      continue
    }
    sessionIds.add(s.id)
  }

  if (hasOrphan) {
    groupIds.add(UNASSIGNED_ID)
  }

  return { groupIds, sessionIds }
}
