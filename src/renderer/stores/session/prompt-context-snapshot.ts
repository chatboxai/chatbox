import { boundCopilotPersona } from '@shared/agent-persona/prompt'
import type { Message, SessionPromptContextSnapshot, SessionSettings } from '@shared/types'
import type { MemoryScope } from '@shared/types/agent-persona'
import { getMessageText } from '@shared/utils/message'
import {
  captureSessionPromptContextSnapshot,
  listMemoriesForScope,
  sessionPromptContextSnapshotMatchesDirectories,
} from '@/stores/agentPersonaStore'

export interface ResolveSessionPromptContextSnapshotOptions {
  effectiveAgentMode: 'on' | 'off'
  /** Effective memory switch for this request (global or the session Copilot's). */
  memoryEnabled: boolean
  /** Opaque token for the selected source's effective setting. */
  memoryStateToken?: string
  /** Which memory store this session reads; defaults to the global one. */
  memoryScope?: MemoryScope
  settings: SessionSettings
  messages: Message[]
  targetMsgIx: number
  persist?: (snapshot: SessionPromptContextSnapshot) => void
  /** When set, the session system prompt is frozen into Soul as a Copilot overlay. */
  copilotId?: string
}

export function extractCopilotPersona(messages: Message[], targetMsgIx: number): string | undefined {
  const systemMessage = messages.slice(0, targetMsgIx).find((message) => message.role === 'system')
  const text = systemMessage ? getMessageText(systemMessage, false, false) : ''
  return boundCopilotPersona(text)
}

/** Whether a snapshot's memories came from the store the session currently uses. */
export function sessionPromptContextSnapshotMatchesMemoryState(
  snapshot: SessionPromptContextSnapshot,
  memoryScope: MemoryScope,
  memoryEnabled: boolean,
  memoryStateToken: string
): boolean {
  const matchesScope =
    memoryScope.type === 'copilot'
      ? snapshot.memoryCopilotId === memoryScope.copilotId
      : snapshot.memoryCopilotId === undefined
  return (
    matchesScope &&
    (snapshot.memoryEnabled ?? true) === memoryEnabled &&
    (snapshot.memoryStateToken ?? '') === memoryStateToken
  )
}

function setSnapshotMemoryState(
  snapshot: SessionPromptContextSnapshot,
  memoryEnabled: boolean,
  memoryStateToken: string
): SessionPromptContextSnapshot {
  return {
    ...snapshot,
    memories: memoryEnabled ? snapshot.memories : [],
    memoryEnabled,
    memoryStateToken,
  }
}

async function reloadSnapshotMemories(
  snapshot: SessionPromptContextSnapshot,
  memoryScope: MemoryScope,
  memoryEnabled: boolean,
  memoryStateToken: string
): Promise<SessionPromptContextSnapshot> {
  const memories = memoryEnabled ? await listMemoriesForScope(memoryScope) : []
  const reloaded = { ...snapshot, memories, memoryEnabled, memoryStateToken }
  if (memoryScope.type === 'copilot') reloaded.memoryCopilotId = memoryScope.copilotId
  else delete reloaded.memoryCopilotId
  return reloaded
}

function anchorSnapshotToStartedConversation(
  snapshot: SessionPromptContextSnapshot,
  messages: Message[]
): SessionPromptContextSnapshot {
  const capturedAt = messages[0]?.timestamp
  if (capturedAt === undefined) return snapshot
  const anchored = { ...snapshot, capturedAt }
  delete anchored.capturedUtcOffsetMinutes
  return anchored
}

/**
 * Resolve the frozen prompt-context snapshot (Soul + Copilot overlay + memories +
 * workspace AGENTS.md) for one generation. Captured once and reused verbatim
 * afterwards so the system prompt prefix stays byte-stable for provider caches.
 *
 * Agent mode: only trusts 'agent'-scoped snapshots — a chat-scoped one was
 * captured before the session's first agent generation, and Soul edits made in
 * between must still apply (missing scope means a pre-scope agent snapshot).
 * Working-directory changes re-capture the full snapshot. Memory setting
 * changes reload only its memory slice, leaving the frozen Soul and workspace
 * instructions intact.
 *
 * Chat mode: reads memories (no Soul/identity) through the same snapshot and
 * accepts either scope. Capture happens only at conversation start (before the
 * first assistant turn) and only when memories exist for ordinary global-memory
 * chats. Copilot chats and memory-off chats also keep an empty snapshot so a
 * later setting change can be detected. Memories appearing mid-conversation,
 * including ones this very session just saved via save_memory, apply to future
 * conversations only. Explicitly switching memory state is the exception: the
 * next generation reloads the selected store's latest memories while keeping the
 * rest of the conversation-start snapshot frozen.
 */
export async function resolveSessionPromptContextSnapshot(
  options: ResolveSessionPromptContextSnapshotOptions
): Promise<SessionPromptContextSnapshot | undefined> {
  const {
    effectiveAgentMode,
    memoryEnabled,
    memoryStateToken = '',
    settings,
    messages,
    targetMsgIx,
    persist,
    copilotId,
  } = options
  const memoryScope = options.memoryScope ?? { type: 'global' }
  const existing = settings.sessionPromptContextSnapshot

  if (effectiveAgentMode === 'on') {
    const existingAgentSnapshotMatches =
      existing &&
      (existing.scope ?? 'agent') === 'agent' &&
      sessionPromptContextSnapshotMatchesDirectories(existing, settings.workingDirectories)
    if (existingAgentSnapshotMatches) {
      if (sessionPromptContextSnapshotMatchesMemoryState(existing, memoryScope, memoryEnabled, memoryStateToken)) {
        return existing
      }
      const reloaded = await reloadSnapshotMemories(existing, memoryScope, memoryEnabled, memoryStateToken)
      persist?.(reloaded)
      return reloaded
    }
    const hasLegacyCommandHistory = messages
      .slice(0, targetMsgIx)
      .some((message) =>
        message.contentParts.some(
          (part) => part.type === 'tool-call' && (part.toolName === 'user_exec' || part.toolName === 'code_execution')
        )
      )
    const captured = setSnapshotMemoryState(
      await captureSessionPromptContextSnapshot(settings.workingDirectories, 'agent', memoryScope),
      memoryEnabled,
      memoryStateToken
    )
    const copilotPersona = copilotId ? extractCopilotPersona(messages, targetMsgIx) : undefined
    const snapshot = {
      ...captured,
      agentToolContractVersion:
        existing?.agentToolContractVersion ??
        (hasLegacyCommandHistory ? (1 as const) : (captured.agentToolContractVersion ?? (1 as const))),
      ...(copilotPersona ? { copilotPersona } : {}),
    }
    persist?.(snapshot)
    return snapshot
  }

  const isConversationStart = !messages.slice(0, targetMsgIx).some((message) => message.role === 'assistant')
  if (existing) {
    if (sessionPromptContextSnapshotMatchesMemoryState(existing, memoryScope, memoryEnabled, memoryStateToken)) {
      return existing
    }
    // Switching stores is user-explicit, so reload that store's latest memories.
    // Keep the rest of the snapshot anchored: re-capturing it would also change
    // the frozen date, Soul, and workspace instructions.
    const reloaded = await reloadSnapshotMemories(existing, memoryScope, memoryEnabled, memoryStateToken)
    persist?.(reloaded)
    return reloaded
  }
  const needsMemoryStateSnapshot = Boolean(
    copilotId || memoryScope.type === 'copilot' || !memoryEnabled || memoryStateToken !== ''
  )
  if (
    needsMemoryStateSnapshot ||
    (memoryEnabled && isConversationStart && (await listMemoriesForScope(memoryScope)).length > 0)
  ) {
    let snapshot = setSnapshotMemoryState(
      await captureSessionPromptContextSnapshot(settings.workingDirectories, 'chat', memoryScope),
      memoryEnabled,
      memoryStateToken
    )
    if (!isConversationStart) {
      snapshot = anchorSnapshotToStartedConversation(snapshot, messages)
      if (memoryStateToken === '') snapshot = { ...snapshot, memories: [] }
    }
    persist?.(snapshot)
    return snapshot
  }
  return undefined
}
