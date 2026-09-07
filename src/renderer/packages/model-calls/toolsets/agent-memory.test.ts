import { beforeEach, describe, expect, test, vi } from 'vitest'

const { addMemoryForScope, deleteMemoryForScope } = vi.hoisted(() => ({
  addMemoryForScope: vi.fn(),
  deleteMemoryForScope: vi.fn(),
}))

vi.mock('@/stores/agentPersonaStore', () => ({ addMemoryForScope, deleteMemoryForScope }))

import { buildAgentMemoryTools } from './agent-memory'

describe('buildAgentMemoryTools', () => {
  beforeEach(() => {
    addMemoryForScope.mockReset()
    deleteMemoryForScope.mockReset()
  })

  test('writes to the global store by default', async () => {
    addMemoryForScope.mockResolvedValue({ ok: true, entry: { id: 'm1', content: 'fact', createdAt: 1 } })
    deleteMemoryForScope.mockResolvedValue(true)
    const { tools, description } = buildAgentMemoryTools()

    await tools.save_memory.execute?.({ content: 'fact' }, {} as never)
    expect(addMemoryForScope).toHaveBeenCalledWith({ type: 'global' }, 'fact')

    await tools.delete_memory.execute?.({ id: 'm1' }, {} as never)
    expect(deleteMemoryForScope).toHaveBeenCalledWith({ type: 'global' }, 'm1')
    expect(description).not.toContain('assistant persona')
  })

  test('writes to the copilot store when given a copilot scope', async () => {
    addMemoryForScope.mockResolvedValue({ ok: true, entry: { id: 'm1', content: 'fact', createdAt: 1 } })
    deleteMemoryForScope.mockResolvedValue(true)
    const scope = { type: 'copilot', copilotId: 'cp1', epoch: 0 } as const
    const { tools, description } = buildAgentMemoryTools({ scope })

    await tools.save_memory.execute?.({ content: 'fact' }, {} as never)
    expect(addMemoryForScope).toHaveBeenCalledWith(scope, 'fact')

    await tools.delete_memory.execute?.({ id: 'm1' }, {} as never)
    expect(deleteMemoryForScope).toHaveBeenCalledWith(scope, 'm1')
    expect(description).toContain('assistant persona')
  })

  test('forwards the epoch the scope was resolved against', async () => {
    addMemoryForScope.mockResolvedValue({ ok: true, entry: { id: 'm1', content: 'fact', createdAt: 1 } })
    const scope = { type: 'copilot', copilotId: 'cp1', epoch: 3 } as const
    const { tools } = buildAgentMemoryTools({ scope })

    await tools.save_memory.execute?.({ content: 'fact' }, {} as never)
    expect(addMemoryForScope).toHaveBeenCalledWith(scope, 'fact')
  })
})
