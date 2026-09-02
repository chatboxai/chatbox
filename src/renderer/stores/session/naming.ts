import type { Session } from '@chatbox/core'
import { SessionNamingService } from '@chatbox/core/application/session'
import { currentModelFactory } from '@/adapters/CurrentModelFactory'
import { rendererApplication } from '@/app/renderer-application'
import { languageNameMap } from '@/i18n/locales'
import { convertToModelMessages } from '@/packages/model-calls/message-utils'
import { settingsService } from '@/settings-runtime'
import { reportError } from '@/utils/sentry'

const namingService = new SessionNamingService({
  sessions: {
    getSession: (sessionId) => rendererApplication.sessionQueryBridge.getSession(sessionId),
    updateSession: (sessionId, updater) => rendererApplication.sessions.updateSession(sessionId, updater),
    updateSessionWithMessages: (sessionId, updater) =>
      rendererApplication.sessions.updateSessionWithMessages(sessionId, updater),
  },
  settings: settingsService,
  models: currentModelFactory,
  scheduler: {
    schedule(callback, delayMs) {
      const timeout = setTimeout(callback, delayMs)
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

export function modifyNameAndThreadName(sessionId: string, name: string) {
  return namingService.modifyNameAndThreadName(sessionId, name)
}

export function modifyThreadName(sessionId: string, threadName: string) {
  return namingService.modifyThreadName(sessionId, threadName)
}

export function syncSessionAutoTitle(session: Session) {
  namingService.syncAutoTitle(session, { messages: session.messages })
}

export function clearSessionNameGenerationState(sessionId: string): void {
  namingService.clearSessionState(sessionId)
}
