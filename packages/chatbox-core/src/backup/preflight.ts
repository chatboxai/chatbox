import type { Message, Session } from '@shared/types'
import { decodeSessionTree } from '../session/session-tree/decode'
import type { SessionTree } from '../session/session-tree/types'
import { throwIfAborted } from './abort'
import type { BackupExportOptions } from './export-backup'
import { classifyBackupSession } from './format-classification'
import { LegacyBackupTopologyError } from './legacy-source'
import { BackupReadError } from './read-error'
import { prepareBackupMessagePayload } from './resource-payload'
import { collectSessionResourceReferences, prepareSessionForBackup } from './resources'
import { type BackupSessionStore, backupPageLimits } from './session-port'
import { BackupSourceBudgetError, checkedBackupRows, MAX_BACKUP_SESSION_STRUCTURE_BYTES } from './source-check'
import type { BackupWarning } from './types'

export const SINGLE_BACKUP_SESSION_BYTES = 64 * 1024 * 1024
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
  nativePayloadLimit?: number
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
          if (bytes + messageBytes > materializeLimit + 128 * 1024)
            throw new Error('Prepared session exceeded its single-file budget')
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
        throw new BackupSourceBudgetError('Prepared session exceeded its single-file budget')
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

/** The caller holds write exclusion from classification through archive completion. */
export async function prepareBackupExport(
  options: PreparationOptions,
  budgets: { singleSessionBytes?: number } = {}
): Promise<BackupExportPlan> {
  const threshold = budgets.singleSessionBytes ?? SINGLE_BACKUP_SESSION_BYTES
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
        descriptor = await classifyBackupSession(
          options.sessionStore,
          id,
          threshold,
          options.signal,
          options.nativePayloadLimit
        )
      } catch (error) {
        // 备份不等于迁移。旧界面能读取的孤立分支必须随 JSON 保留，不能因无法构树就整段漏备份。
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
