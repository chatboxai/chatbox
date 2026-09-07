import type {
  Message,
  Session,
  SessionAttachmentOwnershipClaim,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
  SessionMetaPage,
} from '@shared/types'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { sessionStartupRecovery } from '@/packages/session-startup-recovery'
import platform from '@/platform'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { collectAttachmentOwnershipClaims } from '../../shared/session-attachment-rag/ownership'

const log = getLogger('session-attachment-rag-maintenance')
const ORPHAN_CLEANUP_INTERVAL_MS = 30 * 60 * 1000
/** Longest the first pass waits for the session migration before it collects its scope anyway. */
const FIRST_PASS_WAIT_MS = 10 * 60 * 1000

let maintenanceStarted = false

export interface SessionAttachmentRagMaintenanceSource {
  getSession(sessionId: string): Promise<Session | null>
  listSessionsMetaPage(cursor: number): Promise<SessionMetaPage>
}

const defaultSource: SessionAttachmentRagMaintenanceSource = {
  getSession: (sessionId) => rendererApplication.sessionQueryBridge.getSession(sessionId),
  listSessionsMetaPage: (cursor) => rendererApplication.sessions.listSessionsMetaPage(cursor),
}

export interface SessionAttachmentRagMaintenanceOptions {
  source?: SessionAttachmentRagMaintenanceSource
  /**
   * Resolves once the background session row migration is over. Reading every
   * session migrates the ones still stored in their legacy form, so the first
   * pass waits instead of converting the whole library in one startup burst.
   */
  sessionMigrationDone?: Promise<void>
  firstPassWaitMs?: number
}

type SessionAttachmentRagMaintenanceTask = {
  name: string
  intervalMs: number
  run: () => Promise<SessionAttachmentRagMaintenanceResult>
}

function collectSessionMessages(session: Session): Message[] {
  const messages: Message[] = [...session.messages]

  for (const thread of session.threads ?? []) {
    messages.push(...thread.messages)
  }

  for (const fork of Object.values(session.messageForksHash ?? {})) {
    for (const list of fork.lists) {
      messages.push(...list.messages)
    }
  }

  return messages
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
      const session = await source.getSession(sessionMeta.id)
      if (!session) {
        continue
      }
      const messages = collectSessionMessages(session)
      for (const message of messages) {
        messageIds.add(message.id)
      }
      attachmentReferences.push(...collectAttachmentOwnershipClaims(sessionMeta.id, messages))
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
    await task.run()
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
  const results = await Promise.all(tasks.map((task) => task.run()))
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
  })()

  for (const task of tasks) {
    setInterval(() => {
      void runMaintenanceTask(task)
    }, task.intervalMs)
  }
}
