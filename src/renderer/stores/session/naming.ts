import { shouldBackfillThreadName, UNTITLED_SESSION_NAME } from '@chatbox/core'
import { SessionNamingService } from '@chatbox/core/application/session'
import type { SessionHeader } from '@chatbox/core/ports'
import { currentModelFactory } from '@/adapters/CurrentModelFactory'
import { rendererApplication } from '@/app/renderer-application'
import { languageNameMap } from '@/i18n/locales'
import { convertToModelMessages } from '@/packages/model-calls/message-utils'
import { settingsService } from '@/settings-runtime'
import { reportError } from '@/utils/sentry'

const namingService = new SessionNamingService({
  sessions: {
    getSessionHeader: (sessionId) => rendererApplication.sessions.getSessionHeader(sessionId),
    readSessionNamingMessages: (request) => rendererApplication.sessions.readSessionNamingMessages(request),
    updateSessionHeader: (sessionId, updater) => rendererApplication.sessions.updateSessionHeader(sessionId, updater),
    executeStructureCommand: (sessionId, operation, onCommitted) =>
      rendererApplication.sessions.executeStructureCommand(sessionId, operation, onCommitted),
  },
  settings: settingsService,
  models: currentModelFactory,
  scheduler: {
    schedule(callback, delayMs) {
      const timeout = setTimeout(() => {
        void Promise.resolve()
          .then(callback)
          .catch((error: unknown) => {
            reportError(error, { domain: 'ai-generation', operation: 'generate_session_name' })
          })
      }, delayMs)
      return { cancel: () => clearTimeout(timeout) }
    },
  },
  getLanguageName: (language) => languageNameMap[language],
  toModelMessages: (messages, model) =>
    convertToModelMessages(messages, { modelSupportVision: model.isSupportVision() }),
  reportUnexpectedError: (error) => {
    reportError(error, {
      domain: 'ai-generation',
      operation: 'generate_session_name',
    })
  },
})

export async function modifyNameAndThreadName(sessionId: string, name: string) {
  return namingService.modifyNameAndThreadName(sessionId, name)
}

export async function modifyThreadName(sessionId: string, threadName: string) {
  return namingService.modifyThreadName(sessionId, threadName)
}

export function syncSessionAutoTitle(sessionId: string) {
  return namingService.syncAutoTitle(sessionId).catch((error: unknown) => {
    reportError(error, { domain: 'ai-generation', operation: 'generate_session_name' })
  })
}

export async function syncSessionAutoTitleOnOpen(session: SessionHeader, isCurrent: () => boolean): Promise<void> {
  if (
    !shouldBackfillThreadName(session) &&
    (settingsService.getSettings().autoGenerateTitle === false ||
      (session.name !== UNTITLED_SESSION_NAME && session.threadName))
  )
    return
  if (isCurrent()) await syncSessionAutoTitle(session.id)
}

export function clearSessionNameGenerationState(sessionId: string): void {
  namingService.clearSessionState(sessionId)
}
