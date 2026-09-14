/// <reference types="vite/client" />

import type { Settings } from '@shared/types'
import { getDefaultStore } from 'jotai'
import i18n from '@/i18n'
import { getLogger } from '@/lib/utils'
import { sessionStartupRecovery } from '@/packages/session-startup-recovery'
import platform from '@/platform'
import { router } from '@/router'
import { initSessionPresentationBindings } from '@/session-bootstrap'
import { initGoogleAnalyticsTracking } from '@/setup/ga_init'
import { initJkTracking } from '@/setup/jk_analytics_init'
import { initPlausibleTracking } from '@/setup/plausible_init'
import { initSentry } from '@/setup/sentry_init'
import { initSessionAttachmentRagMaintenance } from '@/setup/session_attachment_rag_maintenance'
import { type SessionMigrationTrickleHandle, startSessionMigrationTrickle } from '@/setup/session-migration-trickle'
import { currentSessionIdAtom } from '@/stores/atoms/sessionAtoms'
import { initLastUsedModelStore } from '@/stores/lastUsedModelStore'
import * as migration from '@/stores/migration'
import { getMigrationErrorContext } from '@/stores/migration-error'
import { initOnboardingStore } from '@/stores/onboardingStore'
import { initLoginLicenseStateReconciliation } from '@/stores/premiumActions'
import { initRecentDirectoriesStore } from '@/stores/recentDirectoriesStore'
import { isSessionGenerating } from '@/stores/sessionActivityStore'
import { initSettingsStore } from '@/stores/settingsStore'
import { initUpdateListeners } from '@/stores/updateStore'
import { reportError } from '@/utils/sentry'
import { registerNativeBackupProtection } from './native-backup-protection'
import type { RendererApplication } from './createRendererApplication'
import { sessionRepository } from './renderer-application'

const log = getLogger('index')

let sessionMigrationTrickle: SessionMigrationTrickleHandle | null = null
let stopStartupStorageCleanup: (() => void) | null = null
let unregisterNativeBackupProtection: (() => void) | null = null
let unregisterBackupMigration: (() => void) | null = null

/**
 * The session the user is watching is the one whose generation the background
 * migration must stay out of the way of; every other session it could migrate
 * is idle by construction, because opening one migrates it on the spot.
 */
function isSessionWorkInFlight(): boolean {
  const currentSessionId = getDefaultStore().get(currentSessionIdAtom)
  return currentSessionId !== null && isSessionGenerating(currentSessionId)
}

/** Runs the pre-render migration and telemetry phase in its historical order. */
export async function initializeRenderer(): Promise<void> {
  log.info('initializeApp')

  let migrationError: unknown
  try {
    await migration.migrate()
    log.info('migrate done')
  } catch (error) {
    log.error('migrate error', error)
    migrationError = error
  }

  // Migrate persisted consent before any settings-backed telemetry initializes.
  await initSentry()
  void initGoogleAnalyticsTracking()
  void initPlausibleTracking((onResolved) => {
    router.subscribe('onResolved', ({ hrefChanged }) => onResolved(hrefChanged))
  })
  void initJkTracking()

  if (migrationError !== undefined) {
    const migrationErrorContext = getMigrationErrorContext(migrationError)
    reportError(migrationError, {
      domain: 'storage',
      extras: migrationErrorContext ? { ...migrationErrorContext } : undefined,
      operation: 'migration',
      priority: 'high',
      tags: migrationErrorContext ? { configVersion: migrationErrorContext.configVersion } : undefined,
    })
  }

  // Preserve the non-blocking timing of MCP startup.
  void import('@/setup/mcp_bootstrap')
}

/** Hydrates the application graph and registers post-migration host bindings before React renders. */
export async function bootstrapRenderer(application: RendererApplication): Promise<Settings> {
  const [, settings] = await Promise.all([
    application.bootstrap(),
    initSettingsStore(),
    initLastUsedModelStore(),
    initOnboardingStore(),
    initRecentDirectoriesStore(),
  ])

  void i18n.changeLanguage(settings.language)
  initLoginLicenseStateReconciliation()

  const startMigration = () =>
    startSessionMigrationTrickle({
      repository: sessionRepository,
      isBusy: isSessionWorkInFlight,
      shouldSkipSession: async (id) => {
        if (sessionStartupRecovery.isRecoveryRequired(id)) return true
        const record = await sessionRepository.meta.getById(id)
        return record?.recoveryArchived === true || sessionStartupRecovery.isRecoveryRequired(id)
      },
      log: getLogger('session-migration'),
    })
  const scheduleStorageCleanup = (trickle: SessionMigrationTrickleHandle) => {
    if (platform.isDesktopLike) return
    stopStartupStorageCleanup?.()
    stopStartupStorageCleanup = null
    void import('@/setup/storage_clear').then(({ startStartupStorageCleanup }) => {
      if (sessionMigrationTrickle !== trickle) return
      stopStartupStorageCleanup = startStartupStorageCleanup({
        sessionMigrationReady: trickle.readyForFullScan,
      }).stop
    })
  }
  unregisterNativeBackupProtection ??= registerNativeBackupProtection(application.backupOperations, platform)
  sessionMigrationTrickle ??= startMigration()
  unregisterBackupMigration ??= application.backupOperations.registerParticipant({
    pauseAndDrain: async () => {
      await sessionMigrationTrickle?.pauseAndDrain()
    },
    resume: ({ rescan }) => {
      if (rescan) {
        sessionMigrationTrickle?.stop()
        sessionMigrationTrickle = startMigration()
      } else {
        sessionMigrationTrickle?.resume()
      }
      if (sessionMigrationTrickle) scheduleStorageCleanup(sessionMigrationTrickle)
    },
  })

  scheduleStorageCleanup(sessionMigrationTrickle)

  if (platform.type === 'desktop') {
    initUpdateListeners()
    initSessionAttachmentRagMaintenance({ sessionMigrationDone: sessionMigrationTrickle.done })
  }
  initSessionPresentationBindings()

  return settings
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterNativeBackupProtection?.()
    unregisterNativeBackupProtection = null
    sessionMigrationTrickle?.stop()
    sessionMigrationTrickle = null
    unregisterBackupMigration?.()
    unregisterBackupMigration = null
    stopStartupStorageCleanup?.()
    stopStartupStorageCleanup = null
  })
}

export function reportRendererInitializationError(error: unknown): void {
  reportError(error, {
    domain: 'application',
    handled: false,
    operation: 'app_initialization',
    priority: 'critical',
  })
  log.error('initializeApp error', error)
}
