import type { Integration } from '@sentry/core'

/** Startup diagnostics deduplicate in-flight and confirmed reports so failed sends remain retryable. */
export function sessionDiagnosticsIntegrations(integrations: Integration[]): Integration[] {
  return integrations.map((integration) => {
    if (integration.name !== 'Dedupe') return integration
    return {
      ...integration,
      processEvent(event, hint, client) {
        if (event.tags?.error_domain === 'session' && event.tags?.error_operation === 'session_startup') return event
        return integration.processEvent ? integration.processEvent(event, hint, client) : event
      },
    }
  })
}
