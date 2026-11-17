import {
  type MemoryScope,
  SESSION_PROMPT_CONTEXT_SNAPSHOT_VERSION,
  type SessionPromptContextSnapshot,
} from '../../types/agent-persona'
import type { MemoryService } from './MemoryService'

export async function captureChatMemorySnapshot(
  memory: Pick<MemoryService, 'listMemoriesForScope'>,
  memoryScope: MemoryScope,
  options: { now?: () => number; utcOffsetMinutes?: number } = {}
): Promise<SessionPromptContextSnapshot> {
  const memories = await memory.listMemoriesForScope(memoryScope)
  return {
    version: SESSION_PROMPT_CONTEXT_SNAPSHOT_VERSION,
    soul: '',
    memories,
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: (options.now ?? Date.now)(),
    capturedUtcOffsetMinutes: options.utcOffsetMinutes ?? -new Date().getTimezoneOffset(),
    scope: 'chat',
    ...(memoryScope.type === 'copilot'
      ? {
          memoryCopilotId: memoryScope.copilotId,
          ...(memoryScope.lifecycleToken ? { memoryCopilotLifecycleToken: memoryScope.lifecycleToken } : {}),
        }
      : {}),
  }
}
