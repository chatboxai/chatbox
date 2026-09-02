import {
  GenerationRuntimeStore,
  type LoggerPort,
  SessionEventBus,
  type SessionRepositoryPort,
  SessionService,
  type SessionServiceOptions,
  SessionWriteCoordinator,
  SettingsService,
  type SettingsServiceOptions,
  type SettingsStoragePort,
} from '@chatbox/core'
import type { QueryClient } from '@tanstack/react-query'
import type { ChatboxReactApplication } from './application-context'
import { createGenerationHooks } from './generation-hooks'
import { createChatQueryClient } from './query/query-client'
import { QueryKeys } from './query/query-keys'
import { createSessionHooks } from './query/session-hooks'
import { SessionQueryBridge } from './query/session-query-bridge'
import { createSettingsStore } from './stores/createSettingsStore'

export interface CreateChatApplicationOptions extends Omit<ChatboxReactApplication, 'queryClient' | 'settingsStore'> {
  queryClient?: QueryClient
  sessionRepository: SessionRepositoryPort
  settingsStorage: SettingsStoragePort
  session: Omit<SessionServiceOptions, 'getLastUsedModels'> & {
    getLastUsedModels?: SessionServiceOptions['getLastUsedModels']
  }
  settings: SettingsServiceOptions
  /** Optional host logger used to isolate and report application-event listener failures. */
  sessionEventLogger?: LoggerPort
  /**
   * The current Renderer historically initializes its session metadata lazily.
   * Other hosts, including React Native, initialize it as part of bootstrap.
   */
  initializeSessionsOnBootstrap?: boolean
  bootstrapTasks?: Array<() => void | Promise<void>>
}

export interface ChatApplication extends ChatboxReactApplication {
  readonly sessions: SessionService
  readonly sessionEvents: SessionEventBus
  readonly sessionWrites: SessionWriteCoordinator
  readonly sessionQueryBridge: SessionQueryBridge
  readonly sessionHooks: ReturnType<typeof createSessionHooks>
  readonly settings: SettingsService
  readonly settingsStore: ReturnType<typeof createSettingsStore>
  readonly generationRuntime: GenerationRuntimeStore
  readonly generationHooks: ReturnType<typeof createGenerationHooks>
  bootstrap(): Promise<void>
  dispose(): void
}

/**
 * Creates one host-owned application graph without importing a concrete
 * platform, storage implementation, UI store, or module-level QueryClient.
 */
export function createChatApplication(options: CreateChatApplicationOptions): ChatApplication {
  const ownsQueryClient = options.queryClient === undefined
  const queryClient: QueryClient = options.queryClient ?? createChatQueryClient()
  const sessionEvents = new SessionEventBus(options.sessionEventLogger)
  let sessionQueryBridgeReference: SessionQueryBridge | null = null
  let disposed = false
  let bootstrapPromise: Promise<void> | null = null

  const sessionWrites = new SessionWriteCoordinator(options.sessionRepository, {
    readCurrentSession: async (sessionId) => {
      const cached = sessionQueryBridgeReference?.getCachedSession(sessionId)
      if (cached !== undefined) return cached

      // A query read can repair stale generation state through this same write
      // coordinator. Waiting for it here would deadlock, while letting it finish
      // later could overwrite the write cache with its older snapshot.
      await queryClient.cancelQueries({ queryKey: QueryKeys.ChatSession(sessionId), exact: true })
      const cachedAfterCancellation = sessionQueryBridgeReference?.getCachedSession(sessionId)
      return cachedAfterCancellation !== undefined
        ? cachedAfterCancellation
        : options.sessionRepository.getSession(sessionId)
    },
    discardCurrentSession: (sessionId) => sessionQueryBridgeReference?.discardSessionCache(sessionId),
  })
  const sessions = new SessionService(options.sessionRepository, sessionWrites, sessionEvents, {
    ...options.session,
    getLastUsedModels:
      options.session.getLastUsedModels ??
      (() => {
        const state = options.lastUsedModelStore?.getState()
        return { chat: state?.chat, picture: state?.picture }
      }),
  })
  const sessionQueryBridge = new SessionQueryBridge(queryClient, sessions, sessionEvents)
  sessionQueryBridgeReference = sessionQueryBridge

  const settings = new SettingsService(options.settingsStorage, options.settings)
  const settingsStore = createSettingsStore(settings)
  const generationRuntime = new GenerationRuntimeStore()

  return {
    authInfoStore: options.authInfoStore,
    lastUsedModelStore: options.lastUsedModelStore,
    queryClient,
    queryLifecycle: options.queryLifecycle,
    sessions,
    sessionEvents,
    sessionWrites,
    sessionQueryBridge,
    sessionHooks: createSessionHooks(sessionQueryBridge.definitions),
    settings,
    settingsStore,
    generationRuntime,
    generationHooks: createGenerationHooks(generationRuntime),
    bootstrap() {
      if (disposed) return Promise.reject(new Error('ChatApplication has been disposed'))
      if (!bootstrapPromise) {
        const tasks: Array<void | Promise<void> | Promise<unknown>> = [settingsStore.getState().hydrate()]
        if (options.initializeSessionsOnBootstrap !== false) {
          tasks.push(sessions.initialize())
        }
        for (const task of options.bootstrapTasks ?? []) tasks.push(task())
        bootstrapPromise = Promise.all(tasks).then(() => undefined)
      }
      return bootstrapPromise
    },
    dispose() {
      if (disposed) return
      disposed = true
      sessionQueryBridge.dispose()
      settingsStore.getState().destroy()
      settings.dispose()
      generationRuntime.dispose()
      if (ownsQueryClient) queryClient.clear()
    },
  }
}
