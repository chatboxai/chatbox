import type { ModelMessage } from 'ai'
import { isExpectedGenerationError } from '../../models/error-classification'
import type { ModelInterface } from '../../models/types'
import type { ModelFactoryPort, SettingsRepositoryPort } from '../../ports'
import { nameConversation } from '../../prompts'
import {
  buildNameGenerationAttemptKey,
  isNameGenerationAttemptKeyForSession,
  sanitizeGeneratedSessionName,
  shouldBackfillThreadName,
  UNTITLED_SESSION_NAME,
} from '../../session/auto-title'
import type { SessionHeaderRead } from '../../ports/session-row-repository'
import type { SessionHeader } from '../../ports/session-read-model'
import type { Language, Message, ModelProvider, SessionSettings, Settings } from '../../types'
import type { SessionUseCasePort } from './session-use-case-port'
import { SessionNotFoundError } from './SessionWriteCoordinator'

export interface ScheduledNameGeneration {
  cancel(): void
}

export interface NameGenerationSchedulerPort {
  schedule(callback: () => void | Promise<void>, delayMs: number): ScheduledNameGeneration
}

export interface SessionNamingServiceDependencies {
  sessions: Pick<
    SessionUseCasePort,
    'getSessionHeader' | 'readSessionNamingMessages' | 'executeStructureCommand' | 'updateSessionHeader'
  >
  settings: Pick<SettingsRepositoryPort, 'getSettings'>
  models: ModelFactoryPort
  scheduler: NameGenerationSchedulerPort
  getLanguageName(language: Language): string
  toModelMessages(messages: Message[], model: ModelInterface): Promise<ModelMessage[]>
  reportUnexpectedError(error: unknown): void
}

export interface SessionNameGenerationOptions {
  locale?: Language
  /** Streaming state from the selected-thread projection. */
  generating?: boolean
  /** Live-conversation identity so a later thread can schedule while an older request is in flight. */
  threadIdentity?: string
}

const NAME_GENERATION_IDLE_COOLDOWN_MS = 60_000

type GeneratedNameWriteMode = 'name-and-thread' | 'thread'

const ALWAYS_ELIGIBLE = (_session: SessionHeaderRead) => true
function namingIdentity(session: SessionHeaderRead): string {
  return `${session.activeThreadId}:${session.summary.firstNamingUserMessageId ?? ''}`
}

export class SessionNamingService {
  private readonly pending = new Map<string, ScheduledNameGeneration>()
  private readonly active = new Set<string>()
  private readonly deferredUntilIdle = new Set<string>()
  private readonly cooldownUntil = new Map<string, number>()
  private readonly backfillInFlight = new Set<string>()

  constructor(private readonly dependencies: SessionNamingServiceDependencies) {}

  async modifyNameAndThreadName(sessionId: string, name: string): Promise<void> {
    await this.dependencies.sessions.updateSessionHeader(sessionId, { name, threadName: name })
  }

  async modifyThreadName(sessionId: string, threadName: string): Promise<void> {
    await this.dependencies.sessions.updateSessionHeader(sessionId, { threadName })
  }

  generateNameAndThreadName(sessionId: string, locale?: Language): Promise<boolean> {
    return this.generate(sessionId, 'name-and-thread', locale)
  }

  generateThreadName(sessionId: string, locale?: Language): Promise<boolean> {
    return this.generate(sessionId, 'thread', locale)
  }

  scheduleNameAndThreadName(sessionId: string, options: SessionNameGenerationOptions = {}): void {
    this.schedule(
      buildNameGenerationAttemptKey('name', sessionId, options.threadIdentity),
      sessionId,
      (session) => session.header.name === UNTITLED_SESSION_NAME && session.summary.hasAutoTitleContent,
      () =>
        this.generate(
          sessionId,
          'name-and-thread',
          options.locale,
          (session) => session.header.name === UNTITLED_SESSION_NAME && session.summary.hasAutoTitleContent
        ),
      options.generating,
      options.threadIdentity
    )
  }

  scheduleThreadName(sessionId: string, options: SessionNameGenerationOptions = {}): void {
    this.schedule(
      buildNameGenerationAttemptKey('thread', sessionId, options.threadIdentity),
      sessionId,
      (session) => !session.header.threadName && session.summary.hasAutoTitleContent,
      () =>
        this.generate(
          sessionId,
          'thread',
          options.locale,
          (session) => !session.header.threadName && session.summary.hasAutoTitleContent
        ),
      options.generating,
      options.threadIdentity
    )
  }

  /**
   * Domain-event entry: backfill a missing historical threadName, otherwise
   * schedule AI naming when the conversation is eligible.
   */
  async syncAutoTitle(sessionId: string, options: SessionNameGenerationOptions = {}): Promise<void> {
    const session = await this.dependencies.sessions.getSessionHeader(sessionId)
    if (!session) return
    const header = session.header
    if (shouldBackfillThreadName(header)) {
      if (this.backfillInFlight.has(sessionId)) return
      this.backfillInFlight.add(sessionId)
      try {
        await this.writeGeneratedName(session, session.summary.hasAutoTitleContent ? header.name : '', 'thread', false)
      } catch (error) {
        this.dependencies.reportUnexpectedError(error)
      } finally {
        this.backfillInFlight.delete(sessionId)
      }
      return
    }
    if (this.dependencies.settings.getSettings().autoGenerateTitle === false || !session.summary.hasAutoTitleContent)
      return
    const nextOptions = {
      ...options,
      threadIdentity: namingIdentity(session),
      generating: session.summary.generatingMessageCount > 0,
    }
    if (header.name === UNTITLED_SESSION_NAME) this.scheduleNameAndThreadName(sessionId, nextOptions)
    else if (!header.threadName) this.scheduleThreadName(sessionId, nextOptions)
  }

  clearSessionState(sessionId: string): void {
    for (const key of this.keysForSession(sessionId)) {
      this.pending.get(key)?.cancel()
      this.pending.delete(key)
      this.active.delete(key)
      this.deferredUntilIdle.delete(key)
      this.cooldownUntil.delete(key)
    }
  }

  isPending(key: string): boolean {
    return this.pending.has(key)
  }

  isActive(key: string): boolean {
    return this.active.has(key)
  }

  private keysForSession(sessionId: string): string[] {
    const keys = new Set<string>([
      ...this.pending.keys(),
      ...this.active,
      ...this.deferredUntilIdle,
      ...this.cooldownUntil.keys(),
    ])
    return [...keys].filter((key) => isNameGenerationAttemptKeyForSession(key, sessionId))
  }

  private schedule(
    key: string,
    sessionId: string,
    isEligible: (session: SessionHeaderRead) => boolean,
    generate: () => Promise<boolean>,
    generating?: boolean,
    expectedIdentity?: string
  ): void {
    if (!this.canSchedule(key, generating)) return

    const task = this.dependencies.scheduler.schedule(
      () => this.runScheduled(key, sessionId, isEligible, generate, expectedIdentity),
      1_000
    )
    this.pending.set(key, task)
  }

  private canSchedule(key: string, generating?: boolean): boolean {
    // Once scheduled, later Session updates must not reset the timer. Streaming
    // chunks and agent-mode tool rounds could otherwise defer naming forever.
    if (this.active.has(key) || this.pending.has(key)) return false

    if (this.deferredUntilIdle.has(key)) {
      if (generating) return false
      this.deferredUntilIdle.delete(key)
    }

    const cooldownUntil = this.cooldownUntil.get(key)
    if (cooldownUntil !== undefined) {
      if (Date.now() < cooldownUntil) return false
      this.cooldownUntil.delete(key)
    }

    return true
  }

  private async runScheduled(
    key: string,
    sessionId: string,
    isEligible: (session: SessionHeaderRead) => boolean,
    generate: () => Promise<boolean>,
    expectedIdentity?: string
  ): Promise<void> {
    // Release pending before the async eligibility read so a later, eligible
    // renderer update can schedule a replacement attempt.
    this.pending.delete(key)
    const session = await this.dependencies.sessions.getSessionHeader(sessionId)
    if (!session || !isEligible(session) || this.active.has(key)) return
    const identity = namingIdentity(session)
    if (expectedIdentity !== undefined && expectedIdentity !== identity) return

    this.active.add(key)
    try {
      if (await generate()) return

      const current = await this.dependencies.sessions.getSessionHeader(sessionId)
      if (!current) return
      // A superseded conversation is not a retryable failure. Cooling it down
      // would block the replacement thread from using the session-scoped key.
      if (namingIdentity(current) !== identity) return
      if (current.summary.generatingMessageCount > 0) {
        this.deferredUntilIdle.add(key)
      } else {
        this.cooldownUntil.set(key, Date.now() + NAME_GENERATION_IDLE_COOLDOWN_MS)
      }
    } finally {
      this.active.delete(key)
    }
  }

  private async generate(
    sessionId: string,
    mode: GeneratedNameWriteMode,
    locale?: Language,
    canWrite: (session: SessionHeaderRead) => boolean = ALWAYS_ELIGIBLE
  ): Promise<boolean> {
    const session = await this.dependencies.sessions.getSessionHeader(sessionId)
    const globalSettings = this.dependencies.settings.getSettings()
    if (!session) return false

    const expectedIdentity = namingIdentity(session)
    const settings = this.buildSettings(session.header, globalSettings)
    try {
      const model = await this.dependencies.models.createModel(settings)
      const language = locale ?? globalSettings.language
      const prompt = nameConversation(await this.namingMessages(session), this.dependencies.getLanguageName(language))
      const result = await model.chat(await this.dependencies.toModelMessages(prompt, model), {
        sessionId,
      })
      const name = sanitizeGeneratedSessionName(
        (result.contentParts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      )
      if (!name) return false
      const current = await this.dependencies.sessions.getSessionHeader(sessionId)
      if (!current || namingIdentity(current) !== expectedIdentity || !canWrite(current)) return false
      return await this.writeGeneratedName(session, name, mode, canWrite !== ALWAYS_ELIGIBLE)
    } catch (error: unknown) {
      if (error instanceof SessionNotFoundError) return false
      if (!isExpectedGenerationError(error)) {
        this.dependencies.reportUnexpectedError(error)
      }
      return false
    }
  }

  private async namingMessages(source: SessionHeaderRead): Promise<Message[]> {
    const read = await this.dependencies.sessions.readSessionNamingMessages({
      sessionId: source.header.id,
      expectedRevision: source.revision,
    })
    return read?.messages ?? []
  }

  private async writeGeneratedName(
    source: SessionHeaderRead,
    name: string,
    mode: GeneratedNameWriteMode,
    onlyPending: boolean
  ): Promise<boolean> {
    const result = await this.dependencies.sessions.executeStructureCommand(source.header.id, {
      action: 'thread-title-commit',
      threadId: source.activeThreadId,
      expectedFirstNamingUserMessageId: source.summary.firstNamingUserMessageId ?? null,
      name,
      mode,
      onlyPending,
    })
    return result?.applied ?? false
  }

  private buildSettings(session: SessionHeader, globalSettings: Settings): SessionSettings {
    return {
      ...globalSettings,
      ...session.settings,
      ...(session.type === 'picture' ? { modelId: 'gpt-4o-mini' } : {}),
      ...(globalSettings.threadNamingModel
        ? {
            provider: globalSettings.threadNamingModel.provider as ModelProvider,
            modelId: globalSettings.threadNamingModel.model,
          }
        : {}),
    }
  }
}
