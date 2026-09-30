import { createForkCommandIdentity } from '../session/ForkService'
import { withSessionGenerationLock } from '../../generation/generation-lock'
import { assertSessionActionAllowed, deriveSessionLockState } from '../../session/action-gates'
import { buildCreateForkPatch, buildSaveAndResendForkPatch, findMessageLocation } from '../../session/message-forks'
import type { Message, Session } from '../../types'
import type { SessionService } from '../session/SessionService'
import type { ChatGenerationPort } from './ChatMessageService'

export interface SaveAndResendDependencies {
  sessions: Pick<SessionService, 'getSession' | 'updateSessionWithMessages'> &
    Partial<Pick<SessionService, 'executeStructureCommand'>>
  generation: ChatGenerationPort
  createId(): string
  now(): number
  getRuntimeState?(sessionId: string): {
    compactionRunning?: boolean
    activeGenerationMessageIds?: ReadonlySet<string>
  }
}

export interface SaveAndResendRequest {
  sessionId: string
  messageId: string
  contentParts: Message['contentParts']
  /** The editor's opening snapshot; a concurrent edit must not be overwritten. */
  expectedContentParts: Message['contentParts']
  /** Invoked only after the replacement and reply placeholder are durable. */
  onPersisted?(): void
}

function mapLists(session: Session, transform: (messages: Message[]) => Message[]): Session {
  return {
    ...session,
    messages: transform(session.messages),
    threads: session.threads?.map((thread) => ({ ...thread, messages: transform(thread.messages) })),
    messageForksHash: session.messageForksHash
      ? Object.fromEntries(
          Object.entries(session.messageForksHash).map(([id, fork]) => [
            id,
            { ...fork, lists: fork.lists.map((list) => ({ ...list, messages: transform(list.messages) })) },
          ])
        )
      : undefined,
  }
}

/**
 * The RN editor keeps its draft mounted until this write commits, unlike the
 * renderer's fire-and-forget editor. Never fall back to overwriting the original
 * after a failed versioned write: it may already live in an archived branch.
 */
export function saveAndResendMessage(
  dependencies: SaveAndResendDependencies,
  request: SaveAndResendRequest
): Promise<void> {
  const { sessions, generation } = dependencies
  const { sessionId, messageId } = request
  return withSessionGenerationLock(sessionId, async () => {
    const reply: Message = {
      id: dependencies.createId(),
      role: 'assistant',
      contentParts: [],
      generating: true,
      timestamp: dependencies.now(),
    }
    const replacementId = dependencies.createId()
    const assertTarget = (session: Session): Message => {
      const location = findMessageLocation(session, messageId)
      const target = location?.list[location.index]
      if (!target || target.role !== 'user' || target.isSummary || target.isForkMarker) {
        throw new Error('Save & Resend requires a user message.')
      }
      const locks = deriveSessionLockState(session, dependencies.getRuntimeState?.(sessionId))
      assertSessionActionAllowed('save-and-resend', locks, { messageGenerating: target.generating === true })
      // Also cover preparing placeholders, compaction, and persisted pauses.
      assertSessionActionAllowed('submit-message', locks)
      if (JSON.stringify(target.contentParts) !== JSON.stringify(request.expectedContentParts)) {
        throw new Error('The message changed while editing. Reopen the editor before saving.')
      }
      if (!session.settings?.provider?.trim() || !session.settings.modelId?.trim()) {
        throw new Error('Select a model before sending.')
      }
      if (
        !request.contentParts.some((part) => part.type === 'image' || (part.type === 'text' && part.text.trim())) &&
        !target.files?.length &&
        !target.links?.length
      ) {
        throw new Error('Enter a message or add an attachment.')
      }
      return target
    }
    const current = await sessions.getSession(sessionId)
    if (!current) throw new Error('Session not found')
    const initialTarget = assertTarget(current)

    let persisted = false
    try {
      const structure = await sessions.executeStructureCommand?.(
        sessionId,
        {
          action: 'fork-save-resend',
          targetMessageId: messageId,
          expectedContentParts: request.expectedContentParts,
          replacement: {
            ...initialTarget,
            id: replacementId,
            contentParts: request.contentParts,
            timestamp: dependencies.now(),
            tokenCount: undefined,
            tokenCountMap: undefined,
            tokenCalculatedAt: undefined,
            tokenCountApproximate: undefined,
          },
          identity: createForkCommandIdentity(dependencies),
          append: [reply],
          guard: { action: 'submit-message', ...dependencies.getRuntimeState?.(sessionId) },
        },
        (result) => {
          persisted = result.applied
        }
      )
      if (!structure?.applied)
        await sessions.updateSessionWithMessages(
          sessionId,
          (latest) => {
            if (!latest) throw new Error('Session not found')
            const target = assertTarget(latest)
            const replacement: Message = {
              ...target,
              id: replacementId,
              contentParts: request.contentParts,
              timestamp: dependencies.now(),
              tokenCount: undefined,
              tokenCountMap: undefined,
              tokenCalculatedAt: undefined,
              tokenCountApproximate: undefined,
            }
            const patch = buildSaveAndResendForkPatch(latest, messageId, replacement, dependencies)
            let edited: Session
            let anchorId: string
            if (patch) {
              edited = { ...latest, ...patch }
              anchorId = replacement.id
            } else {
              // Match the renderer's legacy convention when no predecessor can
              // anchor a versioned prompt: retain the pivot id and fork its tail.
              const location = findMessageLocation(latest, messageId)
              if (!location || location.list.slice(0, location.index).some((message) => !message.isSummary)) {
                throw new Error('The active conversation changed while preparing to send. Please try again.')
              }
              edited = mapLists(latest, (messages) =>
                messages.map((message) => (message.id === messageId ? { ...replacement, id: messageId } : message))
              )
              const legacyPatch = buildCreateForkPatch(edited, messageId, dependencies)
              if (!legacyPatch) throw new Error('Unable to create a reply branch.')
              edited = { ...edited, ...legacyPatch }
              anchorId = messageId
            }
            return mapLists(edited, (messages) => {
              const index = messages.findIndex((message) => message.id === anchorId)
              return index < 0 ? messages : [...messages.slice(0, index + 1), reply, ...messages.slice(index + 1)]
            })
          },
          {
            preserveCachedGeneratingMessages: true,
            onFullSessionPersisted: () => {
              persisted = true
            },
          }
        )
    } catch (error) {
      if (!persisted) throw error
      // Session data is durable; a metadata projection failure must not cause
      // an editor retry to overwrite the original prompt in the saved branch.
    }
    try {
      request.onPersisted?.()
    } finally {
      // Navigation feedback must not strand a durable generating placeholder.
      await generation.orchestrate(sessionId, reply, { operationType: 'regenerate' })
    }
  })
}
