import { SessionWriteConflictError } from '../../ports/session-repository'
import type { SessionHeader } from '../../ports/session-read-model'
import { withSessionGenerationLock } from '../../generation/generation-lock'
import type { GenerationRuntimeStore } from '../../generation/runtime-store'
import {
  assertSessionActionAllowed,
  IDLE_SESSION_LOCK_STATE,
  SessionActionBlockedError,
} from '../../session/action-gates'
import type { SessionMessageStructureOperation } from '../../ports/session-structure-command'
import type { Message, SessionSettings } from '../../types'
import { createForkCommandIdentity } from '../session/ForkService'
import type { SessionService } from '../session/SessionService'

export type ChatMessageFiles = NonNullable<Message['files']>
export type ChatMessageLinks = NonNullable<Message['links']>

export interface ChatGenerationPort {
  orchestrate(
    sessionId: string,
    targetMessage: Message,
    options?: { operationType?: 'send_message' | 'regenerate'; submittedAt?: number }
  ): Promise<void>
}

export type ChatMessageSessionPort = Pick<
  SessionService,
  | 'createSession'
  | 'getSessionHeader'
  | 'readSessionMessages'
  | 'readSessionGenerationControl'
  | 'executeStructureCommand'
  | 'insertMessagesAtRevision'
  | 'updateMessage'
>

export interface ChatMessageServiceDependencies {
  sessions: ChatMessageSessionPort
  generation: ChatGenerationPort
  runtime?: GenerationRuntimeStore
  isCompactionRunning?(sessionId: string): boolean
  /** Runs inside the per-session generation lock before a new turn is persisted. */
  beforeSend?(sessionId: string, pendingUserMessage: Message): Promise<number | void>
  createId(): string
  now(): number
}

export interface ChatMessageInput {
  text: string
  files?: ChatMessageFiles
  imageStorageKeys?: string[]
  links?: ChatMessageLinks
}

export interface SendNewSessionRequest {
  submittedAt?: number
  copilot?: Pick<SessionHeader, 'copilotId' | 'assistantAvatarKey' | 'picUrl' | 'backgroundImage'>
  idempotencyKey: string
  input: ChatMessageInput
  sessionSettings: SessionSettings
  systemPrompt?: string
  name?: string
  previousSessionId?: string
  onSessionPersisted?(result: ChatSendResult): void | Promise<void>
}

export interface SendExistingSessionRequest {
  submittedAt?: number
  input: ChatMessageInput
  onMessagesPersisted?(result: ChatSendResult<SessionHeader>): void | Promise<void>
}

export interface ChatSendResult<TSession extends SessionHeader = SessionHeader> {
  assistantMessage: Message
  session: TSession
  userMessage: Message
}

export type ChatMessageValidationCode = 'empty-message' | 'missing-provider' | 'missing-model' | 'invalid-attachment'

export class ChatMessageValidationError extends Error {
  constructor(readonly code: ChatMessageValidationCode) {
    super(
      {
        'empty-message': 'Enter a message or add an attachment.',
        'missing-provider': 'Select a model provider before sending.',
        'missing-model': 'Select a model before sending.',
        'invalid-attachment': 'Every attachment must be persisted before sending.',
      }[code]
    )
    this.name = 'ChatMessageValidationError'
  }
}

export class ChatSendPreflightInvalidatedError extends Error {
  constructor() {
    super('The active conversation changed while preparing to send. Please try again.')
    this.name = 'ChatSendPreflightInvalidatedError'
  }
}

function defaultSessionName(input: ChatMessageInput): string {
  const text = input.text.trim().replace(/\s+/g, ' ')
  if (text) return text.slice(0, 48)
  return input.files?.[0]?.name || input.links?.[0]?.title || 'New Chat'
}

function validateInput(input: ChatMessageInput, settings: SessionSettings): void {
  if (!input.text.trim() && !input.files?.length && !input.imageStorageKeys?.length && !input.links?.length) {
    throw new ChatMessageValidationError('empty-message')
  }
  if (!settings.provider?.trim()) throw new ChatMessageValidationError('missing-provider')
  if (!settings.modelId?.trim()) throw new ChatMessageValidationError('missing-model')
  if (input.files?.some((file) => !file.storageKey) || input.links?.some((link) => !link.storageKey)) {
    throw new ChatMessageValidationError('invalid-attachment')
  }
}

/**
 * Host-neutral chat command surface used by product shells.
 *
 * Draft state and routing remain host concerns. This service owns validation,
 * single-flight first send, message graph writes and GenerationService entry.
 */
export class ChatMessageService {
  private readonly firstSendFlights = new Map<string, Promise<ChatSendResult>>()
  private readonly persistedFirstSends = new Set<string>()

  constructor(private readonly dependencies: ChatMessageServiceDependencies) {}

  async sendNewSession(request: SendNewSessionRequest): Promise<ChatSendResult> {
    validateInput(request.input, request.sessionSettings)
    const current = this.firstSendFlights.get(request.idempotencyKey)
    if (current) return await current

    const flight = this.sendNewSessionOnce({ ...request, submittedAt: request.submittedAt ?? this.dependencies.now() })
    this.firstSendFlights.set(request.idempotencyKey, flight)
    void flight.catch(() => {
      if (
        !this.persistedFirstSends.has(request.idempotencyKey) &&
        this.firstSendFlights.get(request.idempotencyKey) === flight
      ) {
        this.firstSendFlights.delete(request.idempotencyKey)
      }
    })
    return await flight
  }

  sendExistingSession(sessionId: string, request: SendExistingSessionRequest): Promise<ChatSendResult<SessionHeader>> {
    const submittedAt = request.submittedAt ?? this.dependencies.now()
    return withSessionGenerationLock(sessionId, async () => {
      const source = await this.requireHeader(sessionId)
      validateInput(request.input, source.header.settings ?? {})
      assertSessionActionAllowed('submit-message', await this.getLockState(sessionId, source.revision))
      const { assistantMessage, userMessage } = this.createTurn(request.input)
      const preparedRevision = await this.dependencies.beforeSend?.(sessionId, userMessage)
      const expectedRevision = preparedRevision ?? source.revision
      const current = await this.requireHeader(sessionId)
      if (current.revision !== expectedRevision) throw new ChatSendPreflightInvalidatedError()
      validateInput(request.input, current.header.settings ?? {})
      assertSessionActionAllowed('submit-message', await this.getLockState(sessionId, expectedRevision))
      let notified = false
      let committedSession: SessionHeader | undefined
      const postCommitErrors: unknown[] = []
      let notification: Promise<void> | undefined
      const onPersisted = (session: SessionHeader) => {
        if (notified) return
        notified = true
        committedSession = session
        notification = Promise.resolve().then(() =>
          request.onMessagesPersisted?.({ assistantMessage, session, userMessage })
        )
        void notification.catch(() => undefined)
      }
      let session: SessionHeader
      try {
        session = await this.dependencies.sessions.insertMessagesAtRevision(
          sessionId,
          [userMessage, assistantMessage],
          expectedRevision,
          onPersisted
        )
      } catch (error) {
        if (!committedSession) {
          if (error instanceof SessionWriteConflictError) throw new ChatSendPreflightInvalidatedError()
          throw error
        }
        // SessionService has published the durable content and scheduled metadata repair.
        session = committedSession
      }
      onPersisted(session)
      try {
        await notification
      } catch (error) {
        postCommitErrors.push(error)
      }
      const result = { assistantMessage, session, userMessage }
      // Once durable, the reply must run even when metadata or navigation feedback fails.
      try {
        await this.dependencies.generation.orchestrate(sessionId, assistantMessage, {
          operationType: 'send_message',
          submittedAt,
        })
      } catch (error) {
        postCommitErrors.push(error)
        try {
          await this.settleFailedReply(sessionId, assistantMessage.id, error)
        } catch (settleError) {
          postCommitErrors.push(settleError)
        }
      }
      if (postCommitErrors.length === 1) throw postCommitErrors[0]
      if (postCommitErrors.length > 1)
        throw new AggregateError(postCommitErrors, 'Failed to complete the persisted turn')
      return result
    })
  }

  async editMessage(sessionId: string, messageId: string, contentParts: Message['contentParts']): Promise<void> {
    await this.dependencies.sessions.updateMessage(sessionId, messageId, (latest) => {
      if (!latest) throw new Error(`Message ${messageId} not found`)
      assertSessionActionAllowed('edit-message', IDLE_SESSION_LOCK_STATE, {
        messageGenerating: latest.generating === true,
      })
      return { ...latest, contentParts, timestamp: this.dependencies.now() }
    })
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.dependencies.sessions.executeStructureCommand(
      sessionId,
      {
        action: 'message-remove',
        messageId,
        replacementPivotId: this.dependencies.createId(),
        guard: { action: 'delete-summary', ...this.runtimeState(sessionId) },
        activeGenerationMessageIds: this.runtimeIds(sessionId),
      },
      (result) => {
        for (const id of result.cancelMessageIds) this.dependencies.runtime?.discard(sessionId, id, 'message-deleted')
      }
    )
  }

  async clearMessages(sessionId: string): Promise<void> {
    await this.dependencies.sessions.executeStructureCommand(
      sessionId,
      {
        action: 'session-clear',
        scope: 'active',
        guard: { action: 'submit-message', ...this.runtimeState(sessionId) },
        activeGenerationMessageIds: this.runtimeIds(sessionId),
      },
      (result) => {
        for (const id of result.cancelMessageIds) this.dependencies.runtime?.discard(sessionId, id, 'session-cleared')
      }
    )
  }

  /** Flat candidates own independent runtimes and may start while another reply streams. */
  async replyBelow(sessionId: string, messageId: string): Promise<void> {
    const { runtime } = this.dependencies
    const lease = runtime?.acquireGenerationPreparationLease(sessionId)
    if (runtime && !lease) throw new SessionActionBlockedError('reply-below', 'generating')
    const reply: Message = { ...this.createMessage('assistant', ''), generating: true }
    let inserted = false
    const settleFailure = (error: unknown) => this.settleFailedReply(sessionId, reply.id, error)

    const operation = (): SessionMessageStructureOperation => ({
      action: 'message-insert-after',
      message: reply,
      previousId: messageId,
      requireAnchor: true,
      guard: {
        action: 'reply-below',
        activeGenerationMessageIds: new Set(runtime?.list(sessionId).map((state) => state.messageId)),
        compactionRunning: this.dependencies.isCompactionRunning?.(sessionId),
      },
    })

    try {
      const committed = await this.dependencies.sessions.executeStructureCommand(sessionId, operation(), (result) => {
        inserted = result.applied
      })
      if (!committed?.applied) throw new Error('Reply target is unavailable')
    } catch (error) {
      if (inserted) await settleFailure(error)
      throw error
    } finally {
      if (lease) runtime?.releaseGenerationPreparationLease(lease)
    }
    try {
      await this.dependencies.generation.orchestrate(sessionId, reply, { operationType: 'regenerate' })
    } catch (error) {
      await settleFailure(error)
      throw error
    }
  }

  retryMessage(sessionId: string, messageId: string): Promise<void> {
    return withSessionGenerationLock(sessionId, async () => {
      const reply = { ...this.createMessage('assistant', ''), generating: true }
      const result = await this.dependencies.sessions.executeStructureCommand(sessionId, {
        action: 'message-retry',
        messageId,
        reply,
        identity: createForkCommandIdentity({ createId: this.dependencies.createId, now: this.dependencies.now }),
        guard: { action: 'regenerate', ...this.runtimeState(sessionId) },
        activeGenerationMessageIds: this.runtimeIds(sessionId),
      })
      if (!result?.applied || !result.replyMessageId) throw new Error('Retry target is unavailable')
      const target = { ...reply, id: result.replyMessageId }
      try {
        await this.dependencies.generation.orchestrate(sessionId, target, { operationType: 'regenerate' })
      } catch (error) {
        await this.settleFailedReply(sessionId, target.id, error)
        throw error
      }
    })
  }

  private async settleFailedReply(sessionId: string, messageId: string, error: unknown): Promise<void> {
    await this.dependencies.sessions.updateMessage(sessionId, messageId, (current) => {
      if (!current) throw error
      return current.generating
        ? { ...current, generating: false, error: error instanceof Error ? error.message : String(error) }
        : current
    })
  }

  private async sendNewSessionOnce(request: SendNewSessionRequest): Promise<ChatSendResult> {
    const { assistantMessage, userMessage } = this.createTurn(request.input)
    const systemPrompt = request.systemPrompt?.trim()
    const messages: Message[] = systemPrompt
      ? [this.createMessage('system', systemPrompt), userMessage, assistantMessage]
      : [userMessage, assistantMessage]
    const session = await this.dependencies.sessions.createSession(
      {
        copilotId: request.copilot?.copilotId,
        assistantAvatarKey: request.copilot?.assistantAvatarKey,
        picUrl: request.copilot?.picUrl,
        backgroundImage: request.copilot?.backgroundImage,
        name: request.name?.trim() || defaultSessionName(request.input),
        type: 'chat',
        settings: request.sessionSettings,
        messages,
      },
      request.previousSessionId
    )
    this.persistedFirstSends.add(request.idempotencyKey)
    const result = { assistantMessage, session, userMessage }
    await request.onSessionPersisted?.(result)
    await withSessionGenerationLock(session.id, () =>
      this.dependencies.generation.orchestrate(session.id, assistantMessage, {
        operationType: 'send_message',
        submittedAt: request.submittedAt,
      })
    )
    return result
  }

  private createTurn(input: ChatMessageInput): Pick<ChatSendResult, 'assistantMessage' | 'userMessage'> {
    const contentParts: Message['contentParts'] = [
      ...(input.text.trim() ? [{ type: 'text' as const, text: input.text.trim() }] : []),
      ...(input.imageStorageKeys?.map((storageKey) => ({ type: 'image' as const, storageKey })) ?? []),
    ]
    return {
      userMessage: {
        ...this.createMessage('user', ''),
        contentParts,
        files: input.files,
        links: input.links,
      },
      assistantMessage: {
        ...this.createMessage('assistant', ''),
        generating: true,
      },
    }
  }

  private createMessage(role: Message['role'], text: string): Message {
    return {
      id: this.dependencies.createId(),
      role,
      contentParts: text ? [{ type: 'text', text }] : [],
      timestamp: this.dependencies.now(),
    }
  }

  private runtimeIds(sessionId: string): string[] {
    return this.dependencies.runtime?.list(sessionId).map((state) => state.messageId) ?? []
  }

  private runtimeState(sessionId: string) {
    return {
      activeGenerationMessageIds: new Set(this.runtimeIds(sessionId)),
      compactionRunning: this.dependencies.isCompactionRunning?.(sessionId),
    }
  }

  private async getLockState(sessionId: string, expectedRevision: number) {
    const control = await this.dependencies.sessions.readSessionGenerationControl({
      sessionId,
      activeGenerationMessageIds: this.runtimeIds(sessionId),
      expectedRevision,
    })
    if (!control) throw new Error(`Session ${sessionId} not found`)
    return { ...control, compactionRunning: this.dependencies.isCompactionRunning?.(sessionId) ?? false }
  }

  private async requireHeader(sessionId: string) {
    const read = await this.dependencies.sessions.getSessionHeader(sessionId)
    if (!read) throw new Error(`Session ${sessionId} not found`)
    return read
  }
}
