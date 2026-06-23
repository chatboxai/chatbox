import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(async (input: { name: string; parentId?: string | null }) => ({
    id: `group:real-${input.name}`,
    name: input.name,
    parentId: input.parentId ?? null,
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
  })),
  moveSessionToGroup: vi.fn(async () => undefined),
}))

vi.mock('../groupStore', () => ({ createGroup: mocks.createGroup }))
vi.mock('../sessionActions', () => ({ moveSessionToGroup: mocks.moveSessionToGroup }))

import { applyProposal, noOpStrategy } from './auto-organize'

describe('auto-organize', () => {
  it('noOpStrategy returns empty moves', async () => {
    const r = await noOpStrategy.generate({ groups: [], sessions: [] })
    expect(r).toEqual({ moves: [] })
  })

  it('applyProposal creates new groups and routes moves through resolved real ids', async () => {
    await applyProposal({
      moves: [
        { sessionId: 'sess-1', targetGroupId: 'temp-A' },
        { sessionId: 'sess-2', targetGroupId: 'group:existing' },
        { sessionId: 'sess-3', targetGroupId: null },
      ],
      newGroups: [{ tempId: 'temp-A', name: 'Work', parentId: null }],
    })

    expect(mocks.createGroup).toHaveBeenCalledWith({ name: 'Work', parentId: null })
    expect(mocks.moveSessionToGroup).toHaveBeenCalledWith('sess-1', 'group:real-Work')
    expect(mocks.moveSessionToGroup).toHaveBeenCalledWith('sess-2', 'group:existing')
    expect(mocks.moveSessionToGroup).toHaveBeenCalledWith('sess-3', null)
  })
})
