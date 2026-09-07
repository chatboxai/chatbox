import * as Sentry from '@sentry/react'
import { normalizeErrorForSentry, type SentryErrorPriority } from '@shared/utils/sentry_policy'

export interface ReportErrorContext {
  domain: string
  extras?: Record<string, unknown>
  handled?: boolean
  operation: string
  priority?: SentryErrorPriority
  tags?: Record<string, string | number | boolean>
}

/**
 * Report an unexpected renderer failure with stable, searchable dimensions.
 * Expected user/API/network failures should stay in local logs and user-facing UI.
 */
export function reportError(error: unknown, context: ReportErrorContext): void {
  Sentry.withScope((scope) => {
    scope.setTag('component', context.domain)
    scope.setTag('operation', context.operation)
    scope.setTag('error_domain', context.domain)
    scope.setTag('error_operation', context.operation)
    scope.setTag('error_priority', context.priority ?? 'normal')
    scope.setTag('error_handled', String(context.handled ?? true))

    for (const [key, value] of Object.entries(context.tags ?? {})) {
      scope.setTag(key, value)
    }
    for (const [key, value] of Object.entries(context.extras ?? {})) {
      scope.setExtra(key, value)
    }

    Sentry.captureException(normalizeErrorForSentry(error))
  })
}
