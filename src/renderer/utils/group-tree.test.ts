import type { SessionGroup } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildGroupTree, getGroupPath } from './group-tree'

const g = (id: string, parentId: string | null, sortIndex: number): SessionGroup => ({
  id,
  name: id,
  parentId,
  sortIndex,
  createdAt: 0,
  updatedAt: 0,
})

describe('buildGroupTree', () => {
  it('nests children under parents, sorted by sortIndex at each level', () => {
    const tree = buildGroupTree([g('a', null, 1), g('b', null, 0), g('a1', 'a', 1), g('a0', 'a', 0)])
    expect(tree.map((n) => n.group.id)).toEqual(['b', 'a'])
    const a = tree.find((n) => n.group.id === 'a')!
    expect(a.depth).toBe(1)
    expect(a.children.map((n) => n.group.id)).toEqual(['a0', 'a1'])
    expect(a.children[0].depth).toBe(2)
  })

  it('promotes orphans (missing parent) to the root', () => {
    const tree = buildGroupTree([g('orphan', 'gone', 0), g('root', null, 1)])
    expect(tree.map((n) => n.group.id).sort()).toEqual(['orphan', 'root'])
  })

  it('supports 4 levels of nesting', () => {
    const tree = buildGroupTree([g('l1', null, 0), g('l2', 'l1', 0), g('l3', 'l2', 0), g('l4', 'l3', 0)])
    const l4 = tree[0].children[0].children[0].children[0]
    expect(l4.group.id).toBe('l4')
    expect(l4.depth).toBe(4)
  })
})

describe('getGroupPath', () => {
  const groups = [g('l1', null, 0), g('l2', 'l1', 0), g('l3', 'l2', 0)]
  it('returns the root-to-node path', () => {
    expect(getGroupPath(groups, 'l3').map((x) => x.id)).toEqual(['l1', 'l2', 'l3'])
  })
  it('returns [] for null', () => {
    expect(getGroupPath(groups, null)).toEqual([])
  })
  it('is orphan-safe (stops at a missing parent)', () => {
    expect(getGroupPath([g('x', 'gone', 0)], 'x').map((n) => n.id)).toEqual(['x'])
  })
})
