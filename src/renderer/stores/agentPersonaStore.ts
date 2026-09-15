import {
  type MemoryScope,
  SESSION_PROMPT_CONTEXT_SNAPSHOT_VERSION,
  type SessionPromptContextSnapshot,
  SOUL_MAX_CHARS,
} from '@shared/types/agent-persona'
import { t } from 'i18next'
import { z } from 'zod'
import { buildWorkspaceInstructions, normalizeWorkspaceDirectory } from '@/packages/model-calls/workspace-instructions'
import platform from '@/platform'
import storage from '@/storage'
import { reloadCopilotDefinitions, rendererMemoryService, withCopilotDefinitionsLock } from './memoryRuntime'

/**
 * Agent persona storage: the user's Soul document and agent-written memories.
 * The Soul and the default memory list are global; copilots with memory enabled
 * keep their own per-copilot memory lists. None of it is per-session: running
 * sessions read these only through the frozen SessionPromptContextSnapshot in
 * session settings, so writes here never disturb an in-flight conversation or
 * its provider prompt cache.
 */

export const AGENT_SOUL_STORAGE_KEY = 'agent-soul'
export { AGENT_MEMORIES_STORAGE_KEY, COPILOT_MEMORIES_STORAGE_KEY } from '@chatbox/core/application/memory'
export { rendererMemoryService } from './memoryRuntime'
// Local device state (not part of AGENT_PERSONA_BACKUP_KEYS): whether the one-time
// automatic local-memory scan has already run on this device.
export const AGENT_MEMORIES_AUTO_SCAN_DONE_KEY = 'agent-memories-auto-scan-done'

const SoulRecordSchema = z.object({
  content: z.string().catch(''),
  updatedAt: z.number().catch(0),
})

type SoulRecord = z.infer<typeof SoulRecordSchema>

/**
 * Seed template, localized with the user's current UI language at first access.
 * Headings, blockquote guidance, and HTML comments are all scaffolding that
 * `extractSoulContent` strips, so an unedited template still falls back to the
 * default persona instead of injecting placeholder text.
 */
export function buildSoulTemplate(): string {
  return `# Soul

> ${t('This file defines who your Chatbox agent is. It is loaded when an agent session starts.')}
> ${t('Keep it short and sharp — operating rules belong in your workspace AGENTS.md, not here.')}

## ${t('Personality & Tone')}

<!-- ${t('e.g. Concise and direct. Has opinions. Skips filler like "Great question!"')} -->

## ${t('Principles')}

<!-- ${t('e.g. Be resourceful before asking. Verify before claiming something is done.')} -->

## ${t('Boundaries')}

<!-- ${t('e.g. Ask before any external or public action. Private things stay private.')} -->
`
}

async function readSoulRecord(): Promise<SoulRecord> {
  // BaseStorage.getItem persists the initialValue on first read, which seeds the
  // localized template exactly once.
  const raw = await storage.getItem<SoulRecord>(
    AGENT_SOUL_STORAGE_KEY,
    { content: buildSoulTemplate(), updatedAt: Date.now() },
    { persistInitialValue: true }
  )
  const parsed = SoulRecordSchema.safeParse(raw)
  return parsed.success ? parsed.data : { content: '', updatedAt: 0 }
}

/**
 * Serialize read-modify-write mutations per storage key. Parallel save_memory
 * tool calls in one step, or a Settings deletion overlapping an agent write,
 * would otherwise both read the same old value and the last full-array write
 * would silently drop the other's change.
 */
function createMutationLock() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const run = chain.then(operation, operation)
    chain = run.catch(() => undefined)
    return run
  }
}

const withSoulLock = createMutationLock()
export function readSoul(): Promise<SoulRecord> {
  return withSoulLock(() => readSoulRecord())
}

async function writeSoulRecord(content: string): Promise<SoulRecord> {
  const record: SoulRecord = {
    content: content.slice(0, SOUL_MAX_CHARS * 2),
    updatedAt: Date.now(),
  }
  await storage.setItemNow(AGENT_SOUL_STORAGE_KEY, record)
  return record
}

export function writeSoul(content: string): Promise<SoulRecord> {
  return withSoulLock(() => writeSoulRecord(content))
}

/** Atomic read-modify-write on the Soul document (virtual-file edit_file path). */
export function updateSoul<E extends { error: string }>(
  updater: (content: string) => string | E
): Promise<{ record: SoulRecord } | E> {
  return withSoulLock(async () => {
    const current = await readSoulRecord()
    const next = updater(current.content)
    if (typeof next !== 'string') return next
    if (next === current.content) return { record: current }
    return { record: await writeSoulRecord(next) }
  })
}

/**
 * The local-memory scan auto-runs only once per device; afterwards it is
 * user-triggered via the "Scan again" button. Marked before the scan starts so
 * a failed first scan still counts as the one automatic attempt.
 */
export async function hasCompletedLocalMemoryAutoScan(): Promise<boolean> {
  const raw = await storage.getItem<boolean>(AGENT_MEMORIES_AUTO_SCAN_DONE_KEY, false)
  return raw === true
}

export async function markLocalMemoryAutoScanCompleted(): Promise<void> {
  await storage.setItemNow(AGENT_MEMORIES_AUTO_SCAN_DONE_KEY, true)
}

export type { AddMemoryResult, ImportMemoriesResult } from '@chatbox/core/application/memory'

export const listMemories = rendererMemoryService.listMemories.bind(rendererMemoryService)
export const addMemory = rendererMemoryService.addMemory.bind(rendererMemoryService)
export const deleteMemory = rendererMemoryService.deleteMemory.bind(rendererMemoryService)
export const importMemories = rendererMemoryService.importMemories.bind(rendererMemoryService)
export const copilotMemoryEpoch = rendererMemoryService.copilotMemoryEpoch.bind(rendererMemoryService)
export const listAllCopilotMemories = rendererMemoryService.listAllCopilotMemories.bind(rendererMemoryService)
export const listCopilotMemories = rendererMemoryService.listCopilotMemories.bind(rendererMemoryService)
export const addCopilotMemory = rendererMemoryService.addCopilotMemory.bind(rendererMemoryService)
export const deleteCopilotMemory = rendererMemoryService.deleteCopilotMemory.bind(rendererMemoryService)
export const clearCopilotMemories = rendererMemoryService.clearCopilotMemories.bind(rendererMemoryService)
export const retireCopilotMemories = rendererMemoryService.retireCopilotMemories.bind(rendererMemoryService)
export const listMemoriesForScope = rendererMemoryService.listMemoriesForScope.bind(rendererMemoryService)
export const addMemoryForScope = rendererMemoryService.addMemoryForScope.bind(rendererMemoryService)
export const deleteMemoryForScope = rendererMemoryService.deleteMemoryForScope.bind(rendererMemoryService)

function normalizedDirectories(workingDirectories: string[] | undefined): string[] {
  return [
    ...new Set((workingDirectories ?? []).map(normalizeWorkspaceDirectory).filter((directory) => directory.length > 0)),
  ]
}

/** Capture a fresh frozen snapshot of the persona prompt inputs for a session. */
export async function captureSessionPromptContextSnapshot(
  workingDirectories: string[] | undefined,
  scope: 'chat' | 'agent',
  memoryScope: MemoryScope = { type: 'global' }
): Promise<SessionPromptContextSnapshot> {
  const directories = normalizedDirectories(workingDirectories)
  const [soul, memories, workspaceInstructions, commandPlatform] = await Promise.all([
    readSoul(),
    listMemoriesForScope(memoryScope),
    buildWorkspaceInstructions(workingDirectories),
    scope === 'agent' ? platform.getPlatform().catch(() => undefined) : Promise.resolve(undefined),
  ])
  const desktopCommandContract =
    commandPlatform === 'darwin' || commandPlatform === 'linux' || commandPlatform === 'win32'
  return {
    version: SESSION_PROMPT_CONTEXT_SNAPSHOT_VERSION,
    soul: soul.content,
    memories,
    ...(memoryScope.type === 'copilot'
      ? {
          memoryCopilotId: memoryScope.copilotId,
          ...(memoryScope.lifecycleToken ? { memoryCopilotLifecycleToken: memoryScope.lifecycleToken } : {}),
        }
      : {}),
    workspaceInstructions,
    workspaceDirectories: directories,
    capturedAt: Date.now(),
    capturedUtcOffsetMinutes: -new Date().getTimezoneOffset(),
    scope,
    ...(scope === 'agent' ? { agentToolContractVersion: desktopCommandContract ? (2 as const) : (1 as const) } : {}),
  }
}

/** Serialize backup import (or similar bulk writes) against agent persona mutations. */
export function withAgentPersonaLocks<T>(operation: () => Promise<T>): Promise<T> {
  return withCopilotDefinitionsLock(() =>
    withSoulLock(() =>
      rendererMemoryService.withStorageLock(async ({ reload }) => {
        const result = await operation().then(
          (value) => ({ ok: true, value }) as const,
          (error: unknown) => ({ ok: false, error }) as const
        )
        const refreshed = await Promise.allSettled([reloadCopilotDefinitions(), reload()])
        if (!result.ok) throw result.error
        const failure = refreshed.find((item) => item.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        return result.value
      })
    )
  )
}

/**
 * Whether an existing snapshot still applies to the session's current working
 * directories. Directory changes are user-explicit, so the snapshot is re-captured
 * (an acceptable, intentional prompt-cache break).
 */
export function sessionPromptContextSnapshotMatchesDirectories(
  snapshot: SessionPromptContextSnapshot,
  workingDirectories: string[] | undefined
): boolean {
  const directories = normalizedDirectories(workingDirectories)
  return (
    snapshot.workspaceDirectories.length === directories.length &&
    snapshot.workspaceDirectories.every((dir, index) => dir === directories[index])
  )
}
