import * as Sentry from '@sentry/react'
import type { Envelope } from '@sentry/core'
import { afterEach, expect, it, vi } from 'vitest'
import { sessionDiagnosticsIntegrations } from '@/setup/session-diagnostics-integrations'
import { createStartupDiagnostic } from './diagnostics'
vi.mock('@/setup/sentry_init', () => ({ initSentry: async () => true }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ allowReportingAndTracking: true }) } }))
vi.mock('@/platform', () => ({
  default: { type: 'desktop', getVersion: async () => '1.24.0', getPlatform: async () => 'darwin' },
}))
afterEach(async () => {
  await Sentry.close()
  Sentry.getIsolationScope().clear()
})
it('sends only sanitized diagnostics through the real SDK even with private isolation context', async () => {
  const envelopes: Envelope[] = []
  Sentry.init({
    dsn: 'https://public@example.invalid/1',
    defaultIntegrations: false,
    transport: () => ({
      send: (envelope) => {
        envelopes.push(envelope)
        return Promise.resolve({ statusCode: 200 })
      },
      flush: async () => true,
    }),
  })
  Sentry.getIsolationScope().addBreadcrumb({ message: 'private conversation', data: { sessionId: 'private-session' } })
  Sentry.getIsolationScope().setUser({ id: 'private-license' })
  Sentry.getIsolationScope().setExtra('apiKey', 'sk-private')
  const { reportStartupFailure } = await import('./reporting')
  const error = new Error('database is locked')
  error.stack = 'Error: database is locked\n    at read (app:///out/renderer/assets/index.abc.js:3:14)'
  const id = await reportStartupFailure('private-session', createStartupDiagnostic(error, 'read'))
  expect(id).toMatch(/^[a-f0-9]{32}$/)
  expect(envelopes).toHaveLength(1)
  const payload = JSON.stringify(envelopes)
  expect(payload).toContain('database is locked')
  // Full frame locations let the SDK attach debug IDs for symbolication.
  expect(payload).toContain('"filename":"app:///out/renderer/assets/index.abc.js"')
  expect(payload).not.toMatch(/private conversation|private-session|private-license|sk-private/)
})

it('retries a failed transport with SDK dedupe enabled and preserves normal error deduplication', async () => {
  const envelopes: Envelope[] = []
  Sentry.init({
    dsn: 'https://public@example.invalid/1',
    defaultIntegrations: false,
    integrations: sessionDiagnosticsIntegrations([Sentry.dedupeIntegration()]),
    transport: () => ({
      send: (envelope) => {
        envelopes.push(envelope)
        return Promise.resolve({ statusCode: envelopes.length === 1 ? 503 : 200 })
      },
      flush: async () => true,
    }),
  })
  const { reportStartupFailure } = await import('./reporting')
  const diagnostic = createStartupDiagnostic(new Error('database is locked'), 'read')
  await expect(reportStartupFailure('retry-test', diagnostic)).resolves.toBeUndefined()
  await expect(reportStartupFailure('retry-test', diagnostic)).resolves.toMatch(/^[a-f0-9]{32}$/)
  expect(envelopes).toHaveLength(2)
  Sentry.captureMessage('ordinary duplicate')
  Sentry.captureMessage('ordinary duplicate')
  await Sentry.flush()
  expect(envelopes).toHaveLength(3)
})
