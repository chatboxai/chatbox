import { DEFAULT_INBOX_SESSION_ID, type Session } from '@chatbox/core'
import type { SessionHeader } from '@chatbox/core/ports'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncAutoTitle: vi.fn(),
  clearSessionState: vi.fn(),
  getSession: vi.fn(),
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
      sessions: { updateSession: vi.fn(), updateSessionWithMessages: vi.fn() },
      sessionQueryBridge: { getSession: mocks.getSession },
    },
  }
})

import { clearSessionNameGenerationState, syncSessionAutoTitle, syncSessionAutoTitleOnOpen } from './naming'

function header(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return { id: 'session-1', name: 'Untitled', type: 'chat', threadName: '', ...overrides }
}

function completeSession(sessionHeader: SessionHeader): Session {
  return {
    ...sessionHeader,
    messages: [
      { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'hello' }] },
      { id: 'assistant', role: 'assistant', contentParts: [{ type: 'text', text: 'hi' }], finishReason: 'stop' },
    ],
  }
}

describe('Session naming Renderer adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: true })
    mocks.getSession.mockReset()
  })

  it('forwards the current session to syncAutoTitle', async () => {
    const session = {
      id: 'session-1',
      name: 'Untitled',
      type: 'chat' as const,
      messages: [{ id: 'user', role: 'user' as const, contentParts: [{ type: 'text' as const, text: 'hello' }] }],
    }

    await syncSessionAutoTitle(session)

    expect(mocks.syncAutoTitle).toHaveBeenCalledWith(session, { messages: session.messages })
  })

  it('delegates deletion cleanup to the shared naming service', () => {
    clearSessionNameGenerationState('session-1')

    expect(mocks.clearSessionState).toHaveBeenCalledWith('session-1')
  })

  it.each([
    { name: 'Untitled', threadName: '' },
    { name: 'Preset title', threadName: '' },
    { id: DEFAULT_INBOX_SESSION_ID, name: 'Just chat', threadName: undefined },
  ])('does not load messages with automatic naming disabled: %j', async (fields) => {
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: false })

    await syncSessionAutoTitleOnOpen(header(fields), () => true)

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })

  it('does not read a named long session whose thread already has a name', async () => {
    const sessionHeader = header({ name: 'Long conversation', threadName: 'Current thread' })
    const session = completeSession(sessionHeader)
    session.messages = Array.from({ length: 1000 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      contentParts: [{ type: 'text', text: `Message ${index}` }],
    }))
    mocks.getSession.mockResolvedValue(session)

    await syncSessionAutoTitleOnOpen(sessionHeader, () => true)

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })

  it.each([true, false])('loads historical thread-name repair when autoGenerateTitle=%s', async (enabled) => {
    const sessionHeader = header({ name: 'Historical title', threadName: undefined })
    const session = completeSession(sessionHeader)
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: enabled })
    mocks.getSession.mockResolvedValue(session)

    await syncSessionAutoTitleOnOpen(sessionHeader, () => true)

    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith(sessionHeader.id)
    expect(mocks.syncAutoTitle).toHaveBeenCalledExactlyOnceWith(session, { messages: session.messages })
  })

  it.each([
    { name: 'Untitled', threadName: '' },
    { name: 'Untitled', threadName: 'Current thread' },
    { name: 'Preset title', threadName: '' },
    { id: DEFAULT_INBOX_SESSION_ID, name: 'Just chat', threadName: undefined },
  ])('preserves content-based naming decisions for eligible headers: %j', async (fields) => {
    const sessionHeader = header(fields)
    const session = completeSession(sessionHeader)
    mocks.getSession.mockResolvedValue(session)

    await syncSessionAutoTitleOnOpen(sessionHeader, () => true)

    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith(sessionHeader.id)
    expect(mocks.syncAutoTitle).toHaveBeenCalledExactlyOnceWith(session, { messages: session.messages })
  })

  it('passes empty historical conversations through to content-based repair', async () => {
    const sessionHeader = header({ name: 'Old cleared title', threadName: undefined })
    const session: Session = { ...sessionHeader, messages: [] }
    mocks.getSettings.mockReturnValue({ autoGenerateTitle: false })
    mocks.getSession.mockResolvedValue(session)

    await syncSessionAutoTitleOnOpen(sessionHeader, () => true)

    expect(mocks.syncAutoTitle).toHaveBeenCalledExactlyOnceWith(session, { messages: [] })
  })

  it('uses an already complete session directly', async () => {
    const session = completeSession(header())

    await syncSessionAutoTitleOnOpen(session, () => true)

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.syncAutoTitle).toHaveBeenCalledExactlyOnceWith(session, { messages: session.messages })
  })

  it('does not sync a completed read after the visible session changes', async () => {
    const sessionHeader = header()
    let resolveRead: (session: Session) => void = () => undefined
    mocks.getSession.mockReturnValue(
      new Promise<Session>((resolve) => {
        resolveRead = resolve
      })
    )
    let active = true
    const pending = syncSessionAutoTitleOnOpen(sessionHeader, () => active)
    active = false
    resolveRead(completeSession(sessionHeader))
    await pending

    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })

  it('does not sync a session deleted before its complete read', async () => {
    mocks.getSession.mockResolvedValue(null)

    await syncSessionAutoTitleOnOpen(header(), () => true)

    expect(mocks.syncAutoTitle).not.toHaveBeenCalled()
  })
})
