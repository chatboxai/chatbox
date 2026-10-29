/// <reference types="vite/client" />

import { createChatQueryClient } from '@chatbox/react'
import { v4 as uuidv4 } from 'uuid'
import { CurrentSessionRepository } from '@/adapters/CurrentSessionRepository'
import { rendererSessionFolderStore } from '@/adapters/RendererSessionFolderStore'
import { RendererSettingsStorage } from '@/adapters/RendererSettingsStorage'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { createRendererQueryLifecycle } from '@/react-bindings/renderer-query-lifecycle'
import { authInfoStore } from '@/stores/authInfoStore'
import { getCopilotName } from '@/stores/copilotStore'
import { initLastUsedModelStore, lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { reportError } from '@/utils/sentry'
import {
  type CreateRendererApplicationOptions,
  createRendererApplication,
  type RendererHostKind,
} from './createRendererApplication'

const queryClient = createChatQueryClient()

/**
 * The single row-backed repository of this host. Every reader or writer of a
 * whole session must go through it: a session record on its own carries no
 * messages, and writes past it invalidate the repository's row baselines.
 */
export const sessionRepository = new CurrentSessionRepository()
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
    folders: rendererSessionFolderStore,
    getCopilotName,
  },
  settingsLogger: getLogger('settings-service'),
  settingsEffectsHost,
  bootstrapTasks: [
    // Open the session record, row and meta stores up front so a database this
    // build cannot read raises its guard dialog before the first session read.
    // The failure must not reject bootstrap, or that dialog never renders.
    () =>
      sessionRepository.initialize().catch((error: unknown) => {
        reportError(error, { domain: 'storage', operation: 'initialize-session-repository', priority: 'high' })
      }),
    async () => void (await initLastUsedModelStore()),
  ],
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
