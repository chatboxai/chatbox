import { createForkCommandIdentity } from '../session/ForkService'
import { withSessionGenerationLock } from '../../generation/generation-lock'
import type { Message } from '../../types'
import type { SessionService } from '../session/SessionService'
import type { ChatGenerationPort } from './ChatMessageService'

export interface SaveAndResendDependencies {
  sessions: Pick<SessionService, 'executeStructureCommand' | 'updateMessage'>
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
  /** The editor's opening content; concurrent edits require reopening the editor. */
  expectedContentParts: Message['contentParts']
  onPersisted?(): void
}

/** Persists the edited version and reply atomically before notifying the editor. */
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
    const runtime = dependencies.getRuntimeState?.(sessionId)
    let persisted = false
    try {
      const result = await sessions.executeStructureCommand(
        sessionId,
        {
          action: 'fork-save-resend',
          targetMessageId: messageId,
          expectedContentParts: request.expectedContentParts,
          replacement: {
            id: dependencies.createId(),
            role: 'user',
            contentParts: request.contentParts,
            timestamp: dependencies.now(),
          },
          identity: createForkCommandIdentity(dependencies),
          append: [reply],
          guard: { action: 'submit-message', ...runtime },
          activeGenerationMessageIds: [...(runtime?.activeGenerationMessageIds ?? [])],
        },
        (result) => {
          persisted = result.applied
        }
      )
      if (!result?.applied) throw new Error('The message changed while editing. Reopen the editor before saving.')
    } catch (error) {
      if (!persisted) throw error
    }
    try {
      request.onPersisted?.()
    } finally {
      try {
        await generation.orchestrate(sessionId, reply, { operationType: 'regenerate' })
      } catch (error) {
        await sessions.updateMessage(sessionId, reply.id, (current) => {
          if (!current) throw error
          return current.generating
            ? { ...current, generating: false, error: error instanceof Error ? error.message : String(error) }
            : current
        })
        throw error
      }
    }
  })
}
