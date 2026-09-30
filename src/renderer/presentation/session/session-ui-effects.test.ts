import { RowBackedSessionRepository, SessionEventBus } from '@chatbox/core/application/session'
import { InMemorySessionRecordStore, InMemorySessionRowStore } from '@chatbox/core/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispose: vi.fn().mockResolvedValue(undefined),
  forSession: vi.fn(),
  clearBrowser: vi.fn(),
  abort: vi.fn(),
  cleanup: vi.fn(),
  syncTitleHeader: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { generationRuntime: { abort: mocks.abort } },
}))
vi.mock('@/components/chat/MessageList', () => ({ clearScrollPositionCache: mocks.cleanup }))
vi.mock('@/packages/session-startup-recovery', () => ({ sessionStartupRecovery: { forget: mocks.cleanup } }))
vi.mock('@/platform', () => ({ default: { type: 'desktop', builtInBrowser: { forSession: mocks.forSession } } }))
vi.mock('@/stores/session/naming', () => ({
  clearSessionNameGenerationState: mocks.cleanup,
  syncSessionAutoTitle: vi.fn(),
  syncSessionAutoTitleOnOpen: mocks.syncTitleHeader,
}))
vi.mock('@/stores/sessionActivityStore', () => ({ clearSessionActivity: mocks.cleanup }))
vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      clearSessionWebBrowsing: mocks.cleanup,
      removeSessionKnowledgeBase: mocks.cleanup,
      clearSessionAgentMode: mocks.cleanup,
      clearSessionPanel: mocks.clearBrowser,
    }),
  },
}))

const { registerSessionUiEffects } = await import('./session-ui-effects')

describe('session browser cleanup', () => {
  it('routes committed row headers to title eligibility and skips writes without metadata or hidden writes', async () => {
    const repository = new RowBackedSessionRepository({
      records: new InMemorySessionRecordStore(),
      rows: new InMemorySessionRowStore(),
    })
    await repository.setSession({ id: 'a', name: 'Untitled', messages: [] })
    const result = await repository.executeSessionCommand('a', {
      type: 'append',
      messages: [{ id: 'u', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }],
    })
    if (result.kind !== 'rows') throw new Error('Expected row command')
    const events = new SessionEventBus()
    const unsubscribe = registerSessionUiEffects(events)
    const event = {
      type: 'session-command-committed' as const,
      delta: result.delta,
      meta: { id: 'a', name: 'Untitled' },
      preserveCachedGeneratingMessages: false,
    }
    await events.publish(event)
    expect(mocks.syncTitleHeader).toHaveBeenCalledWith(result.delta.header, expect.any(Function))
    await events.publish({ ...event, meta: null })
    await events.publish({ ...event, delta: { ...result.delta, header: { ...result.delta.header, hidden: true } } })
    expect(mocks.syncTitleHeader).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.forSession.mockReturnValue({ dispose: mocks.dispose })
  })

  it.each([{ ids: ['a'] }, { ids: ['a', 'b'] }])(
    'releases browser pages and UI state for deletion of $ids',
    async ({ ids }) => {
      const events = new SessionEventBus()
      const unsubscribe = registerSessionUiEffects(events)
      await events.publish({ type: 'session-deleted', ids })
      expect(mocks.forSession.mock.calls).toEqual(ids.map((id) => [id]))
      expect(mocks.clearBrowser.mock.calls).toEqual(ids.map((id) => [id]))
      expect(mocks.dispose).toHaveBeenCalledTimes(ids.length)
      unsubscribe()
      await events.publish({ type: 'session-deleted', ids: ['after-unsubscribe'] })
      expect(mocks.dispose).toHaveBeenCalledTimes(ids.length)
    }
  )

  it('keeps the page until deletion succeeds', async () => {
    const events = new SessionEventBus()
    const unsubscribe = registerSessionUiEffects(events)
    await events.publish({ type: 'session-will-delete', ids: ['a'], operation: 'session deletion' })
    expect(mocks.abort).toHaveBeenCalledWith('a', undefined, 'session-deleted')
    expect(mocks.dispose).not.toHaveBeenCalled()
    unsubscribe()
  })
})
