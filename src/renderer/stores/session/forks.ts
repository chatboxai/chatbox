import { ForkService } from '@chatbox/core/application/session'
import { getReachableSessionMessages } from '@chatbox/core/session/generation-state'
import {
  buildDeleteForkPatch,
  buildSaveAndResendForkPatch,
  buildSwitchForkToPatch,
  findMessageLocation,
} from '@shared/session/message-forks'
import { planAttachmentOwnershipTransfers } from '@shared/session-attachment-rag/ownership'
import type { Message } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { rendererApplication } from '@/app/renderer-application'
import platform from '@/platform'
import { guardSessionAction } from './action-guard'

const forkIdentity = {
  createId: uuidv4,
  now: Date.now,
}

const forkService = new ForkService(
  {
    updateSessionWithMessages: (sessionId, updater) =>
      rendererApplication.sessions.updateSessionWithMessages(sessionId, updater, {
        preserveCachedGeneratingMessages: true,
      }),
  },
  forkIdentity
)

// Keep the existing lookup export stable for generation and message callers.
export { findMessageLocation }

// Every fork mutation is a full-session write and must pass
// `preserveCachedGeneratingMessages`: alternative replies stream outside the
// session generation lock with cache-only chunk updates, so a plain write would
// roll their visible content back to the last 2s persistence snapshot.

/** Create a new fork branch at the specified message. */
export function createNewFork(sessionId: string, forkMessageId: string) {
  return forkService.create(sessionId, forkMessageId)
}

/**
 * Save & Resend in one write: store [original message, ...old tail] as a
 * branch under the target's predecessor and put the edited replacement at the
 * head of the new active tail. A single session write keeps the prompt from
 * flickering out of the list between a fork write and an insert write.
 * Returns false when the shape does not apply (no eligible predecessor /
 * stale target) so the caller can fall back to the legacy overwrite path.
 * Rejects only when nothing reached storage, so a rejection always means the
 * original prompt is still where the caller left it.
 */
export async function createSaveAndResendFork(
  sessionId: string,
  targetMessageId: string,
  replacement: Message
): Promise<boolean> {
  let applied = false
  let persisted = false
  try {
    await rendererApplication.sessions.updateSessionWithMessages(
      sessionId,
      (session) => {
        if (!session) {
          throw new Error('Session not found')
        }
        const patch = buildSaveAndResendForkPatch(session, targetMessageId, replacement, forkIdentity)
        if (!patch) {
          return session
        }
        applied = true
        return { ...session, ...patch }
      },
      {
        preserveCachedGeneratingMessages: true,
        onFullSessionPersisted: () => {
          persisted = true
        },
      }
    )
  } catch (error) {
    // A failed list-metadata projection still rejects after the session data
    // itself is durable. The branch already holds the original prompt under
    // its original id, so report the fork: re-saving the edit under that id
    // would overwrite the archived prompt inside the branch.
    if (!persisted) {
      throw error
    }
    console.warn('Save & Resend fork is durable but its session metadata write failed:', error)
  }
  return applied
}

/** Switch between fork branches. */
export async function switchFork(sessionId: string, forkMessageId: string, direction: 'next' | 'prev') {
  if (!(await guardSessionAction(sessionId, 'switch-fork'))) {
    return
  }
  return forkService.switch(sessionId, forkMessageId, direction)
}

/** Switch directly to a saved fork branch by its position. */
export async function switchForkTo(sessionId: string, forkMessageId: string, position: number) {
  if (!(await guardSessionAction(sessionId, 'switch-fork'))) {
    return
  }
  await rendererApplication.sessions.updateSessionWithMessages(
    sessionId,
    (session) => {
      if (!session) {
        throw new Error('Session not found')
      }
      const patch = buildSwitchForkToPatch(session, forkMessageId, position)
      return patch ? { ...session, ...patch } : session
    },
    { preserveCachedGeneratingMessages: true }
  )
}

/** Delete the current fork branch. */
export async function deleteFork(sessionId: string, forkMessageId: string) {
  if (!(await guardSessionAction(sessionId, 'delete-fork'))) {
    return
  }
  let removedMessageIds = new Set<string>()
  let droppedMessages: Message[] = []
  let survivingMessages: Message[] = []
  const discardRemovedRuntimes = () => {
    for (const messageId of removedMessageIds) {
      rendererApplication.generationRuntime.discard(sessionId, messageId, 'fork-deleted')
    }
    // Attachment rows of dropped messages are left to orphan maintenance;
    // rows shared with surviving messages (Save & Resend versioning) are
    // handed over here so they stay reachable right away. Maintenance repairs
    // ownership on its own, so a failure below costs latency, not the file.
    void reassignSharedAttachmentOwnership(sessionId, droppedMessages, survivingMessages)
  }
  await rendererApplication.sessions.updateSessionWithMessages(
    sessionId,
    (session) => {
      if (!session) {
        throw new Error('Session not found')
      }
      const patch = buildDeleteForkPatch(session, forkMessageId)
      if (!patch) return session

      const updated = { ...session, ...patch }
      survivingMessages = getReachableSessionMessages(updated)
      const reachableAfter = new Set(survivingMessages.map((message) => message.id))
      droppedMessages = getReachableSessionMessages(session).filter((message) => !reachableAfter.has(message.id))
      removedMessageIds = new Set(
        droppedMessages
          .filter(
            (message) =>
              message.role === 'assistant' &&
              (message.generating || rendererApplication.generationRuntime.get(sessionId, message.id) !== undefined)
          )
          .map((message) => message.id)
      )
      return updated
    },
    {
      preserveCachedGeneratingMessages: true,
      onFullSessionPersisted: discardRemovedRuntimes,
    }
  )
}

async function reassignSharedAttachmentOwnership(sessionId: string, removed: Message[], survivors: Message[]) {
  if (!platform.isDesktopLike || removed.length === 0) {
    return
  }
  try {
    const controller = platform.getSessionAttachmentRagController()
    for (const transfer of planAttachmentOwnershipTransfers(removed, survivors)) {
      await controller.rebindAttachment({
        attachmentId: transfer.attachmentId,
        sessionId,
        messageId: transfer.messageId,
      })
    }
  } catch (error) {
    console.warn('Failed to reassign shared session attachments after fork deletion:', error)
  }
}

/** Expand all fork branches into the current message list. @deprecated */
export function expandFork(sessionId: string, forkMessageId: string) {
  return forkService.expand(sessionId, forkMessageId)
}
