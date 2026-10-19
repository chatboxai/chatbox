import type { SessionHeader } from '@shared/types'
import { throwIfAborted } from './abort'
import { sha256Checksum } from './codec'
import type { BackupExportOptions } from './export-backup'
import { classifyBackupSession } from './format-classification'
import { LegacyBackupTopologyError } from './legacy-source'
import { BackupReadError } from './read-error'
import type { ResourceReference } from './resources'
import { prepareMessageForBackup } from './resources'
import { prepareLegacySessionRows } from './legacy-row-import'
import { encodeRowJson, SingleFileBudgetError } from './row-json'
export { SingleFileBudgetError } from './row-json'
import { type BackupRow, type BackupSessionStore, backupPageLimits } from './session-port'
import { BackupSourceBudgetError, checkedBackupRows, MAX_BACKUP_SESSION_STRUCTURE_BYTES } from './source-check'
import { createTaskYielder } from './task-yield'
import { type BackupWarning, MAX_BACKUP_JSON_ENTRY_BYTES } from './types'
import { BackupWarningBudgetError, BackupWarningIndex } from './warning-index'
import { type DeflatedZipData, deflateZipData } from './zip'

export const SINGLE_BACKUP_SESSION_BYTES = 64 * 1024 * 1024
/** Compressed session entries retained from preparation so export writes them without reading the session again. */
export const PREPARED_SESSION_ENTRY_BYTES = 16 * 1024 * 1024
/** Sessions materialized during preparation stay within this many prepared bytes. */
const PREPARED_SESSION_MATERIALIZE_BYTES = 8 * 1024 * 1024

/** A single-file session entry produced during preparation, exactly as export would write it. */
export interface PreparedSessionEntry {
  data: DeflatedZipData
  size: number
  checksum: Awaited<ReturnType<typeof sha256Checksum>>
  /** Session fields the manifest metadata is derived from; messages are not retained. */
  header: SessionHeader
  references: ResourceReference[]
  sourceWarnings: BackupWarning[]
  warnings: BackupWarning[]
}
export type PreparedBackupSession = { id: string; name: string } & (
  | { layout: 'single'; size: number; legacyTopology?: string }
  | { layout: 'sharded' }
)
export interface BackupExportPlan {
  formatVersion: 2 | 3
  sessions: PreparedBackupSession[]
  warnings: BackupWarning[]
  selectedSessionIds: string[]
  exportItems: BackupExportOptions['exportItems']
  includeKeys: boolean
  /** Consumed by export; sessions without an entry are read again. */
  entries?: Map<string, PreparedSessionEntry>
}
type PreparationOptions = Omit<BackupExportOptions, 'writeArchive'> & {
  sessionStore: BackupSessionStore
  nativePayloadLimit?: number
}
const encoder = new TextEncoder()

/** Encodes one measured row source within the single-file byte budget. */
export async function prepareSessionSource(
  store: BackupSessionStore,
  id: string,
  signal?: AbortSignal,
  materializeLimit = SINGLE_BACKUP_SESSION_BYTES,
  nativePayloadLimit?: number
) {
  const result = await encodeRowJson(
    checkedBackupRows(store, id, backupPageLimits(), signal, nativePayloadLimit),
    id,
    materializeLimit,
    true,
    signal
  )
  if (!result.bytes) throw new Error('Prepared backup bytes are missing')
  return { ...result, bytes: result.bytes }
}

/**
 * Reads a session's rows ahead while the held rows and the stored payload sizes stay within the limit.
 * Payloads are not read. A payload without a stored size may only be read while its row is current, so read-ahead
 * stops there. With `lowerBound`, it also applies classification's sharded test: prepared inline bytes alone at
 * inline rows, and together with stored payload sizes at payload rows.
 */
async function readMeasuredRows(
  store: BackupSessionStore,
  id: string,
  limit: number,
  lowerBound: boolean,
  signal?: AbortSignal
): Promise<{ rows: BackupRow[]; name?: string; result: 'complete' | 'unmeasured' | 'beyond-bound' }> {
  const rows: BackupRow[] = []
  let name: string | undefined
  let heldBytes = 0
  let inlineBytes = 0
  let payloadBytes = 0
  let structureBytes = 0
  for await (const row of store.iterateBackupRows(id, backupPageLimits(), signal)) {
    throwIfAborted(signal)
    if (row.kind === 'message') {
      if (row.payload && row.payload.size === undefined) return { rows, name, result: 'unmeasured' }
      // The whole held row counts, including its structure; a payload adds the bytes its stream will prepare.
      heldBytes += encoder.encode(JSON.stringify(row.message)).length
      if (row.payload) {
        heldBytes += row.payload.size ?? 0
        payloadBytes += row.payload.size ?? 0
        if (lowerBound && inlineBytes + payloadBytes > limit) return { rows, name, result: 'beyond-bound' }
      } else if (lowerBound) {
        inlineBytes += encoder.encode(JSON.stringify(prepareMessageForBackup(row.message.message))).length
        if (inlineBytes > limit) return { rows, name, result: 'beyond-bound' }
      }
      if (heldBytes > limit) return { rows, name, result: 'unmeasured' }
    } else {
      if (row.kind === 'header') name = row.record.name
      structureBytes += encoder.encode(JSON.stringify(row.kind === 'header' ? row.record : row.thread)).length
      if (structureBytes > MAX_BACKUP_SESSION_STRUCTURE_BYTES)
        throw new BackupSourceBudgetError('Backup session structure exceeds budget')
    }
    rows.push(row)
  }
  return { rows, name, result: 'complete' }
}

/** The caller holds write exclusion from classification through archive completion. */
export async function prepareBackupExport(
  options: PreparationOptions,
  budgets: { singleSessionBytes?: number; preparedEntryBytes?: number } = {}
): Promise<BackupExportPlan> {
  const threshold = budgets.singleSessionBytes ?? SINGLE_BACKUP_SESSION_BYTES
  const entryBudget = budgets.preparedEntryBytes ?? PREPARED_SESSION_ENTRY_BYTES
  const checksum = options.checksum ?? sha256Checksum
  const entries = new Map<string, PreparedSessionEntry>()
  let entryBytes = 0
  const retain = async (id: string, source: Awaited<ReturnType<typeof prepareSessionSource>>) => {
    if (entryBytes >= entryBudget) return
    const bytes = source.bytes
    if (bytes.length > MAX_BACKUP_JSON_ENTRY_BYTES) return
    const data = await deflateZipData(bytes, options.signal)
    const header = source.header
    const cost =
      data.deflated.length + encoder.encode(JSON.stringify([header, source.references, source.warnings])).length
    if (entryBytes + cost > entryBudget) {
      // The budget is spent; later sessions are classified without being prepared.
      entryBytes = entryBudget
      return
    }
    entryBytes += cost
    entries.set(id, {
      data,
      size: bytes.length,
      checksum: await checksum(bytes),
      header,
      references: source.references,
      sourceWarnings: source.warnings,
      warnings: [],
    })
  }
  const classifyStored = (id: string) =>
    classifyBackupSession(options.sessionStore, id, threshold, options.signal, options.nativePayloadLimit)
  // A session measured within the materialization limit is prepared once from its read-ahead rows: that yields
  // its exact size and archive entry. Larger sessions are classified from stored sizes, as classification would.
  const classify = async (id: string): Promise<PreparedBackupSession> => {
    if (entryBytes >= entryBudget) return classifyStored(id)
    const limit = Math.min(threshold, PREPARED_SESSION_MATERIALIZE_BYTES)
    const measured = await readMeasuredRows(options.sessionStore, id, limit, limit === threshold, options.signal)
    // Beyond the threshold, the same lower bound makes classification choose the sharded layout.
    if (measured.result === 'beyond-bound') return { id, name: measured.name ?? id, layout: 'sharded' }
    if (measured.result === 'unmeasured') return classifyStored(id)
    const replay: BackupSessionStore = {
      ...options.sessionStore,
      // Rows were read ahead; replay them in order, leaving the UI thread room while each is prepared.
      async *iterateBackupRows() {
        const yieldTask = createTaskYielder()
        for (const row of measured.rows) {
          await yieldTask()
          yield row
        }
      },
    }
    let source: Awaited<ReturnType<typeof prepareSessionSource>>
    try {
      source = await prepareSessionSource(replay, id, options.signal, limit, options.nativePayloadLimit)
    } catch (error) {
      // A prepared prefix beyond the threshold is the lower bound classification settles on.
      if (error instanceof SingleFileBudgetError && limit === threshold)
        return { id, name: measured.name ?? id, layout: 'sharded' }
      if (error instanceof BackupWarningBudgetError) throw error
      // Other budgets apply when the session is written; classification leaves them to export.
      if (error instanceof BackupSourceBudgetError) return classifyStored(id)
      throw error
    }
    if (source.size > threshold) return { id, name: source.header.name, layout: 'sharded' }
    await retain(id, source)
    return { id, name: source.header.name, layout: 'single', size: source.size }
  }
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > SINGLE_BACKUP_SESSION_BYTES)
    throw new Error('Invalid single-session backup budget')
  const ids = options.exportItems.includes('conversations')
    ? [...new Set(options.selectedSessionIds ?? (await options.sessionStore.listSessionIds()))]
    : []
  if (ids.length > 50_000) throw new BackupSourceBudgetError('Too many selected sessions')
  const sessions: PreparedBackupSession[] = []
  const warnings = new BackupWarningIndex()
  let planBytes = 0
  const reserve = (value: unknown) => {
    planBytes += encoder.encode(JSON.stringify(value)).length
    if (planBytes > 4 * 1024 * 1024) throw new BackupSourceBudgetError('Backup preparation index exceeds budget')
  }
  for (const [index, id] of ids.entries()) {
    throwIfAborted(options.signal)
    options.onProgress?.({ phase: 'preparing', current: index, total: ids.length })
    try {
      let descriptor: PreparedBackupSession
      try {
        descriptor = await classify(id)
        // A sharded session makes the archive v3, which writes sessions from storage; retained entries go unused.
        if (descriptor.layout === 'sharded') {
          entries.clear()
          entryBytes = entryBudget
        }
      } catch (error) {
        // Repairs that rename streamed messages require one bounded legacy input parse.
        if (!(error instanceof LegacyBackupTopologyError)) throw error
        const legacy = await prepareLegacySession(options.sessionStore, id, options.signal)
        descriptor = {
          id,
          name: legacy.header.name,
          layout: 'single',
          size: legacy.size,
          legacyTopology: error.topologyReason.slice(0, 1024),
        }
      }
      reserve(descriptor)
      sessions.push(descriptor)
    } catch (error) {
      throwIfAborted(options.signal)
      if (error instanceof BackupSourceBudgetError) throw error
      const warning: BackupWarning = {
        code: 'session-read-failed',
        reason: error instanceof BackupReadError ? error.reason : undefined,
        itemType: 'session',
        itemId: id,
        itemName: await (await options.metaStorage)
          .getById(id)
          .then((meta) => meta?.name)
          .catch(() => undefined),
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1024),
      }
      reserve(warning)
      warnings.add(warning)
    }
  }
  options.onProgress?.({ phase: 'preparing', current: ids.length, total: ids.length })
  if (ids.length && !sessions.length)
    throw new Error(`No selected conversation can be backed up: ${warnings.toArray()[0]?.message}`)
  return {
    formatVersion: sessions.some((session) => session.layout === 'sharded') ? 3 : 2,
    sessions,
    warnings: warnings.toArray(),
    selectedSessionIds: ids,
    exportItems: [...options.exportItems],
    includeKeys: options.includeKeys,
    entries,
  }
}

async function prepareLegacySession(store: BackupSessionStore, id: string, signal?: AbortSignal) {
  const value = await store.readLegacySession?.(id, SINGLE_BACKUP_SESSION_BYTES, signal)
  if (!value) throw new Error('Legacy backup source is unavailable')
  const tree = prepareLegacySessionRows(value)
  const source = (async function* (): AsyncGenerator<BackupRow> {
    yield { kind: 'header', record: tree.session }
    for (const thread of tree.threads) yield { kind: 'thread', thread }
    for (const message of tree.messages) yield { kind: 'message', message }
  })()
  const encoded = await encodeRowJson(source, id, SINGLE_BACKUP_SESSION_BYTES, true, signal)
  if (!encoded.bytes) throw new Error('Prepared legacy input bytes are missing')
  return { ...encoded, bytes: encoded.bytes }
}

export function preparedEntryReader(
  options: PreparationOptions,
  plan: BackupExportPlan
): (id: string) => Promise<Awaited<ReturnType<typeof prepareSessionSource>>> {
  return async (id) => {
    const expected = plan.sessions.find((session) => session.id === id)
    if (!expected || expected.layout !== 'single') throw new Error('Session was not prepared for single-file export')
    const actual = expected.legacyTopology
      ? await prepareLegacySession(options.sessionStore, id, options.signal)
      : await prepareSessionSource(
          options.sessionStore,
          id,
          options.signal,
          Math.min(SINGLE_BACKUP_SESSION_BYTES, expected.size + 1024 * 1024),
          options.nativePayloadLimit
        )
    if (actual.size !== expected.size) throw new Error('Backup source changed after preparation')
    return actual
  }
}
