import { type Session, type SessionSettings, SessionSettingsSchema } from '@shared/types'
import { useMemo } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import type { TokenModel } from '@/packages/token'
import * as defaults from '../../../shared/defaults'
import { settingsStore, useSettingsStore } from '../settingsStore'

const useSession = (sessionId: string | null) => rendererApplication.sessionHooks.useSession(sessionId)

function mergeDefaultSessionSettings(session: Session): SessionSettings {
  if (session.type === 'picture') {
    return SessionSettingsSchema.parse({
      ...defaults.pictureSessionSettings(),
      ...session.settings,
    })
  } else {
    return SessionSettingsSchema.parse({
      ...defaults.chatSessionSettings(),
      ...session.settings,
    })
  }
}

// session settings is copied from global settings when session is created, so no need to merge global settings here
export function useSessionSettings(sessionId: string | null) {
  const { session } = useSession(sessionId)
  const globalSettings = useSettingsStore((state) => state)

  const sessionSettings = useMemo(() => {
    if (!session) {
      return SessionSettingsSchema.parse(globalSettings)
    }
    return mergeDefaultSessionSettings(session)
  }, [session, globalSettings])

  return { sessionSettings }
}

export async function getSessionSettings(sessionId: string) {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    const globalSettings = settingsStore.getState().getSettings()
    return SessionSettingsSchema.parse(globalSettings)
  }
  return mergeDefaultSessionSettings(session)
}

/**
 * The session's chat model as a token-estimation model ref. This is the same
 * resolution the InputBox feeds into useTokenEstimation, so counts cached
 * against it (e.g. the draft worker's) stay addressable from non-React code.
 */
export function getSessionTokenModel(session: Session): TokenModel | undefined {
  const { provider, modelId } = mergeDefaultSessionSettings(session)
  return provider && modelId ? { provider, modelId } : undefined
}
