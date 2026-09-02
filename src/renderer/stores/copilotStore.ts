import type { CopilotDetail } from '@shared/types'
import {
  type CopilotMemoryStateToken,
  createMemoryStateToken,
  type MemoryScope,
  parseCopilotMemoryStateTokens,
  type SessionPromptContextSnapshot,
} from '@shared/types/agent-persona'
import { getDefaultStore } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import storage, { StorageKey } from '@/storage'
import { copilotMemoryEpoch, retireCopilotMemories } from './agentPersonaStore'

/** Copilots whose chats keep their own memory list instead of the global one. */
export const COPILOT_MEMORY_OWNERS_STORAGE_KEY = 'copilot-memory-owners'
/** Per-Copilot source revision retained across enabled and disabled states. */
export const COPILOT_MEMORY_TOKENS_STORAGE_KEY = 'copilot-memory-state-tokens'

export interface CopilotMemoryOwner {
  id: string
  /** Label for Settings; a saved copilot's live name wins over this snapshot. */
  name: string
}

/**
 * An `atomWithStorage` that also keeps its current value in a module-level mirror.
 * Persistence through `storage.setItem` is debounced and the atom only touches
 * storage once a React component subscribes, so non-React callers (generation
 * resolving a session's memory scope) read the mirror to see UI edits that have
 * not been written out yet.
 */
function createMirroredListAtom<T>(key: string, parse?: (value: unknown) => T[]) {
  let current: T[] | undefined
  let pendingRead: Promise<T[]> | undefined

  /** Load the persisted list once; a write landing meanwhile is newer and wins. */
  const read = (storageKey: string = key, initialValue: T[] = []): Promise<T[]> => {
    if (current !== undefined) return Promise.resolve(current)
    pendingRead ??= storage
      .getItem<unknown>(storageKey, initialValue)
      .then((stored) => {
        if (current === undefined) current = parse ? parse(stored) : (stored as T[])
        return current
      })
      .finally(() => {
        pendingRead = undefined
      })
    return pendingRead
  }

  const listAtom = atomWithStorage<T[]>(key, [], {
    getItem: read,
    setItem(storageKey: string, value: T[]): Promise<void> {
      current = value
      return storage.setItem(storageKey, value)
    },
    removeItem(storageKey: string): Promise<void> {
      current = []
      return storage.removeItem(storageKey)
    },
  })

  const update = (updater: (items: T[]) => T[]): Promise<void> => {
    const store = getDefaultStore()
    if (current !== undefined) return store.set(listAtom, updater(current))
    // One hydration read resolves for every mutation waiting on it, so build on the
    // mirror rather than that shared value: otherwise the second mutation restarts
    // from the pre-hydration list and drops the first.
    return read().then((items) => store.set(listAtom, updater(current ?? items)))
  }

  return { atom: listAtom, read, update, peek: () => current }
}

const myCopilots = createMirroredListAtom<CopilotDetail>(StorageKey.MyCopilots)
const memoryOwners = createMirroredListAtom<CopilotMemoryOwner>(COPILOT_MEMORY_OWNERS_STORAGE_KEY)
const memoryTokens = createMirroredListAtom<CopilotMemoryStateToken>(
  COPILOT_MEMORY_TOKENS_STORAGE_KEY,
  parseCopilotMemoryStateTokens
)

export const myCopilotsAtom = myCopilots.atom
export const copilotMemoryOwnersAtom = memoryOwners.atom
export const copilotMemoryTokensAtom = memoryTokens.atom

let memoryPreferenceMutation: Promise<unknown> = Promise.resolve()

function afterMemoryPreferenceHydration(operation: () => Promise<void>): Promise<void> {
  const run = memoryPreferenceMutation.then(async () => {
    await Promise.all([memoryOwners.read(), memoryTokens.read()])
    await operation()
  })
  memoryPreferenceMutation = run.catch(() => undefined)
  return run
}

function changeCopilotMemoryStateToken(
  tokens: CopilotMemoryStateToken[],
  copilotId: string
): CopilotMemoryStateToken[] {
  return [...tokens.filter((entry) => entry.id !== copilotId), { id: copilotId, token: createMemoryStateToken() }]
}

function applyCopilotMemoryEnabled(owner: CopilotMemoryOwner): Promise<void> {
  const owners = memoryOwners.peek() ?? []
  if (owners.some((item) => item.id === owner.id)) {
    return memoryOwners.update((current) => [...current.filter((item) => item.id !== owner.id), owner])
  }
  const tokenWrite = memoryTokens.update((current) => changeCopilotMemoryStateToken(current, owner.id))
  const ownerWrite = memoryOwners.update((current) => [...current.filter((item) => item.id !== owner.id), owner])
  return Promise.all([tokenWrite, ownerWrite]).then(() => undefined)
}

function applyCopilotMemoryDisabled(copilotId: string): Promise<void> {
  const owners = memoryOwners.peek() ?? []
  if (!owners.some((owner) => owner.id === copilotId)) return Promise.resolve()
  const tokenWrite = memoryTokens.update((current) => changeCopilotMemoryStateToken(current, copilotId))
  const ownerWrite = memoryOwners.update((current) => current.filter((owner) => owner.id !== copilotId))
  return Promise.all([tokenWrite, ownerWrite]).then(() => undefined)
}

export function addOrUpdateMyCopilot(target: CopilotDetail): Promise<void> {
  return myCopilots.update((copilots) => {
    const existingIndex = copilots.findIndex((copilot) => copilot.id === target.id)
    if (existingIndex === -1) {
      return [{ ...target, createdAt: Date.now(), updatedAt: Date.now() }, ...copilots]
    }
    return copilots.map((copilot, index) =>
      index === existingIndex ? { ...copilot, ...target, updatedAt: Date.now() } : copilot
    )
  })
}

export async function removeMyCopilot(id: string): Promise<void> {
  // Both mirrors update synchronously once hydrated. Start both mutations before
  // awaiting their debounced persistence so a new generation can no longer resolve
  // the copilot's memory scope while deletion is in progress.
  await Promise.all([
    myCopilots.update((copilots) => copilots.filter((copilot) => copilot.id !== id)),
    disableCopilotMemory(id),
  ])
  await retireCopilotMemories(id)
}

/**
 * Give a copilot its own memory list. Ownership is tracked per copilot id rather
 * than on the My Copilots entry, so a copilot used straight from the store — or a
 * built-in one that was never saved — keeps memories just the same.
 */
export function enableCopilotMemory(owner: CopilotMemoryOwner): Promise<void> {
  if (memoryOwners.peek() !== undefined && memoryTokens.peek() !== undefined) {
    return applyCopilotMemoryEnabled(owner)
  }
  return afterMemoryPreferenceHydration(() => applyCopilotMemoryEnabled(owner))
}

/** Fall back to global memory; the copilot's own entries stay for a later re-enable. */
export function disableCopilotMemory(copilotId: string): Promise<void> {
  if (memoryOwners.peek() !== undefined && memoryTokens.peek() !== undefined) {
    return applyCopilotMemoryDisabled(copilotId)
  }
  return afterMemoryPreferenceHydration(() => applyCopilotMemoryDisabled(copilotId))
}

/** Wait for persisted ownership before initializing an editable UI draft. */
export async function readCopilotMemoryEnabled(copilotId: string): Promise<boolean> {
  const owners = await memoryOwners.read()
  return owners.some((owner) => owner.id === copilotId)
}

export interface CopilotMemorySelection {
  scope: MemoryScope
  memoryStateToken: string
}

/** Resolve the live Copilot memory source and its opaque state token in one read. */
export async function getCopilotMemorySelection(copilotId: string | undefined): Promise<CopilotMemorySelection> {
  if (!copilotId) return { scope: { type: 'global' }, memoryStateToken: '' }
  await memoryPreferenceMutation
  const [owners, tokens] = await Promise.all([memoryOwners.read(), memoryTokens.read()])
  const memoryStateToken = tokens.find((entry) => entry.id === copilotId)?.token ?? ''
  if (!owners.some((item) => item.id === copilotId)) return { scope: { type: 'global' }, memoryStateToken }
  return {
    scope: { type: 'copilot', copilotId, epoch: copilotMemoryEpoch(copilotId) },
    memoryStateToken,
  }
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
  if (!snapshot) return getCopilotMemoryScope(sessionCopilotId)
  const { memoryCopilotId } = snapshot
  return Promise.resolve(
    memoryCopilotId
      ? { type: 'copilot', copilotId: memoryCopilotId, epoch: copilotMemoryEpoch(memoryCopilotId) }
      : { type: 'global' }
  )
}

/** Resolve the live memory scope before generation, including UI changes whose debounced persistence is still pending. */
export async function getCopilotMemoryScope(copilotId: string | undefined): Promise<MemoryScope> {
  return (await getCopilotMemorySelection(copilotId)).scope
}
