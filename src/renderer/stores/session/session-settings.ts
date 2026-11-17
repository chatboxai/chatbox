import type { SessionHeader } from '@chatbox/core/ports'
import { type SessionSettings, SessionSettingsSchema } from '@shared/types'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import type { TokenModel } from '@/packages/token'
import * as defaults from '../../../shared/defaults'
import { settingsStore, useSettingsStore } from '../settingsStore'
import { type GlobalChatDefaults, inheritChatSettings } from './session-settings-inheritance'

const useSession = (sessionId: string | null) => rendererApplication.sessionHooks.useSessionHeader(sessionId)

function mergeDefaultSessionSettings(
  session: Pick<SessionHeader, 'type' | 'settings'>,
  globalSettings: GlobalChatDefaults
): SessionSettings {
  if (session.type === 'picture') {
    return SessionSettingsSchema.parse({
      ...defaults.pictureSessionSettings(),
      ...session.settings,
    })
  } else {
    const chatDefaults = defaults.chatSessionSettings()
    return SessionSettingsSchema.parse({
      ...chatDefaults,
      ...inheritChatSettings(session.settings, globalSettings, chatDefaults.provider ?? ''),
    })
  }
}

// Chat parameters the session leaves unset follow the global new-chat defaults.
export function useSessionSettings(sessionId: string | null) {
  const { session } = useSession(sessionId)
  const globalSettings = useSettingsStore((state) => state)

  const sessionSettings = useMemo(() => {
    if (!session) {
      return SessionSettingsSchema.parse(globalSettings)
    }
    return mergeDefaultSessionSettings(session, globalSettings)
  }, [session, globalSettings])

  return { sessionSettings }
}

export async function getSessionHeader(sessionId: string): Promise<SessionHeader | null> {
  return (await rendererApplication.sessions.readSessionMessages({ sessionId, messageIds: [] }))?.header ?? null
}

export async function getSessionSettings(sessionId: string, header?: SessionHeader) {
  const session = header ?? (await getSessionHeader(sessionId))
  if (!session) {
    const globalSettings = settingsStore.getState().getSettings()
    return SessionSettingsSchema.parse(globalSettings)
  }
  return mergeDefaultSessionSettings(session, settingsStore.getState().getSettings())
}

/**
 * The session's chat model as a token-estimation model ref. This is the same
 * resolution the InputBox feeds into useTokenEstimation, so counts cached
 * against it (e.g. the draft worker's) stay addressable from non-React code.
 */
export function getSessionTokenModel(session: Pick<SessionHeader, 'type' | 'settings'>): TokenModel | undefined {
  const { provider, modelId } = mergeDefaultSessionSettings(session, settingsStore.getState().getSettings())
  return provider && modelId ? { provider, modelId } : undefined
}
