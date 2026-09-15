import {
  createMemoryTools,
  createPausedMemoryTools,
  type MemoryToolsOptions,
  type PausedMemoryContext,
} from '@chatbox/core/application/memory'
import { addMemoryForScope, copilotMemoryEpoch, deleteMemoryForScope } from '@/stores/agentPersonaStore'

export type AgentMemoryToolsOptions = Omit<MemoryToolsOptions, 'memory'>

export function buildAgentMemoryTools(options: AgentMemoryToolsOptions = {}) {
  return createMemoryTools({ ...options, memory: { addMemoryForScope, deleteMemoryForScope } })
}

export function buildPausedAgentMemoryTools(options: PausedMemoryContext & { languageName?: string }) {
  return createPausedMemoryTools({
    ...options,
    memory: { addMemoryForScope, deleteMemoryForScope, copilotMemoryEpoch },
  })
}
