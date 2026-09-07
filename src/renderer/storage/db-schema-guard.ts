import { create } from 'zustand'

/**
 * Raised when an IndexedDB database on disk carries a newer schema version than
 * this build pins in `indexedDB.open(name, version)`. Happens only after the
 * user downgrades across a schema bump; the data itself is intact.
 */
export class DbSchemaTooNewError extends Error {
  constructor(
    readonly dbName: string,
    options?: { cause?: unknown }
  ) {
    super(`IndexedDB database "${dbName}" was created by a newer version of Chatbox`, options)
    this.name = 'DbSchemaTooNewError'
  }
}

export function isIndexedDbVersionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'VersionError'
}

interface DbSchemaGuardState {
  /** Set when a database failed to open because its on-disk schema is newer than this build. */
  schemaTooNewDbName: string | null
  /** Set when another window/tab upgraded a database and this connection had to be released. */
  upgradedElsewhereDbName: string | null
  /** Set while a version upgrade is blocked by connections held in other windows/tabs. */
  upgradeBlockedDbName: string | null
  reportSchemaTooNew: (dbName: string) => void
  reportUpgradedElsewhere: (dbName: string) => void
  reportUpgradeBlocked: (dbName: string) => void
  clearUpgradeBlocked: (dbName: string) => void
}

/**
 * UI-facing state for the blocking "please update / please reload" dialog.
 * Storage classes report here; `DbSchemaGuardDialog` renders it.
 */
export const useDbSchemaGuardStore = create<DbSchemaGuardState>((set) => ({
  schemaTooNewDbName: null,
  upgradedElsewhereDbName: null,
  upgradeBlockedDbName: null,
  reportSchemaTooNew: (dbName) => set({ schemaTooNewDbName: dbName }),
  reportUpgradedElsewhere: (dbName) => set({ upgradedElsewhereDbName: dbName }),
  reportUpgradeBlocked: (dbName) => set({ upgradeBlockedDbName: dbName }),
  clearUpgradeBlocked: (dbName) =>
    set((state) => (state.upgradeBlockedDbName === dbName ? { upgradeBlockedDbName: null } : state)),
}))

/**
 * Shared wiring for every renderer-managed IndexedDB connection:
 * - a pinned-version open that finds a newer on-disk schema surfaces the
 *   upgrade wall instead of a silent storage failure;
 * - a connection held while another window/newer install bumps the schema is
 *   released (otherwise the upgrade blocks forever) and prompts a reload.
 *
 * Returns the error the storage should reject with.
 */
export function toDbOpenError(dbName: string, error: unknown): unknown {
  if (isIndexedDbVersionError(error)) {
    useDbSchemaGuardStore.getState().reportSchemaTooNew(dbName)
    return new DbSchemaTooNewError(dbName, { cause: error })
  }
  return error
}

export function watchDbVersionChange(dbName: string, db: IDBDatabase, onReleased: () => void): void {
  db.onversionchange = () => {
    db.close()
    onReleased()
    useDbSchemaGuardStore.getState().reportUpgradedElsewhere(dbName)
  }
}

/**
 * Surface a version upgrade stalled by connections in other windows/tabs
 * (builds without `watchDbVersionChange` never release theirs). The prompt
 * clears automatically once the upgrade proceeds and open succeeds.
 */
export function watchDbOpenBlocked(dbName: string, request: IDBOpenDBRequest): void {
  request.onblocked = () => {
    useDbSchemaGuardStore.getState().reportUpgradeBlocked(dbName)
  }
}

export function reportDbOpenSucceeded(dbName: string): void {
  useDbSchemaGuardStore.getState().clearUpgradeBlocked(dbName)
}
