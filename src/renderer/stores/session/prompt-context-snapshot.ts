import {
  type ResolveSessionPromptContextSnapshotOptions,
  resolveSessionPromptContextSnapshot as resolveSnapshot,
} from '@chatbox/core/application/memory'
import {
  captureSessionPromptContextSnapshot,
  listMemoriesForScope,
  sessionPromptContextSnapshotMatchesDirectories,
} from '@/stores/agentPersonaStore'

export type { ResolveSessionPromptContextSnapshotOptions } from '@chatbox/core/application/memory'
export { extractCopilotPersona, sessionPromptContextSnapshotMatchesMemoryState } from '@chatbox/core/application/memory'

export function resolveSessionPromptContextSnapshot(options: ResolveSessionPromptContextSnapshotOptions) {
  return resolveSnapshot(options, {
    listMemoriesForScope,
    capture: captureSessionPromptContextSnapshot,
    matchesDirectories: sessionPromptContextSnapshotMatchesDirectories,
  })
}
