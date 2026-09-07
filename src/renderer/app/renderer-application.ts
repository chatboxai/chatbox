/// <reference types="vite/client" />

import { backfillMissingThreadName } from '@chatbox/core'
import { createChatQueryClient } from '@chatbox/react'
import { v4 as uuidv4 } from 'uuid'
import { CurrentSessionRepository } from '@/adapters/CurrentSessionRepository'
import { RendererSettingsStorage } from '@/adapters/RendererSettingsStorage'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { createRendererQueryLifecycle } from '@/react-bindings/renderer-query-lifecycle'
import { authInfoStore } from '@/stores/authInfoStore'
import { initLastUsedModelStore, lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { recoverSessionOnLoad } from '@/utils/session-utils'
import {
  type CreateRendererApplicationOptions,
  createRendererApplication,
  type RendererHostKind,
} from './createRendererApplication'

const queryClient = createChatQueryClient()
const sessionRepository = new CurrentSessionRepository()
const settingsStorage = new RendererSettingsStorage()

const settingsEffectsHost = {
  ensureShortcutConfig: (...args: Parameters<typeof platform.ensureShortcutConfig>) => {
    void platform.ensureShortcutConfig(...args)
  },
  ensureProxyConfig: (...args: Parameters<typeof platform.ensureProxyConfig>) => {
    void platform.ensureProxyConfig(...args)
  },
  ensureAutoLaunch: (...args: Parameters<typeof platform.ensureAutoLaunch>) => {
    void platform.ensureAutoLaunch(...args)
  },
}

const common: Omit<CreateRendererApplicationOptions, 'host'> = {
  authInfoStore,
  lastUsedModelStore,
  queryClient,
  queryLifecycle: createRendererQueryLifecycle(),
  sessionRepository,
  settingsStorage,
  sessionEventLogger: getLogger('session-events'),
  session: {
    createId: uuidv4,
    logger: getLogger('session-service'),
    repairSessionOnRead: (session) => {
      const recovery = recoverSessionOnLoad(session)
      const backfill = backfillMissingThreadName(recovery.session)
      return {
        session: backfill.session,
        changed: recovery.recoveredStaleGeneration || backfill.changed,
      }
    },
  },
  settingsLogger: getLogger('settings-service'),
  settingsEffectsHost,
  bootstrapTasks: [async () => void (await initLastUsedModelStore())],
}

function getRendererHostKind(): RendererHostKind {
  if (platform.type === 'mobile') return 'capacitor'
  if (platform.type === 'web') return 'web'
  return 'desktop'
}

// This module can be reached while Platform is still evaluating. The live
// binding must not be read until a consumer asks for host metadata/bootstrap.
export const rendererApplication = createRendererApplication({
  ...common,
  host: {
    get kind() {
      return getRendererHostKind()
    },
    get runtime() {
      return platform.type
    },
    capabilities: {
      get desktopLike() {
        return platform.isDesktopLike
      },
      get nativeMobile() {
        return platform.type === 'mobile'
      },
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    rendererApplication.dispose()
    // This module creates and injects the Renderer QueryClient, so its host
    // lifecycle remains responsible for clearing it after application dispose.
    queryClient.clear()
  })
}
