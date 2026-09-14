import type { Session } from '@shared/types'
import { decodeSessionTree } from '../session/session-tree/decode'
import type { SessionTree } from '../session/session-tree/types'
import { throwIfAborted } from './abort'
import type { BackupExportOptions } from './export-backup'
import { BackupJsonSize } from './json-size'
import { jsonUtf8Blocks } from './json-stream'
import { BackupMessageValidator } from './payload'
import { prepareBackupMessagePayload } from './resource-payload'
import { BackupResourceCatalog, BackupResourceBudgetError } from './resource-catalog'
import { backupGlobalEntries } from './export-backup'
import { prepareSessionForBackup, collectSessionResourceReferences } from './resources'
import { backupPageLimits, type BackupSessionStore } from './session-port'
import { BackupSourceBudgetError, checkedBackupRows } from './source-check'
import type { BackupWarning } from './types'

export const SINGLE_BACKUP_SESSION_BYTES = 64 * 1024 * 1024
export interface PreparedBackupSession {
  id: string
  name: string
  size: number
  layout: 'single' | 'sharded'
  sourceDigest: string
}
export interface BackupExportPlan {
  formatVersion: 2 | 3
  sessions: PreparedBackupSession[]
  warnings: BackupWarning[]
  sessionBytes: number
  resourceBytes: number
  resourceCount: number
  estimatedBytes: number
  selectedSessionIds: string[]
  exportItems: BackupExportOptions['exportItems']
  includeKeys: boolean
}
type PreparationOptions = Omit<BackupExportOptions, 'writeArchive'> & { sessionStore: BackupSessionStore }
const encoder = new TextEncoder()

const identityFields = new Set([
  'id',
  'storageKey',
  'rawStorageKey',
  'resultStorageKey',
  'resultImageStorageKey',
  'image_storage_key',
  'name',
  'fileType',
  'mimeType',
])
function compactProjection(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return identityFields.has(key) ? value : value.slice(0, 64)
  if (Array.isArray(value)) return value.map((item) => compactProjection(item))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, compactProjection(item, name)]))
  return value
}

/** Materialization is allowed only for an already measured, bounded single-file session. */
export async function prepareSessionSource(
  store: BackupSessionStore,
  id: string,
  signal?: AbortSignal,
  materializeLimit?: number
) {
  const tree: Partial<SessionTree> & Pick<SessionTree, 'threads' | 'messages'> = { threads: [], messages: [] }
  let difference = 0
  let retainedBytes = 0
  let digest = ''
  const sourceWarnings: BackupWarning[] = []
  let warningBytes = 0
  const keep = (value: unknown) => {
    retainedBytes += encoder.encode(JSON.stringify(value)).length
    if (retainedBytes > (materializeLimit ?? 16 * 1024 * 1024))
      throw new BackupSourceBudgetError('Backup session structure exceeds budget')
  }
  for await (const row of checkedBackupRows(store, id, backupPageLimits(), signal, (value) => {
    digest = value
  })) {
    if (row.kind === 'header') {
      keep(row.record)
      tree.session = row.record
    } else if (row.kind === 'thread') {
      keep(row.thread)
      tree.threads.push(row.thread)
    } else {
      const validator = new BackupMessageValidator()
      const counter = new BackupJsonSize()
      const parts: Uint8Array<ArrayBuffer>[] = []
      let bytes = 0
      const original = new BackupMessageValidator()
      const input = row.payload?.chunks
        ? row.payload.chunks()
        : (async function* () {
            yield* jsonUtf8Blocks(row.message.message)
          })()
      const source = (async function* () {
        for await (const part of input) {
          original.write(part)
          yield part
        }
      })()
      for await (const part of prepareBackupMessagePayload(source)) {
        throwIfAborted(signal)
        counter.write(part)
        validator.write(part)
        if (materializeLimit !== undefined) {
          bytes += part.length
          if (bytes + retainedBytes > materializeLimit + 128 * 1024)
            throw new Error('Prepared session exceeded its single-file budget')
          parts.push(new Uint8Array(part))
        }
      }
      const rowWarnings = collectSessionResourceReferences({ id, name: '', messages: [original.finish()] }).warnings
      warningBytes += encoder.encode(JSON.stringify(rowWarnings)).length
      if (warningBytes > 4 * 1024 * 1024) throw new BackupSourceBudgetError('Backup warning index exceeds budget')
      sourceWarnings.push(...rowWarnings)
      let message = validator.finish()
      if (materializeLimit === undefined) message = compactProjection(message) as typeof message
      if (materializeLimit !== undefined) {
        const data = new Uint8Array(bytes)
        let offset = 0
        for (const part of parts) {
          data.set(part, offset)
          offset += part.length
        }
        message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
      }
      const preparedSize = counter.finish()
      difference += preparedSize - encoder.encode(JSON.stringify(message)).length
      const projected = { ...row.message, message }
      keep(projected)
      tree.messages.push(projected)
    }
  }
  if (!tree.session) throw new Error('Backup session header is missing')
  const decoded = decodeSessionTree(tree as SessionTree)
  if (!decoded.ok) throw new Error(decoded.reason)
  const session = prepareSessionForBackup(decoded.session)
  const size = encoder.encode(JSON.stringify(session)).length + difference
  if (!Number.isSafeInteger(size) || size < 0 || size > 4 * 1024 ** 3)
    throw new BackupSourceBudgetError('Backup session exceeds archive budget')
  return { session, size, digest, warnings: sourceWarnings }
}

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
  const catalog = new BackupResourceCatalog()
  const sessions: PreparedBackupSession[] = []
  const warnings: BackupWarning[] = []
  let sessionBytes = 0
  let planBytes = 0
  const reserve = (value: unknown) => {
    planBytes += encoder.encode(JSON.stringify(value)).length
    if (planBytes > 4 * 1024 * 1024) throw new BackupSourceBudgetError('Backup preparation index exceeds budget')
  }
  for (const [index, id] of ids.entries()) {
    throwIfAborted(options.signal)
    options.onProgress?.({ phase: 'preparing', current: index, total: ids.length })
    try {
      const prepared = await prepareSessionSource(options.sessionStore, id, options.signal)
      catalog.add(collectSessionResourceReferences(prepared.session).references)
      sessionBytes += prepared.size
      if (sessionBytes > 4 * 1024 ** 3)
        throw new BackupSourceBudgetError('Backup exceeds 4 GiB; select fewer conversations')
      const descriptor: PreparedBackupSession = {
        id,
        name: prepared.session.name,
        size: prepared.size,
        layout: prepared.size > threshold ? 'sharded' : 'single',
        sourceDigest: prepared.digest,
      }
      reserve(descriptor)
      reserve(prepared.warnings)
      warnings.push(...prepared.warnings)
      sessions.push(descriptor)
    } catch (error) {
      throwIfAborted(options.signal)
      if (error instanceof BackupSourceBudgetError || error instanceof BackupResourceBudgetError) throw error
      const warning: BackupWarning = {
        code: 'session-read-failed',
        itemType: 'session',
        itemId: id,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1024),
      }
      reserve(warning)
      warnings.push(warning)
    }
  }
  let globalBytes = 0
  const globalData: import('./types').BackupManifest['data'] = {}
  for await (const entry of backupGlobalEntries(options, catalog, globalData, await options.storage.getAllKeys())) {
    if (!(entry.data instanceof Uint8Array) || entry.data.length > 4 * 1024 * 1024)
      throw new BackupSourceBudgetError('Global backup data exceeds budget')
    globalBytes += entry.data.length
  }
  for await (const entry of catalog.entries(options)) void entry
  const resourceBytes = catalog.resources.reduce((size, resource) => size + resource.size, 0)
  const estimatedBytes = sessionBytes + resourceBytes + globalBytes
  if (estimatedBytes > 4 * 1024 ** 3)
    throw new BackupSourceBudgetError('Backup exceeds 4 GiB; select fewer conversations')
  reserve(catalog.warnings)
  warnings.push(...catalog.warnings)
  options.onProgress?.({ phase: 'preparing', current: ids.length, total: ids.length })
  if (ids.length && !sessions.length)
    throw new Error(`No selected conversation can be backed up: ${warnings[0]?.message}`)
  return {
    formatVersion: sessions.some((session) => session.layout === 'sharded') ? 3 : 2,
    sessions,
    warnings,
    sessionBytes,
    resourceBytes,
    resourceCount: catalog.resources.length,
    estimatedBytes,
    selectedSessionIds: ids,
    exportItems: [...options.exportItems],
    includeKeys: options.includeKeys,
  }
}

export function preparedSessionReader(
  options: PreparationOptions,
  plan: BackupExportPlan
): (id: string) => Promise<Session> {
  return async (id) => {
    const expected = plan.sessions.find((session) => session.id === id)
    if (!expected || expected.layout !== 'single') throw new Error('Session was not prepared for single-file export')
    const actual = await prepareSessionSource(options.sessionStore, id, options.signal, expected.size + 1024 * 1024)
    if (actual.digest !== expected.sourceDigest || actual.size !== expected.size)
      throw new Error('Backup source changed after preparation')
    return actual.session
  }
}
