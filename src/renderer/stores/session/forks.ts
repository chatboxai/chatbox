import { ForkService } from '@chatbox/core/application/session'
import type { Message } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { rendererApplication } from '@/app/renderer-application'
import { guardSessionAction } from './action-guard'
import { cleanupSessionAttachments } from './attachment-cleanup'

const forkIdentity = {
  createId: uuidv4,
  now: Date.now,
}

const forkService = new ForkService(
  {
    executeStructureCommand: (sessionId, operation, onCommitted) =>
      rendererApplication.sessions.executeStructureCommand(sessionId, operation, onCommitted),
  },
  forkIdentity,
  (sessionId) => ({
    activeGenerationMessageIds: new Set(
      rendererApplication.generationRuntime.list(sessionId).map((entry) => entry.messageId)
    ),
  })
)

/** Create a new fork branch at the specified message. */
export function createNewFork(sessionId: string, forkMessageId: string) {
  return forkService.create(sessionId, forkMessageId)
}

/** Versions the edited prompt and reply tail in one committed row command. */
export async function createSaveAndResendFork(
  sessionId: string,
  targetMessageId: string,
  replacement: Message
): Promise<boolean> {
  let applied = false
  let persisted = false
  try {
    const result = await forkService.saveAndResend(sessionId, targetMessageId, replacement, (result) => {
      persisted = true
      applied = result.applied
    })
    applied = result.applied
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

/** Switch directly to a saved fork branch by its stable identity. */
export async function switchForkTo(sessionId: string, forkMessageId: string, branchId: string) {
  if (!(await guardSessionAction(sessionId, 'switch-fork'))) {
    return
  }
  await forkService.switch(sessionId, forkMessageId, { branchId })
}

/** Delete the current fork branch. */
export async function deleteFork(sessionId: string, forkMessageId: string) {
  if (!(await guardSessionAction(sessionId, 'delete-fork'))) {
    return
  }
  await forkService.delete(sessionId, forkMessageId, (result) => {
    for (const messageId of result.cancelMessageIds)
      rendererApplication.generationRuntime.discard(sessionId, messageId, 'fork-deleted')
    if (result.applied) void cleanupSessionAttachments(sessionId)
  })
}

/** Expand all fork branches into the current message list. @deprecated */
export function expandFork(sessionId: string, forkMessageId: string) {
  return forkService.expand(sessionId, forkMessageId)
}
