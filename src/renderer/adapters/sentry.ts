import * as Sentry from '@sentry/react'
import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'
import { normalizeErrorForSentry } from '../../shared/utils/sentry_policy'

/**
 * 渲染进程的 Sentry 适配器实现
 */
export class RendererSentryAdapter implements SentryAdapter {
  captureException(error: unknown): void {
    Sentry.captureException(normalizeErrorForSentry(error))
  }

  withScope(callback: (scope: SentryScope) => void): void {
    Sentry.withScope((sentryScope) => {
      const scope: SentryScope = {
        setTag(key: string, value: string): void {
          sentryScope.setTag(key, value)
        },
        setExtra(key: string, value: unknown): void {
          sentryScope.setExtra(key, value)
        },
      }
      callback(scope)
    })
  }
}
