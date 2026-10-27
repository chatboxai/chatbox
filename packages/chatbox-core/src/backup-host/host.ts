import { createSessionMetaRecord } from '../application/session/session-metadata'
import { toBackupMessage, toBackupSession, toBackupThread } from '../backup-v3/records'
import type {
  BackupExportSource,
  BackupImportTarget,
  BackupImportIssueReporter,
  BackupImportSummary,
  BackupImportProjections,
} from '../backup-v3/types'
import {
  sessionImportCandidateId,
  type SessionRowImportWriter,
  type SessionRowImportIssueHandler,
  type SessionStoredRow,
} from '../ports/session-row-transfer'
import type { SessionRowRecord } from '../session/session-tree/types'
import { throwIfAborted } from '../utils/abort'
import { exportGlobals, ImportedGlobals } from './globals'
import type { BackupHostOptions } from './types'

const CANDIDATES = 'import-candidates'

async function cleanupCandidates(options: BackupHostOptions): Promise<void> {
  for await (const { value: candidateId } of options.workspace.entries(CANDIDATES)) {
    if (!options.rows.resumeImportRows) throw new Error('Row import cleanup is unavailable')
    let candidate: SessionRowImportWriter
    try {
      candidate = await options.rows.resumeImportRows(candidateId)
    } catch (error) {
      if (error instanceof Error && error.message === 'Import candidate is missing') continue
      throw error
    }
    await candidate.dispose()
  }
  await options.resources.cleanup(options.jobId)
}

/** Startup removes abandoned candidates and temporary files while keeping published data. */
export async function cleanupBackupImport(options: BackupHostOptions): Promise<void> {
  await cleanupCandidates(options)
  await options.workspace.dispose()
}

export function createBackupExportSource(
  options: BackupHostOptions,
  { includeGlobals = true }: { includeGlobals?: boolean } = {}
): BackupExportSource {
  return {
    openResource: (key) => options.resources.open(key),
    async *records(selection, signal) {
      if (includeGlobals) yield* exportGlobals(options, selection, signal)
      if (!selection.sessions) return
      const ids = selection.sessionIds ?? options.listSessionIds()
      for await (const sessionId of ids) {
        throwIfAborted(signal)
        await options.ensureRows(sessionId)
        const commit = await options.rows.readCommit(sessionId)
        if (!commit) throw new Error(`Conversation is unavailable: ${sessionId}`)
        const metadata = await options.metadata.getById(sessionId)
        yield {
          type: 'session',
          session: toBackupSession(commit.record),
          ...(metadata ? { meta: { sortOrder: metadata.sortOrder, createdAt: metadata.createdAt } } : {}),
        }
        for await (const row of options.rows.iterateRows({ sessionId, expectedRevision: commit.revision, signal }))
          yield row.kind === 'thread'
            ? { type: 'thread', thread: toBackupThread(row.thread) }
            : { type: 'message', message: toBackupMessage(row.message) }
      }
    },
  }
}

export function createBackupImportTarget(options: BackupHostOptions): BackupImportTarget {
  const { workspace, storage, rows, resources, jobId } = options
  let globals: ImportedGlobals | null = null
  let globalsPublished = false
  let active: SessionRowImportWriter | null = null
  let activeRecord: SessionRowRecord | null = null
  let activeMeta: { sortOrder: number; createdAt: number } | undefined
  let reportIssue: BackupImportIssueReporter | undefined
  let signal: AbortSignal | undefined
  const summary: BackupImportSummary = {
    importedSessions: 0,
    importedMessages: 0,
    importedResources: 0,
    importedGlobals: 0,
    skippedRecords: 0,
  }
  let activeMessages = 0,
    activeThreads = 0,
    skippedThreads = 0
  const rowIssue: SessionRowImportIssueHandler = (issue) => {
    if (issue.action === 'skipped') {
      summary.skippedRecords++
      if (issue.entity === 'thread') skippedThreads++
    }
    reportIssue?.({
      code: issue.reason,
      objectId: issue.id,
      sessionId: activeRecord?.id,
      message: `${issue.entity} ${issue.action}: ${issue.reason}`,
    })
  }
  const publishGlobals = async () => {
    if (!globals) throw new Error('Import has not started')
    if (globalsPublished) return
    const values = await globals.prepare()
    for (const [key, value] of values) {
      throwIfAborted(signal)
      await storage.set(key, value)
      summary.importedGlobals++
    }
    globalsPublished = true
  }
  const finishSession = async (projections?: BackupImportProjections) => {
    if (projections && projections.sessionId !== activeRecord?.id)
      throw new Error('Import projections do not match the active conversation')
    if (!active) return
    throwIfAborted(signal)
    const prepared = await active.prepare(rowIssue, projections?.forks)
    if (prepared?.skipSession || (activeMessages > 0 && prepared?.messageCount === 0)) {
      summary.skippedRecords += 1 + activeThreads - skippedThreads
      reportIssue?.({
        code: 'unusable-session',
        objectId: active.commit.record.id,
        sessionId: active.commit.record.id,
        message: 'The conversation was skipped because none of its messages could be restored.',
      })
      await active.dispose()
    } else {
      throwIfAborted(signal)
      await active.publish()
      summary.importedSessions++
      summary.importedMessages += prepared?.messageCount ?? activeMessages
      const record = active.commit.record
      try {
        await options.metadata.createMany([
          createSessionMetaRecord(record, activeMeta?.sortOrder ?? -Date.now(), activeMeta?.createdAt ?? Date.now()),
        ])
      } catch (error) {
        const message =
          'Conversation data was saved, but its list could not be updated. Use Recover Conversation List in settings.'
        reportIssue?.({ code: 'session-projection', objectId: record.id, sessionId: record.id, message })
        throw new AggregateError([error], message)
      }
    }
    activeMessages = activeThreads = skippedThreads = 0
    active = null
    activeRecord = null
    activeMeta = undefined
  }
  return {
    async begin(manifest, onIssue, abortSignal, context) {
      if (!rows.stageImportRows || !rows.resumeImportRows) throw new Error('Row import is unavailable')
      signal = abortSignal
      reportIssue = onIssue
      throwIfAborted(signal)
      globals = new ImportedGlobals(manifest, storage, context)
    },
    async appendRecords(records) {
      let batch: SessionStoredRow[] = []
      const flush = async () => {
        throwIfAborted(signal)
        if (batch.length && active) await active.appendRows(batch, rowIssue)
        batch = []
      }
      for (const entry of records) {
        throwIfAborted(signal)
        if (entry.type === 'global') {
          if (active || !globals || globalsPublished) throw new Error('Global records must precede conversations')
          if (!globals.append(entry)) {
            summary.skippedRecords++
            summary.settingsSkipped = true
            reportIssue?.({
              code: 'invalid-settings',
              objectId: entry.id,
              message: 'Settings in the backup are invalid and were skipped. Current settings were kept.',
            })
          }
        } else if (entry.type === 'session') {
          await flush()
          await finishSession()
          await publishGlobals()
          const record: SessionRowRecord = {
            ...entry.session,
            storageFormat: 'rows',
            rowFormatVersion: 3,
            rowAuthority: 1,
          }
          if (record.settings?.sessionPromptContextSnapshot && globals)
            record.settings = {
              ...record.settings,
              sessionPromptContextSnapshot: globals.snapshot(record.settings.sessionPromptContextSnapshot, record),
            }
          if (await options.records.getRecord(record.id)) await options.ensureRows(record.id)
          const previousRevision = await rows.getRevision(record.id)
          const metadata = await options.metadata.getById(record.id)
          activeMeta =
            entry.meta ?? (metadata ? { sortOrder: metadata.sortOrder, createdAt: metadata.createdAt } : undefined)
          const candidateId = sessionImportCandidateId(jobId, record.id)
          if (!(await workspace.put(CANDIDATES, record.id, candidateId))) throw new Error('Duplicate import session')
          if (!rows.stageImportRows) throw new Error('Row import is unavailable')
          active = await rows.stageImportRows(
            { record, revision: (previousRevision ?? 0) + 1 },
            previousRevision,
            jobId
          )
          activeRecord = record
        } else {
          const sessionId = entry.type === 'thread' ? entry.thread.sessionId : entry.message.sessionId
          if (!active || !activeRecord || activeRecord.id !== sessionId || !globals)
            throw new Error('Conversation rows must follow their header')
          if (entry.type === 'thread') {
            activeThreads++
            batch.push({
              kind: 'thread',
              thread: {
                ...entry.thread,
                activeLeafMessageId: null,
                ...(entry.thread.sessionPromptContextSnapshot
                  ? {
                      sessionPromptContextSnapshot: globals.snapshot(
                        entry.thread.sessionPromptContextSnapshot,
                        activeRecord
                      ),
                    }
                  : {}),
              },
            })
          } else {
            activeMessages++
            batch.push({
              kind: 'message',
              message: { ...entry.message, status: 'settled', message: globals.message(entry.message.message) },
            })
          }
        }
      }
      await flush()
    },
    async createResource(resource) {
      throwIfAborted(signal)
      const candidate = await resources.stage(jobId, resource)
      let closed = false
      return {
        write: (bytes) => candidate.write(bytes),
        abort: () => (closed ? Promise.resolve() : candidate.abort()),
        async close() {
          if (closed) return
          await candidate.close()
          throwIfAborted(signal)
          await resources.publish(jobId, resource.resourceId)
          closed = true
          summary.importedResources++
        },
      }
    },
    async prepare(projections) {
      await finishSession(projections)
      await publishGlobals()
      return { ...summary }
    },
    getSummary: () => ({ ...summary }),
    cleanup: () => cleanupCandidates(options),
  }
}
