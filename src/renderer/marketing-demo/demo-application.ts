import { InMemorySessionRepository, InMemorySettingsStorage } from '@chatbox/core/testing'
import { createDefaultSettings } from '@chatbox/core/domain/settings'
import { Theme } from '@shared/types'
import { createChatQueryClient } from '@chatbox/react'
import { v4 as uuidv4 } from 'uuid'
import { createRendererApplication } from '@/app/createRendererApplication'
import { getLogger } from '@/lib/utils'
import { createRendererQueryLifecycle } from '@/react-bindings/renderer-query-lifecycle'
import { authInfoStore } from '@/stores/authInfoStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'

const queryClient = createChatQueryClient()
const sessionRepository = new InMemorySessionRepository()
const settingsStorage = new InMemorySettingsStorage({
  ...createDefaultSettings(),
  theme: Theme.Light,
  allowReportingAndTracking: false,
  enableMarkdownRendering: true,
  enableLaTeXRendering: true,
  showModelName: true,
  showTokenUsed: true,
  licenseKey: 'demo',
})

export const rendererApplication = createRendererApplication({
  authInfoStore,
  lastUsedModelStore,
  queryClient,
  queryLifecycle: createRendererQueryLifecycle(),
  sessionRepository,
  settingsStorage,
  sessionEventLogger: getLogger('demo-session-events'),
  session: {
    createId: uuidv4,
    logger: getLogger('demo-session-service'),
    repairSessionOnRead: (session) => ({ session, changed: false }),
  },
  settingsLogger: getLogger('demo-settings-service'),
  settingsEffectsHost: {
    ensureShortcutConfig: () => undefined,
    ensureProxyConfig: () => undefined,
    ensureAutoLaunch: () => undefined,
  },
  host: {
    kind: 'web',
    runtime: 'web',
    capabilities: {
      desktopLike: false,
      nativeMobile: false,
    },
  },
})
