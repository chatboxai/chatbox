import { MY_COPILOTS_STORAGE_KEY } from '@chatbox/core/application/copilots'
import {
  AGENT_MEMORIES_STORAGE_KEY,
  COPILOT_MEMORIES_STORAGE_KEY,
  COPILOT_MEMORY_OWNERS_STORAGE_KEY,
  COPILOT_MEMORY_TOKENS_STORAGE_KEY,
  type CopilotMemoryOwner,
  MemoryService,
} from '@chatbox/core/application/memory'
import type { CopilotDetail } from '@shared/types'
import { type CopilotMemoryStateToken, parseCopilotMemoryStateTokens } from '@shared/types/agent-persona'
import { getDefaultStore } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import storage from '@/storage'
import { nonSessionStorageKey } from '@/storage/non-session-key'

/**
 * An `atomWithStorage` that also keeps its current value in a module-level mirror.
 * The atom only touches storage once a React component subscribes, so non-React
 * callers resolving a session's memory scope read the mirror to see UI edits
 * while their persistence is still pending.
 */
function createMirroredListAtom<T>(
  key: string,
  write: (value: T[]) => Promise<void>,
  remove: () => Promise<void>,
  parse?: (value: unknown) => T[]
) {
  let current: T[] | undefined
  let pendingRead: Promise<T[]> | undefined
  let replacingFromStorage = false

  /** Load the persisted list once; a write landing meanwhile is newer and wins. */
  const read = (storageKey: string = key, initialValue: T[] = []): Promise<T[]> => {
    if (current !== undefined) return Promise.resolve(current)
    pendingRead ??= storage
      .getItem<unknown>(storageKey, initialValue, { persistInitialValue: true })
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
    setItem(_storageKey: string, value: T[]): Promise<void> {
      current = value
      if (replacingFromStorage) return Promise.resolve()
      return write(value)
    },
    removeItem(): Promise<void> {
      current = []
      return remove()
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

  const reload = async (): Promise<T[]> => {
    await pendingRead?.catch(() => undefined)
    current = undefined
    const value = await read()
    replacingFromStorage = true
    try {
      await getDefaultStore().set(listAtom, value)
    } finally {
      replacingFromStorage = false
    }
    return value
  }
  return { atom: listAtom, read, update, reload, peek: () => current }
}

/** Keep preference writes durable and ordered for the persona backup lock. */
function createMemoryPreferenceWriter<T>(write: (value: T[]) => Promise<void>): (value: T[]) => Promise<void> {
  let pending: Promise<void> = Promise.resolve()
  return (value) => {
    const written = pending.then(() => write(value))
    pending = written.catch(() => undefined)
    return written
  }
}

const myCopilots = createMirroredListAtom<CopilotDetail>(
  MY_COPILOTS_STORAGE_KEY,
  createMemoryPreferenceWriter<CopilotDetail>((value) =>
    storage.setItemNow(nonSessionStorageKey(MY_COPILOTS_STORAGE_KEY), value)
  ),
  () => storage.removeItem(nonSessionStorageKey(MY_COPILOTS_STORAGE_KEY))
)
const memoryOwners = createMirroredListAtom<CopilotMemoryOwner>(
  COPILOT_MEMORY_OWNERS_STORAGE_KEY,
  createMemoryPreferenceWriter<CopilotMemoryOwner>((value) =>
    storage.setItemNow(nonSessionStorageKey(COPILOT_MEMORY_OWNERS_STORAGE_KEY), value)
  ),
  () => storage.removeItem(nonSessionStorageKey(COPILOT_MEMORY_OWNERS_STORAGE_KEY))
)
const memoryTokens = createMirroredListAtom<CopilotMemoryStateToken>(
  COPILOT_MEMORY_TOKENS_STORAGE_KEY,
  createMemoryPreferenceWriter<CopilotMemoryStateToken>((value) =>
    storage.setItemNow(nonSessionStorageKey(COPILOT_MEMORY_TOKENS_STORAGE_KEY), value)
  ),
  () => storage.removeItem(nonSessionStorageKey(COPILOT_MEMORY_TOKENS_STORAGE_KEY)),
  parseCopilotMemoryStateTokens
)

export async function getCopilotName(copilotId: string): Promise<string | undefined> {
  return (await myCopilots.read()).find((copilot) => copilot.id === copilotId)?.name
}

export const myCopilotsAtom = myCopilots.atom
export const copilotMemoryOwnersAtom = memoryOwners.atom
export const copilotMemoryTokensAtom = memoryTokens.atom

export const rendererMemoryService = new MemoryService({
  storage: {
    get: <T>(key: string) => storage.getItemRaw<T>(key),
    set: <T>(key: string, value: T): Promise<void> => {
      switch (key) {
        case AGENT_MEMORIES_STORAGE_KEY:
          return storage.setItemNow(nonSessionStorageKey(AGENT_MEMORIES_STORAGE_KEY), value)
        case COPILOT_MEMORIES_STORAGE_KEY:
          return storage.setItemNow(nonSessionStorageKey(COPILOT_MEMORIES_STORAGE_KEY), value)
        case COPILOT_MEMORY_OWNERS_STORAGE_KEY:
          return storage.setItemNow(nonSessionStorageKey(COPILOT_MEMORY_OWNERS_STORAGE_KEY), value)
        case COPILOT_MEMORY_TOKENS_STORAGE_KEY:
          return storage.setItemNow(nonSessionStorageKey(COPILOT_MEMORY_TOKENS_STORAGE_KEY), value)
        default:
          return Promise.reject(new Error('Unsupported memory storage key'))
      }
    },
  },
  preferenceLists: { owners: memoryOwners, tokens: memoryTokens },
})

let definitionMutation: Promise<unknown> = Promise.resolve()

/** Order definition changes before memory operations and backup access. */
export function withCopilotDefinitionsLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = definitionMutation.then(async () => {
    await Promise.allSettled([myCopilots.read()])
    return operation()
  })
  definitionMutation = run.catch(() => undefined)
  return run
}

export function addOrUpdateMyCopilot(target: CopilotDetail): Promise<void> {
  return withCopilotDefinitionsLock(() =>
    myCopilots.update((copilots) => {
      const existingIndex = copilots.findIndex((copilot) => copilot.id === target.id)
      if (existingIndex === -1) {
        return [{ ...target, createdAt: Date.now(), updatedAt: Date.now() }, ...copilots]
      }
      return copilots.map((copilot, index) =>
        index === existingIndex ? { ...copilot, ...target, updatedAt: Date.now() } : copilot
      )
    })
  )
}

export function removeMyCopilot(id: string): Promise<void> {
  return withCopilotDefinitionsLock(async () => {
    const previous = await myCopilots.read()
    await rendererMemoryService.retireCopilot(
      id,
      () => myCopilots.update((copilots) => copilots.filter((copilot) => copilot.id !== id)),
      async () => {
        await myCopilots.update(() => previous)
        await myCopilots.reload()
      }
    )
  })
}

/** Refresh definition mirrors while their mutation lock is held. */
export function reloadCopilotDefinitions(): Promise<unknown> {
  return myCopilots.reload()
}
