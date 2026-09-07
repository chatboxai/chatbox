import {
  MEMORY_ENTRY_MAX_CHARS,
  MEMORY_MAX_ENTRIES,
  type MemoryEntry,
  MemoryEntrySchema,
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

/**
 * Agent persona storage: the user's Soul document and agent-written memories.
 * The Soul and the default memory list are global; copilots with memory enabled
 * keep their own per-copilot memory lists. None of it is per-session: running
 * sessions read these only through the frozen SessionPromptContextSnapshot in
 * session settings, so writes here never disturb an in-flight conversation or
 * its provider prompt cache.
 */

export const AGENT_SOUL_STORAGE_KEY = 'agent-soul'
export const AGENT_MEMORIES_STORAGE_KEY = 'agent-memories'
/** Per-copilot memory lists, stored as one { [copilotId]: MemoryEntry[] } record. */
export const COPILOT_MEMORIES_STORAGE_KEY = 'copilot-memories'
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

export async function readSoul(): Promise<SoulRecord> {
  // BaseStorage.getItem persists the initialValue on first read, which seeds the
  // localized template exactly once.
  const raw = await storage.getItem<SoulRecord>(AGENT_SOUL_STORAGE_KEY, {
    content: buildSoulTemplate(),
    updatedAt: Date.now(),
  })
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
const withMemoriesLock = createMutationLock()
const withCopilotMemoriesLock = createMutationLock()

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
export function updateSoul(
  updater: (content: string) => string | { error: string }
): Promise<{ record: SoulRecord } | { error: string }> {
  return withSoulLock(async () => {
    const current = await readSoul()
    const next = updater(current.content)
    if (typeof next !== 'string') return next
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

const MemoriesRecordSchema = z.array(MemoryEntrySchema).catch([])

export async function listMemories(): Promise<MemoryEntry[]> {
  const raw = await storage.getItem<MemoryEntry[]>(AGENT_MEMORIES_STORAGE_KEY, [])
  return MemoriesRecordSchema.parse(raw)
}

function generateMemoryId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export type AddMemoryResult = { ok: true; entry: MemoryEntry } | { ok: false; error: string }

export interface ImportMemoriesResult {
  imported: number
  skippedDuplicate: number
  skippedEmpty: number
  skippedTooLong: number
  skippedLimit: number
}

/** Validate one addition against an existing list and mint the entry (shared by global and copilot stores). */
function buildMemoryAddition(memories: MemoryEntry[], content: string): { entry: MemoryEntry } | { error: string } {
  const trimmed = content.trim()
  if (!trimmed) {
    return { error: 'Memory content is empty.' }
  }
  if (trimmed.length > MEMORY_ENTRY_MAX_CHARS) {
    return { error: `Memory content exceeds ${MEMORY_ENTRY_MAX_CHARS} characters. Save a shorter fact.` }
  }
  if (memories.some((entry) => entry.content === trimmed)) {
    return { error: 'An identical memory already exists.' }
  }
  if (memories.length >= MEMORY_MAX_ENTRIES) {
    return {
      error: `Memory limit of ${MEMORY_MAX_ENTRIES} entries reached. Delete stale entries with delete_memory first.`,
    }
  }
  return { entry: { id: generateMemoryId(), content: trimmed, createdAt: Date.now() } }
}

export function addMemory(content: string): Promise<AddMemoryResult> {
  return withMemoriesLock(async () => {
    const memories = await listMemories()
    const result = buildMemoryAddition(memories, content)
    if ('error' in result) return { ok: false, error: result.error }
    await storage.setItemNow(AGENT_MEMORIES_STORAGE_KEY, [...memories, result.entry])
    return { ok: true, entry: result.entry }
  })
}

export function deleteMemory(id: string): Promise<boolean> {
  return withMemoriesLock(async () => {
    const memories = await listMemories()
    const next = memories.filter((entry) => entry.id !== id)
    if (next.length === memories.length) return false
    await storage.setItemNow(AGENT_MEMORIES_STORAGE_KEY, next)
    return true
  })
}

export function importMemories(contents: string[]): Promise<ImportMemoriesResult> {
  return withMemoriesLock(async () => {
    const memories = await listMemories()
    const seen = new Set(memories.map((entry) => entry.content))
    const additions: MemoryEntry[] = []
    const result: ImportMemoriesResult = {
      imported: 0,
      skippedDuplicate: 0,
      skippedEmpty: 0,
      skippedTooLong: 0,
      skippedLimit: 0,
    }

    for (const content of contents) {
      const trimmed = content.trim()
      if (!trimmed) {
        result.skippedEmpty += 1
        continue
      }
      if (trimmed.length > MEMORY_ENTRY_MAX_CHARS) {
        result.skippedTooLong += 1
        continue
      }
      if (seen.has(trimmed)) {
        result.skippedDuplicate += 1
        continue
      }
      if (memories.length + additions.length >= MEMORY_MAX_ENTRIES) {
        result.skippedLimit += 1
        continue
      }
      seen.add(trimmed)
      additions.push({ id: generateMemoryId(), content: trimmed, createdAt: Date.now() })
    }

    if (additions.length > 0) {
      await storage.setItemNow(AGENT_MEMORIES_STORAGE_KEY, [...memories, ...additions])
    }
    result.imported = additions.length
    return result
  })
}

const CopilotMemoriesRecordSchema = z.record(z.string(), z.array(MemoryEntrySchema).catch([])).catch({})

/**
 * How many times each copilot id has been deleted in this app run. A memory scope
 * pins the count it was resolved against; a write carrying an older one belongs to
 * an earlier incarnation of the id, so it may neither resurrect the list
 * `retireCopilotMemories` dropped nor land in the list of whichever copilot next
 * takes the id.
 */
const copilotMemoryEpochs = new Map<string, number>()

export function copilotMemoryEpoch(copilotId: string): number {
  return copilotMemoryEpochs.get(copilotId) ?? 0
}

async function readCopilotMemoriesRecord(): Promise<Record<string, MemoryEntry[]>> {
  const raw = await storage.getItem<Record<string, MemoryEntry[]>>(COPILOT_MEMORIES_STORAGE_KEY, {})
  return CopilotMemoriesRecordSchema.parse(raw)
}

/** Every copilot that has saved memories, keyed by copilot id (for Settings). */
export function listAllCopilotMemories(): Promise<Record<string, MemoryEntry[]>> {
  return readCopilotMemoriesRecord()
}

export async function listCopilotMemories(copilotId: string): Promise<MemoryEntry[]> {
  const record = await readCopilotMemoriesRecord()
  return record[copilotId] ?? []
}

export function addCopilotMemory(
  copilotId: string,
  content: string,
  epoch: number = copilotMemoryEpoch(copilotId)
): Promise<AddMemoryResult> {
  return withCopilotMemoriesLock(async () => {
    if (epoch !== copilotMemoryEpoch(copilotId)) {
      return { ok: false, error: 'This copilot has been deleted, so its memory is no longer available.' }
    }
    const record = await readCopilotMemoriesRecord()
    const memories = record[copilotId] ?? []
    const result = buildMemoryAddition(memories, content)
    if ('error' in result) return { ok: false, error: result.error }
    await storage.setItemNow(COPILOT_MEMORIES_STORAGE_KEY, { ...record, [copilotId]: [...memories, result.entry] })
    return { ok: true, entry: result.entry }
  })
}

export function deleteCopilotMemory(copilotId: string, id: string): Promise<boolean> {
  return withCopilotMemoriesLock(async () => {
    const record = await readCopilotMemoriesRecord()
    const memories = record[copilotId] ?? []
    const next = memories.filter((entry) => entry.id !== id)
    if (next.length === memories.length) return false
    const nextRecord = { ...record, [copilotId]: next }
    if (next.length === 0) delete nextRecord[copilotId]
    await storage.setItemNow(COPILOT_MEMORIES_STORAGE_KEY, nextRecord)
    return true
  })
}

async function dropCopilotMemories(copilotId: string): Promise<void> {
  const record = await readCopilotMemoriesRecord()
  if (!(copilotId in record)) return
  const next = { ...record }
  delete next[copilotId]
  await storage.setItemNow(COPILOT_MEMORIES_STORAGE_KEY, next)
}

/** Empty a copilot's memory list; the copilot keeps recording what it learns next. */
export function clearCopilotMemories(copilotId: string): Promise<void> {
  return withCopilotMemoriesLock(() => dropCopilotMemories(copilotId))
}

/**
 * Drop the memories of a copilot being deleted, and retire the id along with them:
 * writes from a generation that resolved its scope against the old copilot are
 * refused, so they can neither bring this list back nor land in the list of
 * whichever copilot takes the id next.
 */
export function retireCopilotMemories(copilotId: string): Promise<void> {
  return withCopilotMemoriesLock(async () => {
    copilotMemoryEpochs.set(copilotId, copilotMemoryEpoch(copilotId) + 1)
    await dropCopilotMemories(copilotId)
  })
}

export function listMemoriesForScope(scope: MemoryScope): Promise<MemoryEntry[]> {
  return scope.type === 'copilot' ? listCopilotMemories(scope.copilotId) : listMemories()
}

export function addMemoryForScope(scope: MemoryScope, content: string): Promise<AddMemoryResult> {
  return scope.type === 'copilot' ? addCopilotMemory(scope.copilotId, content, scope.epoch) : addMemory(content)
}

export function deleteMemoryForScope(scope: MemoryScope, id: string): Promise<boolean> {
  return scope.type === 'copilot' ? deleteCopilotMemory(scope.copilotId, id) : deleteMemory(id)
}

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
    ...(memoryScope.type === 'copilot' ? { memoryCopilotId: memoryScope.copilotId } : {}),
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
  return withSoulLock(() => withMemoriesLock(() => withCopilotMemoriesLock(operation)))
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
