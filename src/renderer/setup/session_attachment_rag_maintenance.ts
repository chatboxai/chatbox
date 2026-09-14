import { withSessionWorkAccess } from '@/adapters/session-work-lock'
import type {
  SessionAttachmentOwnershipClaim,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionMetaPage,
} from '@shared/types'
import { rendererApplication, sessionRepository } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { sessionStartupRecovery } from '@/packages/session-startup-recovery'
import platform from '@/platform'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import type { SessionOwnership } from '@/adapters/session-ownership'

const log = getLogger('session-attachment-rag-maintenance')
const ORPHAN_CLEANUP_INTERVAL_MS = 30 * 60 * 1000
/** Longest the first pass waits for the session migration before it collects its scope anyway. */
const FIRST_PASS_WAIT_MS = 10 * 60 * 1000

let maintenanceStarted = false

export interface SessionAttachmentRagMaintenanceSource {
  getSessionOwnership(sessionId: string): Promise<SessionOwnership>
  listSessionsMetaPage(cursor: number): Promise<SessionMetaPage>
}

const defaultSource: SessionAttachmentRagMaintenanceSource = {
  getSessionOwnership: (sessionId) => sessionRepository.collectSessionAttachmentOwnership(sessionId),
  listSessionsMetaPage: (cursor) => rendererApplication.sessions.listSessionsMetaPage(cursor),
}

export interface SessionAttachmentRagMaintenanceOptions {
  source?: SessionAttachmentRagMaintenanceSource
  /**
   * Resolves once background session row migration is over. The first pass
   * waits to avoid competing with migration for storage I/O.
   */
  sessionMigrationDone?: Promise<void>
  firstPassWaitMs?: number
}

type SessionAttachmentRagMaintenanceTask = {
  name: string
  intervalMs: number
  run: () => Promise<SessionAttachmentRagMaintenanceResult>
}

async function collectMaintenanceScope(
  source: SessionAttachmentRagMaintenanceSource
): Promise<SessionAttachmentRagMaintenanceScope | null> {
  if (!platform.isDesktopLike) {
    return {
      sessionIds: [],
      messageIds: [],
      attachmentReferences: [],
    }
  }

  const messageIds = new Set<string>()
  const sessionIds: string[] = []
  const attachmentReferences: SessionAttachmentOwnershipClaim[] = []
  let cursor: number | null = 0
  while (cursor !== null) {
    const page = await source.listSessionsMetaPage(cursor)
    for (const sessionMeta of page.items) {
      if (sessionStartupRecovery.isRecoveryRequired(sessionMeta.id)) {
        return null
      }
      sessionIds.push(sessionMeta.id)
      const ownership = await source.getSessionOwnership(sessionMeta.id)
      for (const id of ownership.messageIds) messageIds.add(id)
      for (const reference of ownership.attachmentReferences) attachmentReferences.push(reference)
    }
    cursor = page.nextCursor
  }

  return {
    sessionIds,
    messageIds: Array.from(messageIds),
    attachmentReferences,
  }
}

function createMaintenanceTasks(source: SessionAttachmentRagMaintenanceSource): SessionAttachmentRagMaintenanceTask[] {
  return [
    {
      name: 'full-maintenance-pass',
      intervalMs: ORPHAN_CLEANUP_INTERVAL_MS,
      run: async () => {
        const scope = await collectMaintenanceScope(source)
        if (!scope) {
          return {
            interruptedFailedCount: 0,
            canceledPurgedCount: 0,
            orphanDeletedIds: [],
          }
        }
        const result = await platform.getSessionAttachmentRagController().runMaintenance(scope)

        if (result.interruptedFailedCount > 0 || result.canceledPurgedCount > 0 || result.orphanDeletedIds.length > 0) {
          log.info(
            `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MAINTENANCE] Completed pass: interruptedFailed=${result.interruptedFailedCount}, canceledPurged=${result.canceledPurgedCount}, orphanDeleted=${result.orphanDeletedIds.length}`
          )
        }

        return result
      },
    },
  ]
}

async function runMaintenanceTask(task: SessionAttachmentRagMaintenanceTask) {
  try {
    await rendererApplication.backupOperations.runBackground(() => withSessionWorkAccess(() => task.run()))
  } catch (error) {
    log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MAINTENANCE] Failed task ${task.name}:`, error)
  }
}

/** Waits for the session migration, giving up after `waitMs` so a stalled migration cannot hold maintenance back. */
async function waitForSessionMigration(pending: Promise<void>, waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    pending,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs)
    }),
  ])
  clearTimeout(timer)
}

export async function runSessionAttachmentRagMaintenancePass(options: SessionAttachmentRagMaintenanceOptions = {}) {
  const tasks = createMaintenanceTasks(options.source ?? defaultSource)
  const results = await Promise.all(
    tasks.map((task) =>
      rendererApplication.backupOperations.runBackground(() => withSessionWorkAccess(() => task.run()))
    )
  )
  return (
    results.at(-1) ?? {
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds: [],
    }
  )
}

export function initSessionAttachmentRagMaintenance(options: SessionAttachmentRagMaintenanceOptions = {}) {
  if (maintenanceStarted || !platform.isDesktopLike) {
    return
  }

  maintenanceStarted = true

  const source = options.source ?? defaultSource
  const tasks = createMaintenanceTasks(source)

  void (async () => {
    if (options.sessionMigrationDone) {
      await waitForSessionMigration(options.sessionMigrationDone, options.firstPassWaitMs ?? FIRST_PASS_WAIT_MS)
    }
    await runSessionAttachmentRagMaintenancePass({ source })
  })().catch((error: unknown) => {
    log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MAINTENANCE] Initial pass failed:`, error)
  })

  for (const task of tasks) {
    setInterval(() => {
      void runMaintenanceTask(task)
    }, task.intervalMs)
  }
}
