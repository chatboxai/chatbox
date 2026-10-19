import { createForkCommandIdentity } from '@chatbox/core/application/session'
import type { SessionHeader } from '@chatbox/core/ports'
import { SessionActionBlockedError } from '@chatbox/core/session/action-gates'
import { withSessionGenerationLock } from '@chatbox/core/generation'
import { isActionAvailableInMode, resolveSessionMode } from '@chatbox/core/session/mode-policy'
import { buildContext } from '@shared/context'
import type { AttachmentResolver } from '@shared/context/types'
import { supportsSessionGeneration } from '@shared/session/capabilities'
import { type CompactionPoint, createMessage, type Message, type SessionSettings } from '@shared/types'
import { countMessageWords } from '@shared/utils/message'
import { v4 as uuidv4 } from 'uuid'
import { currentGenerationService } from '@/adapters/CurrentGenerationService'
import { rendererApplication } from '@/app/renderer-application'
import { estimateTokensFromMessages } from '@/packages/token'
import { guardBackupWrite } from '@/app/backup-operation-guard'
import { guardSessionAction } from './action-guard'
import { createAttachmentResolver } from './attachment-resolver'
import { createNewFork, createSaveAndResendFork } from './forks'
import { insertMessageAfter, modifyMessage } from './messages'
import { getSessionHeader, getSessionTokenModel } from './session-settings'
import type { AgentModeEntrySource } from './types'

/** Internal generation entry point for callers that already hold the session generation lock. */
export async function _generateWithoutSessionLock(
  sessionId: string,
  targetMsg: Message,
  options?: {
    operationType?: 'send_message' | 'regenerate'
    skipAgentModeSuggestion?: boolean
    agentModeEntrySource?: AgentModeEntrySource
  }
) {
  const session = await getSessionHeader(sessionId)
  if (!session) {
    return
  }

  if (!supportsSessionGeneration(session.type)) {
    return
  }

  await currentGenerationService.orchestrate(sessionId, targetMsg, options)
}

export async function retryFromLastToolCallAfterApiError(sessionId: string, messageId: string, toolCallId: string) {
  // Regenerate-class entry: enforce the session action gate before delegating
  // to the shared service so a stale caller cannot race a streaming reply.
  if (!(await guardSessionAction(sessionId, 'regenerate'))) {
    return
  }
  return currentGenerationService.retryFromLastToolCallAfterApiError(sessionId, messageId, toolCallId)
}

export async function generate(
  sessionId: string,
  targetMsg: Message,
  options?: {
    operationType?: 'send_message' | 'regenerate'
    skipAgentModeSuggestion?: boolean
    agentModeEntrySource?: AgentModeEntrySource
  }
) {
  if (!(await guardBackupWrite())) return
  return withSessionGenerationLock(sessionId, () => _generateWithoutSessionLock(sessionId, targetMsg, options))
}

/**
 * Insert and generate a new message below the target message
 * @param sessionId Session ID
 * @param msgId Message ID
 */
async function generateReplyBelowWithoutSessionLock(sessionId: string, msgId: string) {
  const newAssistantMsg = createMessage('assistant', '')
  newAssistantMsg.generating = true // prevent estimating token count before generating done
  const preparationLease = rendererApplication.generationRuntime.acquireGenerationPreparationLease(sessionId)
  if (!preparationLease) throw new SessionActionBlockedError('reply-below', 'generating')
  let inserted = false
  try {
    await insertMessageAfter(sessionId, newAssistantMsg, msgId, {
      preserveCachedGeneratingMessages: true,
      onPersisted: () => {
        inserted = true
      },
    })
  } catch (error) {
    if (inserted) {
      await rendererApplication.sessions.updateMessage(sessionId, newAssistantMsg.id, (current) => {
        if (!current) throw error
        return current.generating
          ? { ...current, generating: false, error: error instanceof Error ? error.message : String(error) }
          : current
      })
    }
    throw error
  } finally {
    rendererApplication.generationRuntime.releaseGenerationPreparationLease(preparationLease)
  }
  await _generateWithoutSessionLock(sessionId, newAssistantMsg, { operationType: 'regenerate' })
}

/**
 * Reply Again Below: insert a new reply flat into the active path, right after
 * the target message. Alternatives stay ordinary messages (comparable in place,
 * individually editable/deletable) instead of saved fork branches — see
 * docs/technical/chat-work-mode-split.md. Deliberately skips the session
 * generation lock so several candidates can stream concurrently; orchestrate()
 * drains unsettled streams before dispatching.
 */
export async function generateMore(sessionId: string, msgId: string) {
  if (!(await guardBackupWrite())) return
  const session = (await rendererApplication.sessions.getSessionHeader(sessionId))?.header ?? null
  if (!session || !supportsSessionGeneration(session.type)) {
    return
  }
  // Mode-policy backstop for entry points the UI failed to hide (stale
  // surfaces, programmatic callers): work mode has no Reply Again Below.
  // Session-persisted mode only — the uiStore legacy-map fallback stays a UI
  // concern; this is defense-in-depth behind the hidden entry, not the gate.
  if (!isActionAvailableInMode('reply-below', resolveSessionMode(session.settings?.agentMode?.value))) {
    return
  }
  return generateReplyBelowWithoutSessionLock(sessionId, msgId)
}

/**
 * Fall back to keeping the edit without resending it. MessageEdit closes as
 * soon as it hands the edit over and void-calls the action, so any failure on
 * the resend path would otherwise take the user's text with it; the write path
 * re-reads the session on its own, and a failure there leaves nothing to
 * recover with — the caller cannot observe rejections either way.
 */
async function saveEditWithoutResend(sessionId: string, editedMessage: Message) {
  try {
    await modifyMessage(sessionId, editedMessage, true)
  } catch (error) {
    console.warn('Failed to save the edited message after Save & Resend was aborted:', error)
  }
}

/**
 * Save & Resend: version the edited message instead of overwriting it in
 * place. [original, ...old tail] are preserved as a fork branch under the
 * predecessor (same pivot convention as regenerateInNewFork) and the edited
 * copy — a NEW message id — heads the fresh active tail before getting its
 * reply, so the stored branch keeps the prompt its replies actually answered.
 * Targets without an eligible predecessor (conversation-first message) keep
 * the legacy shape: overwrite in place, old replies forked under the target.
 */
export async function saveAndResendMessage(
  sessionId: string,
  editedMessage: Message,
  options?: { runGenerateMore?: GenerateMoreFn }
) {
  if (!(await guardBackupWrite())) return
  const runGenerateMore = options?.runGenerateMore ?? generateReplyBelowWithoutSessionLock
  // The target is resolved again inside the session lock. It may have started
  // streaming since the editor's pre-check, including the short window before
  // its AbortController is registered.
  return withSessionGenerationLock(sessionId, async () => {
    let session: SessionHeader | null
    try {
      session = (await rendererApplication.sessions.getSessionHeader(sessionId))?.header ?? null
    } catch {
      await saveEditWithoutResend(sessionId, editedMessage)
      return
    }
    if (!session || !supportsSessionGeneration(session.type)) {
      return
    }
    const targetMessage = (
      await rendererApplication.sessions.readSessionMessages({ sessionId, messageIds: [editedMessage.id] })
    )?.messages[0]
    if (!targetMessage) return
    if (
      !(await guardSessionAction(
        sessionId,
        'save-and-resend',
        { messageGenerating: targetMessage.generating === true },
        session
      ))
    ) {
      // Only the resend is blocked; the edit is still saved so the user's
      // text survives the race.
      await saveEditWithoutResend(sessionId, editedMessage)
      return
    }
    const replacement: Message = {
      ...editedMessage,
      id: uuidv4(),
      timestamp: Date.now(),
      wordCount: countMessageWords(editedMessage),
      tokenCount: 0,
      tokenCountMap: undefined,
      tokenCountApproximate: undefined,
    }
    // Estimated with the map already cleared: the estimate trusts a carried
    // entry, and the edited text invalidates whatever the original carried.
    replacement.tokenCount = estimateTokensFromMessages([replacement], 'output', getSessionTokenModel(session))
    let forked: boolean
    try {
      forked = await createSaveAndResendFork(sessionId, editedMessage.id, replacement)
    } catch {
      // The fork write only rejects when nothing reached storage, so the edit
      // still exists in this call alone. Save it where the original prompt
      // also still is, instead of losing it with the resend.
      await saveEditWithoutResend(sessionId, editedMessage)
      return
    }
    if (forked) {
      await runGenerateMore(sessionId, replacement.id)
      return
    }
    await modifyMessage(sessionId, editedMessage, true)
    await createNewFork(sessionId, editedMessage.id)
    await runGenerateMore(sessionId, editedMessage.id)
  })
}

type GenerateMoreFn = (sessionId: string, msgId: string) => Promise<void>

export async function regenerateInNewFork(
  sessionId: string,
  msg: Message,
  options?: { runGenerateMore?: GenerateMoreFn }
) {
  if (!(await guardBackupWrite())) return
  return withSessionGenerationLock(sessionId, async () => {
    if (!(await guardSessionAction(sessionId, 'regenerate'))) {
      return
    }
    return regenerateInNewForkWithoutSessionLock(sessionId, msg, options)
  })
}

async function regenerateInNewForkWithoutSessionLock(
  sessionId: string,
  msg: Message,
  options?: { runGenerateMore?: GenerateMoreFn }
) {
  const session = (await rendererApplication.sessions.getSessionHeader(sessionId))?.header
  if (!session || !supportsSessionGeneration(session.type)) return
  const reply = { ...createMessage('assistant', ''), generating: true }
  const result = await rendererApplication.sessions.executeStructureCommand(sessionId, {
    action: 'message-retry',
    messageId: msg.id,
    reply,
    identity: createForkCommandIdentity({ createId: uuidv4, now: Date.now }),
    activeGenerationMessageIds: [...rendererApplication.generationRuntime.getActiveMessageIds(sessionId)],
    guard: {
      action: 'regenerate',
      activeGenerationMessageIds: rendererApplication.generationRuntime.getActiveMessageIds(sessionId),
    },
  })
  if (!result?.applied || !result.replyMessageId) return
  const target = { ...reply, id: result.replyMessageId }
  try {
    await _generateWithoutSessionLock(sessionId, target, { operationType: 'regenerate' })
  } catch (error) {
    await rendererApplication.sessions.updateMessage(sessionId, target.id, (current) => {
      if (!current) throw error
      return current.generating
        ? { ...current, generating: false, error: error instanceof Error ? error.message : String(error) }
        : current
    })
    throw error
  }
}

/**
 * Build message context for prompt
 * Thin wrapper over shared buildContext() for backward compatibility
 *
 * @param settings Session settings
 * @param msgs Original message list
 * @param modelSupportToolUseForFile Whether model supports file reading tool (if supported, file content is not directly included)
 * @param optionsOrAdapter Optional configuration object OR legacy storageAdapter (for backward compatibility)
 * @returns Processed message list
 */
export async function genMessageContext(
  settings: SessionSettings,
  msgs: Message[],
  modelSupportToolUseForFile: boolean,
  optionsOrAdapter?:
    | {
        storageAdapter?: { getBlob: (key: string) => Promise<string> }
        compactionPoints?: CompactionPoint[]
      }
    | { getBlob: (key: string) => Promise<string> }
): Promise<Message[]> {
  let storageAdapter: { getBlob: (key: string) => Promise<string> } | undefined
  let compactionPoints: CompactionPoint[] | undefined

  if (optionsOrAdapter) {
    if ('getBlob' in optionsOrAdapter) {
      storageAdapter = optionsOrAdapter
    } else {
      storageAdapter = optionsOrAdapter.storageAdapter
      compactionPoints = optionsOrAdapter.compactionPoints
    }
  }

  const attachmentResolver = storageAdapter
    ? createAttachmentResolverFromAdapter(storageAdapter)
    : createAttachmentResolver()

  return buildContext(msgs, {
    attachmentResolver,
    compactionPoints,
    maxContextMessageCount: settings.maxContextMessageCount,
    modelSupportToolUseForFile,
  })
}

/**
 * Helper to create AttachmentResolver from legacy storageAdapter interface
 * Used by integration tests that pass custom storage adapter
 */
function createAttachmentResolverFromAdapter(adapter: {
  getBlob: (key: string) => Promise<string>
}): AttachmentResolver {
  return {
    async read(id) {
      return adapter.getBlob(id).catch(() => null as string | null)
    },
  }
}

// Re-export for backward compatibility
export { getSessionWebBrowsing } from './utils'
