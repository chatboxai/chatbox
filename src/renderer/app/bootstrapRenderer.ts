import type { Settings } from '@shared/types'
import i18n from '@/i18n'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { router } from '@/router'
import { initSessionPresentationBindings } from '@/session-bootstrap'
import { initGoogleAnalyticsTracking } from '@/setup/ga_init'
import { initJkTracking } from '@/setup/jk_analytics_init'
import { initPlausibleTracking } from '@/setup/plausible_init'
import { initSentry } from '@/setup/sentry_init'
import { initSessionAttachmentRagMaintenance } from '@/setup/session_attachment_rag_maintenance'
import { initLastUsedModelStore } from '@/stores/lastUsedModelStore'
import * as migration from '@/stores/migration'
import { getMigrationErrorContext } from '@/stores/migration-error'
import { initOnboardingStore } from '@/stores/onboardingStore'
import { initLoginLicenseStateReconciliation } from '@/stores/premiumActions'
import { initRecentDirectoriesStore } from '@/stores/recentDirectoriesStore'
import { initSettingsStore } from '@/stores/settingsStore'
import { initUpdateListeners } from '@/stores/updateStore'
import { reportError } from '@/utils/sentry'
import type { RendererApplication } from './createRendererApplication'

const log = getLogger('index')

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

  // Preserve the non-blocking timing of cleanup and MCP startup.
  void import('@/setup/storage_clear')
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

  if (platform.type === 'desktop') {
    initUpdateListeners()
    initSessionAttachmentRagMaintenance()
  }
  initSessionPresentationBindings()

  return settings
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
