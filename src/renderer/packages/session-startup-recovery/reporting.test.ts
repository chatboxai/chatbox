import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createStartupDiagnostic } from './diagnostics'
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  allowed: true,
  capture: vi.fn(),
  on: vi.fn(),
  clear: vi.fn(),
  tags: vi.fn(),
  processor: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@/setup/sentry_init', () => ({ initSentry: mocks.init }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ allowReportingAndTracking: mocks.allowed }) },
}))
vi.mock('@/platform', () => ({
  default: { type: 'mobile', getVersion: async () => '1.24.0', getPlatform: async () => 'android' },
}))
vi.mock('@sentry/react', () => ({
  getClient: () => ({ on: mocks.on }),
  withScope: (
    callback: (scope: {
      clear: typeof mocks.clear
      setTags: typeof mocks.tags
      addEventProcessor: typeof mocks.processor
    }) => void
  ) => callback({ clear: mocks.clear, setTags: mocks.tags, addEventProcessor: mocks.processor }),
  captureException: mocks.capture,
}))
let callback: (event: { event_id: string }, response: { statusCode: number }) => void
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.allowed = true
  mocks.init.mockResolvedValue(true)
  mocks.capture.mockReturnValue('event-1')
  mocks.on.mockImplementation((_hook, cb) => {
    callback = cb
    return mocks.unsubscribe
  })
})
afterEach(() => vi.useRealTimers())

it('reports a sanitized error once and exposes an ID only after a successful transport response', async () => {
  const { reportStartupFailure } = await import('./reporting')
  const diagnostic = createStartupDiagnostic(new Error('Active thread projection is unavailable'), 'read')
  const report = reportStartupFailure('private-session', diagnostic)
  expect(reportStartupFailure('private-session', { ...diagnostic })).toBe(report)
  await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1))
  expect(mocks.clear).toHaveBeenCalled()
  expect(mocks.tags).toHaveBeenCalledWith(expect.objectContaining({ error_priority: 'high', startup_phase: 'read' }))
  expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain('private-session')
  callback({ event_id: 'other' }, { statusCode: 200 })
  callback({ event_id: 'event-1' }, { statusCode: 200 })
  await expect(report).resolves.toBe('event-1')
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

it('does not claim delivery on a failed transport response', async () => {
  const { reportStartupFailure } = await import('./reporting')
  const report = reportStartupFailure('s', createStartupDiagnostic(new Error('database is locked'), 'read'))
  await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
  callback({ event_id: 'event-1' }, { statusCode: 429 })
  await expect(report).resolves.toBeUndefined()
})

it('honors the reporting preference', async () => {
  mocks.allowed = false
  const { reportStartupFailure } = await import('./reporting')
  await expect(
    reportStartupFailure('s', createStartupDiagnostic(new Error('database is locked'), 'read'))
  ).resolves.toBeUndefined()
  expect(mocks.capture).not.toHaveBeenCalled()
})

it('can report the same failure after the user enables reporting', async () => {
  mocks.allowed = false
  const { reportStartupFailure } = await import('./reporting')
  const diagnostic = createStartupDiagnostic(new Error('database is locked'), 'read')
  await expect(reportStartupFailure('s', diagnostic)).resolves.toBeUndefined()
  mocks.allowed = true
  const report = reportStartupFailure('s', diagnostic)
  await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
  callback({ event_id: 'event-1' }, { statusCode: 200 })
  await expect(report).resolves.toBe('event-1')
})
