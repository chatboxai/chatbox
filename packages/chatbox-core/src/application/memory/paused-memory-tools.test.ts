import { describe, expect, it } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import { MessageSchema } from '../../types/session'
import type { Message } from '../../types/session'
import { MemoryService } from './MemoryService'
import { createMemoryToolContext, createPausedMemoryTools } from './paused-memory-tools'

const execution = (toolCallId: string) => ({ toolCallId, messages: [] })

describe('createPausedMemoryTools', () => {
  it('resolves each call from its own persisted destination within a mixed assistant message', async () => {
    const memory = new MemoryService({ storage: new InMemoryKeyValueStorage() })
    await memory.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    const copilotScope = (await memory.getCopilotMemorySelection('tutor')).scope
    const targetMessage = MessageSchema.parse({
      id: 'assistant',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          toolCallId: 'global',
          toolName: 'save_memory',
          state: 'call',
          memoryToolContext: createMemoryToolContext({ type: 'global' }, true),
        },
        {
          type: 'tool-call',
          toolCallId: 'copilot',
          toolName: 'save_memory',
          state: 'call',
          memoryToolContext: createMemoryToolContext(copilotScope, true),
        },
      ],
    })
    await memory.disableCopilotMemory('tutor')
    const { tools } = createPausedMemoryTools({ memory, targetMessage })
    await tools.save_memory.execute?.({ content: 'Global fact' }, execution('global'))
    await tools.save_memory.execute?.({ content: 'Private tutor fact' }, execution('copilot'))
    expect((await memory.listMemories()).map((entry) => entry.content)).toEqual(['Global fact'])
    expect((await memory.listCopilotMemories('tutor')).map((entry) => entry.content)).toEqual(['Private tutor fact'])
    await memory.retireCopilot('tutor')
    await memory.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    expect(await tools.save_memory.execute?.({ content: 'Retired fact' }, execution('copilot'))).toHaveProperty('error')
    expect(await memory.listCopilotMemories('tutor')).toEqual([])
  })

  it.each(['missing', 'disabled', 'wrong-call'])(
    'returns a tool error for %s provenance without writing',
    async (kind) => {
      const memory = new MemoryService({ storage: new InMemoryKeyValueStorage() })
      const targetMessage: Message = {
        id: 'assistant',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            toolName: 'save_memory',
            toolCallId: 'call',
            state: 'call',
            ...(kind === 'missing'
              ? {}
              : { memoryToolContext: createMemoryToolContext({ type: 'global' }, kind !== 'disabled') }),
          },
        ],
      }
      const { tools } = createPausedMemoryTools({ memory, targetMessage })
      expect(
        await tools.save_memory.execute?.(
          { content: 'Unknown fact' },
          execution(kind === 'wrong-call' ? 'different' : 'call')
        )
      ).toHaveProperty('error')
      expect(await tools.delete_memory.execute?.({ id: 'unknown' }, execution('call'))).toHaveProperty('error')
      expect(await memory.listMemories()).toEqual([])
    }
  )
})
