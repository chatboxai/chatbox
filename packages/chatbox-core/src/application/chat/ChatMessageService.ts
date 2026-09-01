import { withSessionGenerationLock } from '../../generation/generation-lock'
import { assertSessionActionAllowed, deriveSessionLockState } from '../../session/action-gates'
import { buildCreateForkPatch, findMessageLocation } from '../../session/message-forks'
import type { Message, Session, SessionSettings } from '../../types'

export type ChatMessageFiles = NonNullable<Message['files']>
export type ChatMessageLinks = NonNullable<Message['links']>

export interface ChatGenerationPort {
  orchestrate(
    sessionId: string,
    targetMessage: Message,
    options?: { operationType?: 'send_message' | 'regenerate' }
  ): Promise<void>
}

export interface ChatMessageSessionPort {
  createSession(session: Omit<Session, 'id'>, previousId?: string): Promise<Session>
  getSession(sessionId: string): Promise<Session | null>
  updateSessionWithMessages(
    sessionId: string,
    updater: (session: Session | null | undefined) => Session
  ): Promise<Session>
}

export interface ChatMessageServiceDependencies {
  sessions: ChatMessageSessionPort
  generation: ChatGenerationPort
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
  idempotencyKey: string
  input: ChatMessageInput
  sessionSettings: SessionSettings
  systemPrompt?: string
  name?: string
  previousSessionId?: string
  onSessionPersisted?(result: ChatSendResult): void | Promise<void>
}

export interface SendExistingSessionRequest {
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

function removeMessage(session: Session, messageId: string): Session {
  const target = findMessageLocation(session, messageId)?.list.find((message) => message.id === messageId)
  if (!target) throw new Error(`Message ${messageId} not found`)

  const clearCompactionPoint = target.isSummary
    ? (points: Session['compactionPoints']) => points?.filter((point) => point.summaryMessageId !== messageId)
    : (points: Session['compactionPoints']) => points
  return {
    ...session,
    messages: session.messages.filter((message) => message.id !== messageId),
    threads: session.threads?.map((thread) => ({
      ...thread,
      messages: thread.messages.filter((message) => message.id !== messageId),
      compactionPoints: clearCompactionPoint(thread.compactionPoints),
    })),
    messageForksHash: session.messageForksHash
      ? Object.fromEntries(
          Object.entries(session.messageForksHash).map(([forkId, fork]) => [
            forkId,
            {
              ...fork,
              lists: fork.lists.map((list) => ({
                ...list,
                messages: list.messages.filter((message) => message.id !== messageId),
              })),
            },
          ])
        )
      : undefined,
    compactionPoints: clearCompactionPoint(session.compactionPoints),
  }
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

    const flight = this.sendNewSessionOnce(request)
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
    return withSessionGenerationLock(sessionId, async () => {
      const current = await this.requireSession(sessionId)
      validateInput(request.input, current.settings ?? {})
      assertSessionActionAllowed('submit-message', deriveSessionLockState(current))

      const { assistantMessage, userMessage } = this.createTurn(request.input)
      const session = await this.dependencies.sessions.updateSessionWithMessages(sessionId, (latest) => {
        if (!latest) throw new Error(`Session ${sessionId} not found`)
        return { ...latest, messages: [...latest.messages, userMessage, assistantMessage] }
      })
      const result = { assistantMessage, session, userMessage }
      await request.onMessagesPersisted?.(result)
      await this.dependencies.generation.orchestrate(sessionId, assistantMessage, { operationType: 'send_message' })
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
      return removeMessage(latest, messageId)
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

  retryMessage(sessionId: string, messageId: string): Promise<void> {
    return withSessionGenerationLock(sessionId, async () => {
      const current = await this.requireSession(sessionId)
      const location = findMessageLocation(current, messageId)
      if (!location) throw new Error(`Message ${messageId} not found`)
      const { index } = location
      const target = location.list[index]
      assertSessionActionAllowed('regenerate', deriveSessionLockState(current), {
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
      this.dependencies.generation.orchestrate(session.id, assistantMessage, { operationType: 'send_message' })
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

  private async requireSession(sessionId: string): Promise<Session> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return session
  }
}
