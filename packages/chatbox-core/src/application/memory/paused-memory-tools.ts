import type { ToolSet } from 'ai'
import type { MemoryScope, MemoryToolContext } from '../../types/agent-persona'
import type { Message } from '../../types/session'
import { createMemoryTools, type MemoryToolsPort } from './memory-tools'
import type { MemoryService } from './MemoryService'

export interface PausedMemoryContext {
  targetMessage?: Message
}

export function createMemoryToolContext(scope: MemoryScope, enabled: boolean): MemoryToolContext {
  return {
    version: 1,
    enabled,
    scope:
      scope.type === 'copilot'
        ? {
            type: 'copilot',
            copilotId: scope.copilotId,
            ...(scope.lifecycleToken ? { lifecycleToken: scope.lifecycleToken } : {}),
          }
        : { type: 'global' },
  }
}

/** Each resumed call keeps the destination it had when the model emitted it. */
export function createPausedMemoryTools(
  options: PausedMemoryContext & {
    memory: MemoryToolsPort & Pick<MemoryService, 'copilotMemoryEpoch'>
    languageName?: string
  }
): { tools: ToolSet; description: string } {
  const prepared = createMemoryTools(options)
  const tools: ToolSet = {}
  for (const [name, tool] of Object.entries(prepared.tools)) {
    tools[name] = {
      ...tool,
      execute: async (input, execution) => {
        const matching = options.targetMessage?.contentParts.filter(
          (part) => part.type === 'tool-call' && part.toolCallId === execution.toolCallId && part.toolName === name
        )
        const part = matching?.length === 1 ? matching[0] : undefined
        const context = part?.type === 'tool-call' ? part.memoryToolContext : undefined
        if (!context)
          return {
            error: 'The original memory destination is unavailable. Start a new request to save or delete memory.',
          }
        if (!context.enabled) return { error: 'Memory was disabled for this tool call.' }
        const scope: MemoryScope =
          context.scope.type === 'copilot'
            ? { ...context.scope, epoch: options.memory.copilotMemoryEpoch(context.scope.copilotId) }
            : context.scope
        const bound = createMemoryTools({ ...options, scope }).tools[name]
        return bound.execute?.(input, execution)
      },
    }
  }
  return { ...prepared, tools }
}
