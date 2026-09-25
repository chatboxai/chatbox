import { asSchema } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import { MemoryService } from './MemoryService'
import { createMemoryTools } from './memory-tools'

const execution = { toolCallId: 'memory-call', messages: [], context: undefined }

describe('memory tools', () => {
  it.each([
    {
      name: 'save_memory',
      valid: { content: 'Prefers short answers' },
      invalid: [{}, { content: 42 }, { content: 'Fact', extra: true }],
    },
    { name: 'delete_memory', valid: { id: 'saved-id' }, invalid: [{}, { id: 42 }, { id: 'saved-id', extra: true }] },
  ])('validates $name arguments before execution', async ({ name, valid, invalid }) => {
    const memory = new MemoryService({ storage: new InMemoryKeyValueStorage() })
    const { tools } = createMemoryTools({ memory })
    const schema = asSchema(tools[name].inputSchema)
    expect(await schema.validate?.(valid)).toEqual({ success: true, value: valid })
    for (const input of invalid) {
      const result = await schema.validate?.(input)
      expect(result?.success).toBe(false)
      if (result && !result.success) expect(result.error.message).toContain('Tool was not executed')
    }
    expect(await memory.listMemories()).toEqual([])
  })

  it('distinguishes deletion in the current library from a missing id', async () => {
    const memory = new MemoryService({ storage: new InMemoryKeyValueStorage() })
    await memory.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    const scope = (await memory.getCopilotMemorySelection('tutor')).scope
    const added = await memory.addMemoryForScope(scope, 'Outdated preference')
    if (!added.ok) throw new Error('Memory setup failed')
    const { tools } = createMemoryTools({ memory, scope })

    await expect(tools.delete_memory.execute?.({ id: added.entry.id }, execution)).resolves.toEqual({
      message: `Memory ${added.entry.id} deleted.`,
    })
    await expect(tools.delete_memory.execute?.({ id: added.entry.id }, execution)).resolves.toEqual({
      error: `No memory found with id ${added.entry.id}.`,
    })
    expect(await memory.listCopilotMemories('tutor')).toEqual([])
  })

  it('returns the same unavailable-context error for an old save and delete without touching the new library', async () => {
    const storage = new InMemoryKeyValueStorage()
    const memory = new MemoryService({ storage, createId: () => 'same-id' })
    const owner = { id: 'tutor', name: 'Tutor' }
    await memory.enableCopilotMemory(owner)
    const scope = (await memory.getCopilotMemorySelection(owner.id)).scope
    const { tools } = createMemoryTools({ memory, scope })
    await memory.retireCopilot(owner.id)
    await memory.enableCopilotMemory(owner)
    await memory.addCopilotMemory(owner.id, 'Current preference')
    const write = vi.spyOn(storage, 'set')

    const deleted = await tools.delete_memory.execute?.({ id: 'same-id' }, execution)
    expect(deleted).toEqual({
      error: 'The memory context for this call is no longer available. Start a new generation.',
    })
    expect(memory.getSnapshot().error).toBeNull()
    await expect(tools.save_memory.execute?.({ content: 'Outdated preference' }, execution)).resolves.toEqual(deleted)
    expect(write).not.toHaveBeenCalled()
    expect((await memory.listCopilotMemories(owner.id)).map((entry) => entry.content)).toEqual(['Current preference'])
    await expect(memory.deleteCopilotMemory(owner.id, 'same-id')).resolves.toBe(true)
    await expect(memory.addCopilotMemory(owner.id, 'Updated preference')).resolves.toMatchObject({ ok: true })
    expect(memory.getSnapshot()).toMatchObject({
      error: null,
      copilotMemories: { tutor: [{ content: 'Updated preference' }] },
    })
  })

  it('propagates a storage failure and preserves the memory entry', async () => {
    const storage = new InMemoryKeyValueStorage()
    const memory = new MemoryService({ storage })
    const added = await memory.addMemory('Saved preference')
    if (!added.ok) throw new Error('Memory setup failed')
    const failure = new Error('Storage write failed')
    vi.spyOn(storage, 'set').mockRejectedValueOnce(failure)
    const { tools } = createMemoryTools({ memory })

    await expect(tools.delete_memory.execute?.({ id: added.entry.id }, execution)).rejects.toBe(failure)
    expect(memory.getSnapshot().error).toBe(failure)
    expect(await memory.listMemories()).toEqual([added.entry])
  })
})
