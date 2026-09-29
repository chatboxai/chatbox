import { withSessionGenerationLock } from '../../generation/generation-lock'
import type { GenerationRuntimeStore } from '../../generation/runtime-store'
import {
  assertSessionActionAllowed,
  deriveSessionLockState,
  SessionActionBlockedError,
} from '../../session/action-gates'
import { isActionAvailableInMode, resolveSessionMode } from '../../session/mode-policy'
import { buildCreateForkPatch, findMessageLocation } from '../../session/message-forks'
import type { Message, Session, SessionSettings } from '../../types'
import type { UpdateSessionOptions } from '../session/SessionService'
import { applyMessageInsert, applyMessageRemoval } from '../session/message-tree'

export type ChatMessageFiles = NonNullable<Message['files']>
export type ChatMessageLinks = NonNullable<Message['links']>

export interface ChatGenerationPort {
  orchestrate(
    sessionId: string,
    targetMessage: Message,
    options?: { operationType?: 'send_message' | 'regenerate'; submittedAt?: number }
  ): Promise<void>
}

export interface ChatMessageSessionPort {
  createSession(session: Omit<Session, 'id'>, previousId?: string): Promise<Session>
  getSession(sessionId: string): Promise<Session | null>
  updateSessionWithMessages(
    sessionId: string,
    updater: (session: Session | null | undefined) => Session,
    options?: Pick<UpdateSessionOptions, 'preserveCachedGeneratingMessages' | 'onFullSessionPersisted'>
  ): Promise<Session>
}

export interface ChatMessageServiceDependencies {
  sessions: ChatMessageSessionPort
  generation: ChatGenerationPort
  runtime?: GenerationRuntimeStore
  isCompactionRunning?(sessionId: string): boolean
  /** Runs inside the per-session generation lock before a new turn is persisted. */
  beforeSend?(sessionId: string, pendingUserMessage: Message): Promise<void>
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
  copilot?: Pick<Session, 'copilotId' | 'assistantAvatarKey' | 'picUrl' | 'backgroundImage'>
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
  onMessagesPersisted?(result: ChatSendResult): void | Promise<void>
}

export interface ChatSendResult {
  assistantMessage: Message
  session: Session
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

function sendTargetRevision(session: Session): string {
  const activeMessages = session.messages
    .filter((message) => !message.isSummary)
    .map((message) => ({
      contentParts: message.contentParts,
      files: message.files,
      id: message.id,
      links: message.links,
      role: message.role,
      timestamp: message.timestamp,
    }))
  return JSON.stringify({
    activeMessages,
    modelId: session.settings?.modelId ?? null,
    provider: session.settings?.provider ?? null,
  })
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

function replaceMessage(session: Session, messageId: string, update: (message: Message) => Message): Session {
  const rootIndex = session.messages.findIndex((message) => message.id === messageId)
  if (rootIndex >= 0) {
    return {
      ...session,
      messages: session.messages.map((message, index) => (index === rootIndex ? update(message) : message)),
    }
  }

  let changed = false
  const threads = session.threads?.map((thread) => {
    const index = thread.messages.findIndex((message) => message.id === messageId)
    if (index < 0) return thread
    changed = true
    return {
      ...thread,
      messages: thread.messages.map((message, messageIndex) => (messageIndex === index ? update(message) : message)),
    }
  })
  if (changed) return { ...session, threads }

  const messageForksHash = session.messageForksHash
    ? Object.fromEntries(
        Object.entries(session.messageForksHash).map(([forkId, fork]) => [
          forkId,
          {
            ...fork,
            lists: fork.lists.map((list) => ({
              ...list,
              messages: list.messages.map((message) => (message.id === messageId ? update(message) : message)),
            })),
          },
        ])
      )
    : undefined
  return { ...session, messageForksHash }
}

function appendMessageToConversation(session: Session, pivotId: string, message: Message): Session {
  if (session.messages.some((candidate) => candidate.id === pivotId)) {
    return { ...session, messages: [...session.messages, message] }
  }

  let changed = false
  const threads = session.threads?.map((thread) => {
    if (changed || !thread.messages.some((candidate) => candidate.id === pivotId)) return thread
    changed = true
    return { ...thread, messages: [...thread.messages, message] }
  })
  if (!changed) throw new Error(`Unable to append a retry after ${pivotId}`)
  return { ...session, threads }
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

  sendExistingSession(sessionId: string, request: SendExistingSessionRequest): Promise<ChatSendResult> {
    const submittedAt = request.submittedAt ?? this.dependencies.now()
    return withSessionGenerationLock(sessionId, async () => {
      const current = await this.requireSession(sessionId)
      validateInput(request.input, current.settings ?? {})
      assertSessionActionAllowed('submit-message', deriveSessionLockState(current))
      const initialTargetRevision = sendTargetRevision(current)
      const { assistantMessage, userMessage } = this.createTurn(request.input)
      await this.dependencies.beforeSend?.(sessionId, userMessage)
      const prepared = await this.requireSession(sessionId)
      if (sendTargetRevision(prepared) !== initialTargetRevision) {
        throw new ChatSendPreflightInvalidatedError()
      }
      validateInput(request.input, prepared.settings ?? {})
      assertSessionActionAllowed('submit-message', deriveSessionLockState(prepared))
      const session = await this.dependencies.sessions.updateSessionWithMessages(sessionId, (latest) => {
        if (!latest) throw new Error(`Session ${sessionId} not found`)
        if (sendTargetRevision(latest) !== initialTargetRevision) {
          throw new ChatSendPreflightInvalidatedError()
        }
        return { ...latest, messages: [...latest.messages, userMessage, assistantMessage] }
      })
      const result = { assistantMessage, session, userMessage }
      await request.onMessagesPersisted?.(result)
      await this.dependencies.generation.orchestrate(sessionId, assistantMessage, {
        operationType: 'send_message',
        submittedAt,
      })
      return result
    })
  }

  async editMessage(sessionId: string, messageId: string, contentParts: Message['contentParts']): Promise<void> {
    const current = await this.requireSession(sessionId)
    const location = findMessageLocation(current, messageId)
    if (!location) throw new Error(`Message ${messageId} not found`)
    const message = location.list[location.index]
    assertSessionActionAllowed('edit-message', deriveSessionLockState(current), {
      messageGenerating: message.generating === true,
    })

    await this.dependencies.sessions.updateSessionWithMessages(sessionId, (latest) => {
      if (!latest) throw new Error(`Session ${sessionId} not found`)
      return replaceMessage(latest, messageId, (latestMessage) => ({
        ...latestMessage,
        contentParts,
        timestamp: this.dependencies.now(),
      }))
    })
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const current = await this.requireSession(sessionId)
    const target = findMessageLocation(current, messageId)?.list.find((message) => message.id === messageId)
    if (!target) throw new Error(`Message ${messageId} not found`)
    if (target.isSummary) assertSessionActionAllowed('delete-summary', deriveSessionLockState(current))

    await this.dependencies.sessions.updateSessionWithMessages(sessionId, (latest) => {
      if (!latest) throw new Error(`Session ${sessionId} not found`)
      return applyMessageRemoval(latest, sessionId, messageId, this.dependencies.createId)
    })
  }

  async clearMessages(sessionId: string): Promise<void> {
    const current = await this.requireSession(sessionId)
    assertSessionActionAllowed('submit-message', deriveSessionLockState(current))
    await this.dependencies.sessions.updateSessionWithMessages(sessionId, (latest) => {
      if (!latest) throw new Error(`Session ${sessionId} not found`)
      return {
        ...latest,
        messages: latest.messages.filter((message) => message.role === 'system').slice(0, 1),
        messageForksHash: undefined,
        compactionPoints: undefined,
      }
    })
  }

  /** Flat candidates own independent runtimes and may start while another reply streams. */
  async replyBelow(sessionId: string, messageId: string): Promise<void> {
    const { runtime } = this.dependencies
    const lease = runtime?.acquireGenerationPreparationLease(sessionId)
    if (runtime && !lease) throw new SessionActionBlockedError('reply-below', 'generating')
    const reply: Message = { ...this.createMessage('assistant', ''), generating: true }
    let inserted = false
    const settleFailure = async (error: unknown) => {
      await this.dependencies.sessions.updateSessionWithMessages(
        sessionId,
        (session) => {
          if (!session) throw error
          return replaceMessage(session, reply.id, (current) =>
            current.generating
              ? { ...current, generating: false, error: error instanceof Error ? error.message : String(error) }
              : current
          )
        },
        { preserveCachedGeneratingMessages: true }
      )
    }
    try {
      await this.dependencies.sessions.updateSessionWithMessages(
        sessionId,
        (session) => {
          if (!session) throw new Error(`Session ${sessionId} not found`)
          const mode = resolveSessionMode(session.settings?.agentMode?.value)
          if (!isActionAvailableInMode('reply-below', mode)) {
            throw new Error('Reply Again Below is unavailable in Work Mode')
          }
          const thread = session.threads?.find((candidate) =>
            candidate.messages.some((message) => message.id === messageId)
          )
          const list = thread?.messages ?? session.messages
          const index = list.findIndex((message) => message.id === messageId)
          const target = list[index]
          if (
            !target ||
            target.isSummary ||
            target.isForkMarker ||
            (target.role !== 'user' && target.role !== 'system')
          ) {
            throw new Error(`Message ${messageId} cannot receive a reply below`)
          }
          assertSessionActionAllowed(
            'reply-below',
            deriveSessionLockState(session, {
              activeGenerationMessageIds: new Set(runtime?.list(sessionId).map((state) => state.messageId)),
              compactionRunning: this.dependencies.isCompactionRunning?.(sessionId),
            }),
            { messageGenerating: target.generating === true, sessionMode: mode }
          )
          return applyMessageInsert(session, sessionId, reply, messageId, { requireAnchor: true })
        },
        {
          preserveCachedGeneratingMessages: true,
          onFullSessionPersisted: () => {
            inserted = true
          },
        }
      )
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
      const current = await this.requireSession(sessionId)
      const location = findMessageLocation(current, messageId)
      if (!location) throw new Error(`Message ${messageId} not found`)
      const { index } = location
      const target = location.list[index]
      assertSessionActionAllowed('regenerate', this.getLockState(current), {
        messageGenerating: target.generating === true,
      })

      let previousMessageIndex = index - 1
      while (previousMessageIndex >= 0 && location.list[previousMessageIndex].isSummary) {
        previousMessageIndex -= 1
      }
      const pivot = previousMessageIndex >= 0 ? location.list[previousMessageIndex] : undefined
      const retried: Message = pivot
        ? {
            ...this.createMessage('assistant', ''),
            generating: true,
          }
        : {
            ...target,
            generating: true,
            contentParts: [],
            error: undefined,
            errorCode: undefined,
            errorExtra: undefined,
            finishReason: undefined,
            status: [],
            timestamp: this.dependencies.now(),
          }
      await this.dependencies.sessions.updateSessionWithMessages(sessionId, (latest) => {
        if (!latest) throw new Error(`Session ${sessionId} not found`)
        assertSessionActionAllowed('regenerate', this.getLockState(latest), {
          messageGenerating: target.generating === true,
        })
        if (!pivot) return replaceMessage(latest, target.id, () => retried)
        const patch = buildCreateForkPatch(latest, pivot.id, {
          createId: this.dependencies.createId,
          now: this.dependencies.now,
        })
        if (!patch) throw new Error(`Unable to create a retry fork after ${pivot.id}`)
        return appendMessageToConversation({ ...latest, ...patch }, pivot.id, retried)
      })
      await this.dependencies.generation.orchestrate(sessionId, retried, { operationType: 'regenerate' })
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

  private getLockState(session: Session) {
    return deriveSessionLockState(session, {
      activeGenerationMessageIds: new Set(this.dependencies.runtime?.list(session.id).map((state) => state.messageId)),
      compactionRunning: this.dependencies.isCompactionRunning?.(session.id),
    })
  }

  private async requireSession(sessionId: string): Promise<Session> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return session
  }
}
