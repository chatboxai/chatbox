import { z } from 'zod'

/** Max characters of Soul content injected into the system prompt (truncated with a marker beyond this). */
export const SOUL_MAX_CHARS = 16_000
/** Max characters of a Copilot prompt in the editor, snapshot, and Soul overlay. */
export const COPILOT_PROMPT_MAX_CHARS = 40_000
/** Max number of stored memory entries. */
export const MEMORY_MAX_ENTRIES = 100
/** Max characters for a single memory entry. */
export const MEMORY_ENTRY_MAX_CHARS = 1_000
/** Max total characters of memory content injected into the system prompt. */
export const MEMORY_PROMPT_MAX_CHARS = 8_000

export const MEMORY_STATE_TOKEN_MAX_CHARS = 128
export const EFFECTIVE_MEMORY_STATE_TOKEN_MAX_CHARS = MEMORY_STATE_TOKEN_MAX_CHARS * 2 + 1
let fallbackMemoryStateTokenSequence = 0

export function isMemoryStateToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MEMORY_STATE_TOKEN_MAX_CHARS &&
    /^[A-Za-z0-9-]+$/.test(value)
  )
}

export function createMemoryStateToken(): string {
  const runtimeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof runtimeCrypto?.randomUUID === 'function') return runtimeCrypto.randomUUID()
  fallbackMemoryStateTokenSequence++
  return `${Date.now().toString(36)}-${fallbackMemoryStateTokenSequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Combine the Copilot and Global source versions without variable-size escaping. */
export function combineMemoryStateTokens(first: unknown, second: unknown): string {
  const tokens = [first, second].map((value) => (isMemoryStateToken(value) ? value : ''))
  return tokens.every((token) => token === '') ? '' : `${tokens[0]}:${tokens[1]}`
}

export interface CopilotMemoryStateToken {
  id: string
  token: string
}

export function parseCopilotMemoryStateTokens(value: unknown): CopilotMemoryStateToken[] {
  if (!Array.isArray(value)) return []
  const tokens = new Map<string, string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !isMemoryStateToken(record.token)) continue
    tokens.set(record.id, record.token)
  }
  return Array.from(tokens, ([id, token]) => ({ id, token }))
}

export const MemoryEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.number(),
})

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

/**
 * Which memory store a session reads and writes: the global list, or the own
 * list of the copilot the session was created from (a copilot with memory
 * enabled replaces global memory for its sessions).
 *
 * `epoch` pins which incarnation of the copilot id the scope was resolved
 * against, so a write issued later in the generation cannot land in the list of
 * whichever copilot holds the id by then — a remote copilot keeps its id across
 * remove and re-add.
 */
export type MemoryScope = { type: 'global' } | { type: 'copilot'; copilotId: string; epoch: number }

/**
 * Frozen per-conversation snapshot of the reusable prompt-context inputs. It is
 * captured when the conversation first needs Soul, memories, or workspace
 * instructions. Mid-conversation edits update their source storage but never mutate
 * the snapshot, so the provider-side prompt cache prefix stays stable. A new thread
 * clears the snapshot and re-captures on the next generation.
 */
export const SessionPromptContextSnapshotSchema = z.object({
  version: z.number(),
  soul: z.string(),
  memories: z.array(MemoryEntrySchema),
  // Copilot whose memory list the memories above were captured from. Missing
  // means they came from the global list. A session whose memory scope no longer
  // matches its snapshot (copilot memory toggled) reloads the snapshot's memory
  // slice from the newly selected source.
  memoryCopilotId: z.string().optional().catch(undefined),
  // Whether memories were enabled when this snapshot's memory slice was last
  // resolved. Missing is interpreted as enabled.
  memoryEnabled: z.boolean().optional().catch(undefined),
  // Opaque version of the selected memory source when its slice was resolved.
  // Missing is interpreted as the initial state.
  memoryStateToken: z.string().max(EFFECTIVE_MEMORY_STATE_TOKEN_MAX_CHARS).optional().catch(undefined),
  workspaceInstructions: z.string(),
  // The working directories the workspace instructions were captured for. When the
  // session's directories change, the workspace part is re-captured (user-explicit
  // change, an acceptable cache break).
  workspaceDirectories: z.array(z.string()),
  capturedAt: z.number(),
  // Device UTC offset (minutes east of UTC) at capture time. Freezing it keeps
  // the system prompt's "started/captured" line byte-stable for provider caches
  // even after the device moves to another timezone; the live timezone reaches
  // the model through time `<system-reminder>`s instead. Missing on snapshots
  // captured before this field existed — those derive the offset at render time.
  capturedUtcOffsetMinutes: z.number().optional().catch(undefined),
  // Which mode captured the snapshot. Agent mode only trusts 'agent'-scoped
  // snapshots (a chat-scoped one predates "first agent generation", so Soul
  // edits made before enabling Work Mode must still apply); chat mode accepts
  // both. Missing scope means a pre-scope agent-mode snapshot.
  scope: z.enum(['chat', 'agent']).optional().catch(undefined),
  // The model-facing command-tool contract is frozen with the thread because the
  // snapshot already follows thread switching/new-thread lifecycle semantics.
  // Missing means a pre-run_command thread and is treated as the legacy v1 contract.
  agentToolContractVersion: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .catch(undefined),
  // Copilot prompt captured for this conversation, capped at
  // COPILOT_PROMPT_MAX_CHARS. Missing means no Copilot (or a snapshot from
  // before this field existed). Chat-scoped snapshots never set it — chat mode
  // already sends the session system prompt as its own message.
  copilotPersona: z.string().optional().catch(undefined),
})

export type SessionPromptContextSnapshot = z.infer<typeof SessionPromptContextSnapshotSchema>

export const SESSION_PROMPT_CONTEXT_SNAPSHOT_VERSION = 1

/**
 * Virtual path exposing the Soul document to file tools (read_file / write_file /
 * edit_file). Backed by app storage, not the filesystem; the explicit scheme avoids
 * colliding with real SOUL.md files in user directories.
 */
export const SOUL_VIRTUAL_PATH = 'chatbox://SOUL.md'
