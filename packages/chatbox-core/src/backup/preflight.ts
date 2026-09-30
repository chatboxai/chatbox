import type { Message, Session } from '@shared/types'
import { decodeSessionTree } from '../session/session-tree/decode'
import type { SessionTree } from '../session/session-tree/types'
import { throwIfAborted } from './abort'
import { sha256Checksum } from './codec'
import type { BackupExportOptions } from './export-backup'
import { classifyBackupSession } from './format-classification'
import { LegacyBackupTopologyError } from './legacy-source'
import { BackupReadError } from './read-error'
import { prepareBackupMessagePayload } from './resource-payload'
import type { ResourceReference } from './resources'
import { collectSessionResourceReferences, prepareSessionForBackup } from './resources'
import { type BackupRow, type BackupSessionStore, backupPageLimits } from './session-port'
import { BackupSourceBudgetError, checkedBackupRows, MAX_BACKUP_SESSION_STRUCTURE_BYTES } from './source-check'
import { createTaskYielder } from './task-yield'
import { type BackupWarning, MAX_BACKUP_JSON_ENTRY_BYTES } from './types'
import { type DeflatedZipData, deflateZipData } from './zip'

export const SINGLE_BACKUP_SESSION_BYTES = 64 * 1024 * 1024
/** Compressed session entries retained from preparation so export writes them without reading the session again. */
export const PREPARED_SESSION_ENTRY_BYTES = 16 * 1024 * 1024
/** Sessions materialized during preparation stay within this many prepared bytes. */
const PREPARED_SESSION_MATERIALIZE_BYTES = 8 * 1024 * 1024

/** A session larger than the single-file budget; it is classified without being materialized. */
export class SingleFileBudgetError extends BackupSourceBudgetError {}

/** A single-file session entry produced during preparation, exactly as export would write it. */
export interface PreparedSessionEntry {
  data: DeflatedZipData
  size: number
  checksum: Awaited<ReturnType<typeof sha256Checksum>>
  /** Session fields the manifest metadata is derived from; messages are not retained. */
  session: Session
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

/** Materialization is allowed only for an already measured, bounded single-file session. */
export async function prepareSessionSource(
  store: BackupSessionStore,
  id: string,
  signal?: AbortSignal,
  materializeLimit: number = SINGLE_BACKUP_SESSION_BYTES,
  nativePayloadLimit?: number,
  /** Bytes a streamed payload may prepare beyond the limit before the session is rejected. */
  payloadAllowance = 128 * 1024
) {
  const tree: Partial<SessionTree> & Pick<SessionTree, 'threads' | 'messages'> = { threads: [], messages: [] }
  let messageBytes = 0
  let structureBytes = 0
  const sourceWarnings: BackupWarning[] = []
  let warningBytes = 0
  const keep = (value: unknown) => {
    structureBytes += encoder.encode(JSON.stringify(value)).length
    if (structureBytes > MAX_BACKUP_SESSION_STRUCTURE_BYTES)
      throw new BackupSourceBudgetError('Backup session structure exceeds budget')
  }
  const warn = (message: Message) => {
    const warnings = collectSessionResourceReferences({ id, name: '', messages: [message] }).warnings
    warningBytes += encoder.encode(JSON.stringify(warnings)).length
    if (warningBytes > 4 * 1024 * 1024) throw new BackupSourceBudgetError('Backup warning index exceeds budget')
    sourceWarnings.push(...warnings)
  }
  for await (const row of checkedBackupRows(store, id, backupPageLimits(), signal, nativePayloadLimit)) {
    if (row.kind === 'header') {
      keep(row.record)
      tree.session = row.record
    } else if (row.kind === 'thread') {
      keep(row.thread)
      tree.threads.push(row.thread)
    } else {
      let message: Message
      if (!row.payload) {
        warn(row.message.message)
        message = prepareSessionForBackup({ id, name: '', messages: [row.message.message] }).messages[0]
      } else if (row.payload.value) {
        warn(row.payload.value)
        message = prepareSessionForBackup({ id, name: '', messages: [row.payload.value] }).messages[0]
      } else {
        if (!row.payload.chunks || !row.payload.original) throw new Error('Backup payload source is missing')
        const parts: Uint8Array<ArrayBuffer>[] = []
        let bytes = 0
        const source = prepareBackupMessagePayload(row.payload.chunks(), undefined, { validateInput: false })
        for await (const part of source) {
          throwIfAborted(signal)
          bytes += part.length
          if (bytes + messageBytes > materializeLimit + payloadAllowance)
            throw new SingleFileBudgetError('Prepared session exceeded its single-file budget')
          parts.push(new Uint8Array(part))
        }
        warn(row.payload.original())
        const data = new Uint8Array(bytes)
        let offset = 0
        for (const part of parts) {
          data.set(part, offset)
          offset += part.length
        }
        message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
      }
      const projected = { ...row.message, message }
      keep({ ...row.message, message: { id: row.message.messageId, role: 'user', contentParts: [] } })
      messageBytes += encoder.encode(JSON.stringify(message)).length
      if (messageBytes > materializeLimit)
        throw new SingleFileBudgetError('Prepared session exceeded its single-file budget')
      tree.messages.push(projected)
    }
  }
  if (!tree.session) throw new Error('Backup session header is missing')
  const decoded = decodeSessionTree(tree as SessionTree)
  if (!decoded.ok) throw new Error(decoded.reason)
  const session = decoded.session
  const size = encoder.encode(JSON.stringify(session)).length
  return { session, size, warnings: sourceWarnings }
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
        inlineBytes += encoder.encode(
          JSON.stringify(prepareSessionForBackup({ id, name: '', messages: [row.message.message] }).messages[0])
        ).length
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
    const preparedSession = prepareSessionForBackup(source.session)
    const bytes = encoder.encode(JSON.stringify(preparedSession))
    if (bytes.length > MAX_BACKUP_JSON_ENTRY_BYTES) return
    const collected = collectSessionResourceReferences(source.session)
    const data = await deflateZipData(bytes, options.signal)
    // Only the fields manifest metadata is derived from; threads and forks carry message bodies.
    const {
      id: sessionId,
      name,
      starred,
      hidden,
      archivedAt,
      assistantAvatarKey,
      picUrl,
      backgroundImage,
      type,
    } = preparedSession
    const session: Session = {
      id: sessionId,
      name,
      starred,
      hidden,
      archivedAt,
      assistantAvatarKey,
      picUrl,
      backgroundImage,
      type,
      messages: [],
    }
    const cost =
      data.deflated.length +
      encoder.encode(JSON.stringify([session, collected.references, collected.warnings, source.warnings])).length
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
      session,
      references: collected.references,
      sourceWarnings: source.warnings,
      warnings: collected.warnings,
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
      source = await prepareSessionSource(replay, id, options.signal, limit, options.nativePayloadLimit, 0)
    } catch (error) {
      // A prepared prefix beyond the threshold is the lower bound classification settles on.
      if (error instanceof SingleFileBudgetError && limit === threshold)
        return { id, name: measured.name ?? id, layout: 'sharded' }
      // Other budgets apply when the session is written; classification leaves them to export.
      if (error instanceof BackupSourceBudgetError) return classifyStored(id)
      throw error
    }
    if (source.size > threshold) return { id, name: source.session.name, layout: 'sharded' }
    await retain(id, source)
    return { id, name: source.session.name, layout: 'single', size: source.size }
  }
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > SINGLE_BACKUP_SESSION_BYTES)
    throw new Error('Invalid single-session backup budget')
  const ids = options.exportItems.includes('conversations')
    ? [...new Set(options.selectedSessionIds ?? (await options.sessionStore.listSessionIds()))]
    : []
  if (ids.length > 50_000) throw new BackupSourceBudgetError('Too many selected sessions')
  const sessions: PreparedBackupSession[] = []
  const warnings: BackupWarning[] = []
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
        // 备份不等于迁移。无法按行编码的旧拓扑必须随 JSON 保留，不能因无法构树就整段漏备份。
        if (!(error instanceof LegacyBackupTopologyError)) throw error
        const legacy = await prepareLegacySession(options.sessionStore, id, options.signal)
        descriptor = {
          id,
          name: legacy.session.name,
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
      warnings.push(warning)
    }
  }
  options.onProgress?.({ phase: 'preparing', current: ids.length, total: ids.length })
  if (ids.length && !sessions.length)
    throw new Error(`No selected conversation can be backed up: ${warnings[0]?.message}`)
  return {
    formatVersion: sessions.some((session) => session.layout === 'sharded') ? 3 : 2,
    sessions,
    warnings,
    selectedSessionIds: ids,
    exportItems: [...options.exportItems],
    includeKeys: options.includeKeys,
    entries,
  }
}

async function prepareLegacySession(store: BackupSessionStore, id: string, signal?: AbortSignal) {
  const value = await store.readLegacySession?.(id, SINGLE_BACKUP_SESSION_BYTES, signal)
  if (!value) throw new Error('Legacy backup source is unavailable')
  const warnings = collectSessionResourceReferences(value).warnings
  const session = prepareSessionForBackup(value)
  const size = encoder.encode(JSON.stringify(session)).length
  if (size > SINGLE_BACKUP_SESSION_BYTES) throw new Error('Legacy conversation exceeds the single-file backup limit')
  return { session, size, warnings }
}

export function preparedSessionReader(
  options: PreparationOptions,
  plan: BackupExportPlan
): (id: string, onWarnings?: (warnings: BackupWarning[]) => void) => Promise<Session> {
  return async (id, onWarnings) => {
    const expected = plan.sessions.find((session) => session.id === id)
    if (!expected || expected.layout !== 'single') throw new Error('Session was not prepared for single-file export')
    const actual = expected.legacyTopology
      ? await prepareLegacySession(options.sessionStore, id, options.signal)
      : await prepareSessionSource(
          options.sessionStore,
          id,
          options.signal,
          expected.size + 1024 * 1024,
          options.nativePayloadLimit
        )
    if (actual.size !== expected.size) throw new Error('Backup source changed after preparation')
    onWarnings?.(actual.warnings)
    return actual.session
  }
}
