import type {
  Message,
  Session,
  SessionAttachmentOwnershipClaim,
  SessionAttachmentRagMaintenanceResult,
  SessionAttachmentRagMaintenanceScope,
} from '@shared/types'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'
import { collectAttachmentOwnershipClaims } from '../../shared/session-attachment-rag/ownership'

const getSession = (sessionId: string) => rendererApplication.sessionQueryBridge.getSession(sessionId)
const listSessionsMetaPage = (page: number) => rendererApplication.sessions.listSessionsMetaPage(page)

const log = getLogger('session-attachment-rag-maintenance')
const ORPHAN_CLEANUP_INTERVAL_MS = 30 * 60 * 1000

let maintenanceStarted = false

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

async function collectMaintenanceScope(): Promise<SessionAttachmentRagMaintenanceScope> {
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
    const page = await listSessionsMetaPage(cursor)
    for (const sessionMeta of page.items) {
      sessionIds.push(sessionMeta.id)
      const session = await getSession(sessionMeta.id)
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

const maintenanceTasks: SessionAttachmentRagMaintenanceTask[] = [
  {
    name: 'full-maintenance-pass',
    intervalMs: ORPHAN_CLEANUP_INTERVAL_MS,
    run: async () => {
      const scope = await collectMaintenanceScope()
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

async function runMaintenanceTask(task: SessionAttachmentRagMaintenanceTask) {
  try {
    await task.run()
  } catch (error) {
    log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MAINTENANCE] Failed task ${task.name}:`, error)
  }
}

export async function runSessionAttachmentRagMaintenancePass() {
  const results = await Promise.all(maintenanceTasks.map((task) => task.run()))
  return (
    results.at(-1) ?? {
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds: [],
    }
  )
}

export function initSessionAttachmentRagMaintenance() {
  if (maintenanceStarted || !platform.isDesktopLike) {
    return
  }

  maintenanceStarted = true

  void runSessionAttachmentRagMaintenancePass()
  for (const task of maintenanceTasks) {
    setInterval(() => {
      void runMaintenanceTask(task)
    }, task.intervalMs)
  }
}
