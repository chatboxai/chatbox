import * as Sentry from '@sentry/react'
import platform from '@/platform'
import { initSentry } from '@/setup/sentry_init'
import { settingsStore } from '@/stores/settingsStore'
import { diagnosticSignature, type SessionStartupDiagnostic } from './diagnostics'

const reports = new Map<string, Promise<string | undefined>>()

export async function getDiagnosticEnvironment() {
  const [version, os] = await Promise.all([
    platform.getVersion().catch(() => 'unknown'),
    platform.getPlatform().catch(() => 'unknown'),
  ])
  const safe = (value: string) => (/^[A-Za-z0-9._+ -]{1,80}$/.test(value) ? value : 'unknown')
  return { version: safe(version), platform: `${platform.type}/${safe(os)}` }
}

export function reportStartupFailure(sessionId: string, diagnostic: SessionStartupDiagnostic) {
  const key = `${sessionId}\n${diagnosticSignature(diagnostic)}`
  const existing = reports.get(key)
  if (existing) return existing
  const report = sendReport(diagnostic).then((reportId) => {
    if (!reportId && reports.get(key) === report) reports.delete(key)
    return reportId
  })
  reports.set(key, report)
  const oldest = reports.keys().next().value
  if (reports.size > 100 && oldest !== undefined) reports.delete(oldest)
  return report
}

async function sendReport(diagnostic: SessionStartupDiagnostic): Promise<string | undefined> {
  try {
    if (!(await initSentry()) || !settingsStore.getState().allowReportingAndTracking) return undefined
    const client = Sentry.getClient()
    if (!client) return undefined
    const environment = await getDiagnosticEnvironment()
    if (!settingsStore.getState().allowReportingAndTracking) return undefined
    const error = new Error(diagnostic.message)
    error.name = diagnostic.errorName
    error.stack = `${error.name}: ${error.message}\n${diagnostic.reportStack}`
    return await new Promise<string | undefined>((resolve) => {
      let eventId: string | undefined
      const finish = (id?: string) => {
        clearTimeout(timer)
        unsubscribe()
        resolve(id)
      }
      const unsubscribe = client.on('afterSendEvent', (event, response) => {
        if (event.event_id !== eventId) return
        finish(response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? eventId : undefined)
      })
      const timer = setTimeout(() => finish(), 10_000)
      try {
        Sentry.withScope((scope) => {
          scope.clear()
          scope.addEventProcessor((event) => ({
            event_id: event.event_id,
            timestamp: event.timestamp,
            platform: event.platform,
            level: event.level,
            exception: event.exception,
            release: event.release,
            dist: event.dist,
            environment: event.environment,
            sdk: event.sdk,
            tags: {
              error_domain: 'session',
              error_operation: 'session_startup',
              error_priority: 'high',
              error_handled: 'true',
              startup_phase: diagnostic.phase,
              app_version: environment.version,
              platform: environment.platform,
            },
          }))
          scope.setTags({
            error_domain: 'session',
            error_operation: 'session_startup',
            error_priority: 'high',
            error_handled: 'true',
            startup_phase: diagnostic.phase,
            app_version: environment.version,
            platform: environment.platform,
          })
          eventId = Sentry.captureException(error)
        })
      } catch {
        finish()
      }
    })
  } catch {
    return undefined
  }
}
