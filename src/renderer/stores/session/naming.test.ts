import { DEFAULT_INBOX_SESSION_ID } from '@chatbox/core'
import type { SessionHeader } from '@chatbox/core/ports'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncAutoTitle: vi.fn(),
  clearSessionState: vi.fn(),
  getSettings: vi.fn(),
}))

vi.mock('@chatbox/core/application/session', () => ({
  SessionNamingService: class {
    syncAutoTitle = mocks.syncAutoTitle
    clearSessionState = mocks.clearSessionState
    modifyNameAndThreadName = vi.fn()
    modifyThreadName = vi.fn()
  },
}))

vi.mock('@/adapters/CurrentModelFactory', () => ({ currentModelFactory: {} }))
vi.mock('@/packages/model-calls/message-utils', () => ({ convertToModelMessages: vi.fn() }))
vi.mock('@/settings-runtime', () => ({ settingsService: { getSettings: mocks.getSettings } }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('@/app/renderer-application', async () => {
  const { BackupOperationCoordinator } = await import('@chatbox/core/backup')
  return {
    rendererApplication: {
      backupOperations: new BackupOperationCoordinator(),
      sessions: {},
    },
  }
})

import { clearSessionNameGenerationState, syncSessionAutoTitle, syncSessionAutoTitleOnOpen } from './naming'

function header(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return { id: 'session-1', name: 'Untitled', type: 'chat', threadName: '', ...overrides }
}

describe('Session naming Renderer adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: true })
  })
  it('forwards the session identity to the row naming service', async () => {
    await syncSessionAutoTitle('session-1')
    expect(mocks.syncAutoTitle).toHaveBeenCalledWith('session-1')
  })
  it('delegates deletion cleanup', () => {
    clearSessionNameGenerationState('session-1')
    expect(mocks.clearSessionState).toHaveBeenCalledWith('session-1')
  })
  it.each([
    { name: 'Untitled', threadName: '' },
    { name: 'Preset title', threadName: '' },
    { id: DEFAULT_INBOX_SESSION_ID, name: 'Just chat', threadName: undefined },
  ])('skips scheduled naming when disabled: %j', async (fields) => {
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: false })
    await syncSessionAutoTitleOnOpen(header(fields), () => true)
    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })
  it('skips a conversation that already has both names', async () => {
    await syncSessionAutoTitleOnOpen(header({ name: 'Named', threadName: 'Thread' }), () => true)
    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })
  it.each([true, false])('repairs historical thread names when auto naming is %s', async (enabled) => {
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: enabled })
    await syncSessionAutoTitleOnOpen(header({ name: 'Historical', threadName: undefined }), () => true)
    expect(mocks.syncAutoTitle).toHaveBeenCalledExactlyOnceWith('session-1')
  })
  it.each([
    { name: 'Untitled', threadName: '' },
    { name: 'Preset', threadName: '' },
    { id: DEFAULT_INBOX_SESSION_ID, name: 'Just chat', threadName: undefined },
  ])('delegates eligible header decisions: %j', async (fields) => {
    const value = header(fields)
    await syncSessionAutoTitleOnOpen(value, () => true)
    expect(mocks.syncAutoTitle).toHaveBeenCalledExactlyOnceWith(value.id)
  })
  it('skips a session that is no longer visible', async () => {
    await syncSessionAutoTitleOnOpen(header(), () => false)
    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })
})
