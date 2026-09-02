import type { ModelMessage } from 'ai'
import { isExpectedGenerationError } from '../../models/error-classification'
import type { ModelInterface } from '../../models/types'
import type { ModelFactoryPort, SettingsRepositoryPort } from '../../ports'
import { nameConversation } from '../../prompts'
import {
  backfillMissingThreadName,
  buildNameGenerationAttemptKey,
  getCurrentThreadNamingIdentity,
  isNameGenerationAttemptKeyForSession,
  resolveAutoTitleAction,
  sanitizeGeneratedSessionName,
  shouldBackfillThreadName,
  UNTITLED_SESSION_NAME,
} from '../../session/auto-title'
import { hasContentForAutoTitle } from '../../session/message-success'
import type { Language, Message, ModelProvider, Session, SessionSettings, Settings } from '../../types'
import type { SessionUseCasePort } from './session-use-case-port'
import { SessionNotFoundError } from './SessionWriteCoordinator'

export interface ScheduledNameGeneration {
  cancel(): void
}

export interface NameGenerationSchedulerPort {
  schedule(callback: () => void, delayMs: number): ScheduledNameGeneration
}

export interface SessionNamingServiceDependencies {
  sessions: Pick<SessionUseCasePort, 'getSession' | 'updateSession' | 'updateSessionWithMessages'>
  settings: Pick<SettingsRepositoryPort, 'getSettings'>
  models: ModelFactoryPort
  scheduler: NameGenerationSchedulerPort
  getLanguageName(language: Language): string
  toModelMessages(messages: Message[], model: ModelInterface): Promise<ModelMessage[]>
  reportUnexpectedError(error: unknown): void
}

export interface SessionNameGenerationOptions {
  locale?: Language
  /** Current messages let failed streaming attempts stay deferred until the reply settles. */
  messages?: Message[]
  /** Live-conversation identity so a later thread can schedule while an older request is in flight. */
  threadIdentity?: string
}

const NAME_GENERATION_IDLE_COOLDOWN_MS = 60_000

type GeneratedNameWriteMode = 'name-and-thread' | 'thread'

export class SessionNamingService {
  private readonly pending = new Map<string, ScheduledNameGeneration>()
  private readonly active = new Set<string>()
  private readonly deferredUntilIdle = new Set<string>()
  private readonly cooldownUntil = new Map<string, number>()
  private readonly backfillInFlight = new Set<string>()

  constructor(private readonly dependencies: SessionNamingServiceDependencies) {}

  async modifyNameAndThreadName(sessionId: string, name: string): Promise<void> {
    await this.dependencies.sessions.updateSession(sessionId, { name, threadName: name })
  }

  async modifyThreadName(sessionId: string, threadName: string): Promise<void> {
    await this.dependencies.sessions.updateSession(sessionId, { threadName })
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
      (session) => session.name === UNTITLED_SESSION_NAME && hasContentForAutoTitle(session.messages),
      () =>
        this.generate(
          sessionId,
          'name-and-thread',
          options.locale,
          (session) => session.name === UNTITLED_SESSION_NAME && hasContentForAutoTitle(session.messages)
        ),
      options.messages,
      options.threadIdentity
    )
  }

  scheduleThreadName(sessionId: string, options: SessionNameGenerationOptions = {}): void {
    this.schedule(
      buildNameGenerationAttemptKey('thread', sessionId, options.threadIdentity),
      sessionId,
      (session) => !session.threadName && hasContentForAutoTitle(session.messages),
      () =>
        this.generate(
          sessionId,
          'thread',
          options.locale,
          (session) => !session.threadName && hasContentForAutoTitle(session.messages)
        ),
      options.messages,
      options.threadIdentity
    )
  }

  /**
   * Domain-event entry: backfill a missing historical threadName, otherwise
   * schedule AI naming when the conversation is eligible.
   */
  syncAutoTitle(session: Session, options: SessionNameGenerationOptions = {}): void {
    // Backfill is a data migration, not naming — run it even when the
    // auto-title setting is off, mirroring repairSessionOnRead.
    if (shouldBackfillThreadName(session)) {
      if (this.backfillInFlight.has(session.id)) return
      this.backfillInFlight.add(session.id)
      const backfilled = backfillMissingThreadName(session).session.threadName ?? ''
      void this.modifyThreadName(session.id, backfilled)
        .catch((error) => {
          this.dependencies.reportUnexpectedError(error)
        })
        .finally(() => {
          this.backfillInFlight.delete(session.id)
        })
      return
    }
    if (this.dependencies.settings.getSettings().autoGenerateTitle === false) return
    const action = resolveAutoTitleAction(session)
    const nextOptions = { ...options, threadIdentity: getCurrentThreadNamingIdentity(session) }
    if (action === 'session-and-thread') {
      this.scheduleNameAndThreadName(session.id, nextOptions)
    } else if (action === 'thread') {
      this.scheduleThreadName(session.id, nextOptions)
    }
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
    isEligible: (session: Session) => boolean,
    generate: () => Promise<boolean>,
    messages?: Message[],
    expectedIdentity?: string
  ): void {
    if (!this.canSchedule(key, messages)) return

    const task = this.dependencies.scheduler.schedule(() => {
      void this.runScheduled(key, sessionId, isEligible, generate, expectedIdentity)
    }, 1_000)
    this.pending.set(key, task)
  }

  private canSchedule(key: string, messages?: Message[]): boolean {
    // Once scheduled, later Session updates must not reset the timer. Streaming
    // chunks and agent-mode tool rounds could otherwise defer naming forever.
    if (this.active.has(key) || this.pending.has(key)) return false

    if (this.deferredUntilIdle.has(key)) {
      if (messages?.some((message) => message.generating)) return false
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
    isEligible: (session: Session) => boolean,
    generate: () => Promise<boolean>,
    expectedIdentity?: string
  ): Promise<void> {
    // Release pending before the async eligibility read so a later, eligible
    // renderer update can schedule a replacement attempt.
    this.pending.delete(key)
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session || !isEligible(session) || this.active.has(key)) return
    const identity = getCurrentThreadNamingIdentity(session)
    if (expectedIdentity !== undefined && expectedIdentity !== identity) return

    this.active.add(key)
    try {
      if (await generate()) return

      const current = await this.dependencies.sessions.getSession(sessionId)
      if (!current) return
      // A superseded conversation is not a retryable failure. Cooling it down
      // would block the replacement thread from using the session-scoped key.
      if (getCurrentThreadNamingIdentity(current) !== identity) return
      if (current.messages.some((message) => message.generating)) {
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
    canWrite: (session: Session) => boolean = () => true
  ): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    const globalSettings = this.dependencies.settings.getSettings()
    if (!session) return false

    const expectedIdentity = getCurrentThreadNamingIdentity(session)
    const settings = this.buildSettings(session, globalSettings)
    try {
      const model = await this.dependencies.models.createModel(settings)
      const language = locale ?? globalSettings.language
      const prompt = nameConversation(
        session.messages.filter((message) => message.role !== 'system').slice(0, 4),
        this.dependencies.getLanguageName(language)
      )
      const result = await model.chat(await this.dependencies.toModelMessages(prompt, model), {})
      const name = sanitizeGeneratedSessionName(
        (result.contentParts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      )
      if (!name) return false
      return await this.writeGeneratedName(sessionId, expectedIdentity, name, mode, canWrite)
    } catch (error: unknown) {
      if (error instanceof SessionNotFoundError) return false
      if (!isExpectedGenerationError(error)) {
        this.dependencies.reportUnexpectedError(error)
      }
      return false
    }
  }

  /**
   * Apply the generated title inside the same per-session write queue as thread
   * switches. A pre-write getSession() can still observe the old conversation
   * while a switch is already queued; only a queued updater sees the committed state.
   */
  private async writeGeneratedName(
    sessionId: string,
    expectedIdentity: string,
    name: string,
    mode: GeneratedNameWriteMode,
    canWrite: (session: Session) => boolean
  ): Promise<boolean> {
    let wrote = false
    await this.dependencies.sessions.updateSessionWithMessages(sessionId, (current) => {
      if (!current) {
        throw new SessionNotFoundError(sessionId)
      }
      if (getCurrentThreadNamingIdentity(current) !== expectedIdentity || !canWrite(current)) {
        return current
      }
      wrote = true
      return mode === 'name-and-thread' ? { ...current, name, threadName: name } : { ...current, threadName: name }
    })
    return wrote
  }

  private buildSettings(session: Session, globalSettings: Settings): SessionSettings {
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
