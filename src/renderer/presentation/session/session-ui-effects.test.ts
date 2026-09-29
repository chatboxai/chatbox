import { SessionEventBus } from '@chatbox/core/application/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispose: vi.fn().mockResolvedValue(undefined),
  forSession: vi.fn(),
  clearBrowser: vi.fn(),
  abort: vi.fn(),
  cleanup: vi.fn(),
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
