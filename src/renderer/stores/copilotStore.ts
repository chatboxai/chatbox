import type { CopilotMemoryOwner, CopilotMemorySelection } from '@chatbox/core/application/memory'
import type { MemoryScope, SessionPromptContextSnapshot } from '@shared/types/agent-persona'
import { rendererMemoryService } from './memoryRuntime'

export {
  COPILOT_MEMORY_OWNERS_STORAGE_KEY,
  COPILOT_MEMORY_TOKENS_STORAGE_KEY,
  type CopilotMemoryOwner,
  type CopilotMemorySelection,
} from '@chatbox/core/application/memory'
export {
  addOrUpdateMyCopilot,
  copilotMemoryOwnersAtom,
  copilotMemoryTokensAtom,
  getCopilotName,
  myCopilotsAtom,
  removeMyCopilot,
} from './memoryRuntime'

/**
 * Give a copilot its own memory list. Ownership is tracked per copilot id rather
 * than on the My Copilots entry, so a copilot used straight from the store — or a
 * built-in one that was never saved — keeps memories just the same.
 */
export function enableCopilotMemory(owner: CopilotMemoryOwner): Promise<void> {
  return rendererMemoryService.livePreferences.enable(owner)
}

/** Fall back to global memory; the copilot's own entries stay for a later re-enable. */
export function disableCopilotMemory(copilotId: string): Promise<void> {
  return rendererMemoryService.livePreferences.disable(copilotId)
}

/** Wait for persisted ownership before initializing an editable UI draft. */
export function readCopilotMemoryEnabled(copilotId: string): Promise<boolean> {
  return rendererMemoryService.livePreferences.isEnabled(copilotId)
}

/** Resolve the live Copilot memory source and its opaque state token in one read. */
export function getCopilotMemorySelection(copilotId: string | undefined): Promise<CopilotMemorySelection> {
  return rendererMemoryService.livePreferences.select(copilotId)
}

/**
 * Resolve the scope for a call produced by an earlier generation and only now being
 * executed. A tool call paused on the step limit is continued whenever the user gets
 * around to it — the app may have restarted in between — so the store the
 * conversation froze wins over the one the session resolves to today: resolving live
 * would let a copilot's `save_memory` land in global memory once that copilot is
 * deleted or its memory switched off, and would pull a global conversation into a
 * copilot list that only gained its own memory afterwards.
 *
 * An ordinary global-memory chat may have no snapshot while its store is empty; there
 * the session's current scope is the whole record.
 */
export function getPausedCallMemoryScope(
  snapshot: SessionPromptContextSnapshot | undefined,
  sessionCopilotId: string | undefined
): Promise<MemoryScope> {
  return rendererMemoryService.livePreferences.pausedScope(snapshot, sessionCopilotId)
}

/** Resolve the live memory scope before generation, including UI changes whose persistence is still pending. */
export async function getCopilotMemoryScope(copilotId: string | undefined): Promise<MemoryScope> {
  return (await getCopilotMemorySelection(copilotId)).scope
}
