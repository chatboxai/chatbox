import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackJkAutoEvent, trackJkClickEvent } from './jk'
import { JK_EVENTS, JK_PAGE_NAMES } from './jk-events'
import { type TokenExhaustedCardTrackingContext, trackTokenExhaustedCard } from './token-exhausted-card'

vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
  },
}))

vi.mock('./jk', () => ({
  trackJkAutoEvent: vi.fn(),
  trackJkClickEvent: vi.fn(),
}))

const context = {
  sessionId: 'session-123',
  mode: 'work_mode',
  provider: 'chatbox-ai',
  model: 'claude-opus-5',
  action: 'buy-expansion-pack',
  plan: 'pro_plus',
} satisfies TokenExhaustedCardTrackingContext

const expectedOptions = {
  pageName: JK_PAGE_NAMES.CHAT_PAGE,
  platform: 'app',
  content: 'pro_plus',
  contentType: 'claude-opus-5',
  props: {
    agent_info: {
      content: 'buy_token',
      mode: 'work_mode',
      session_id: 'session-123',
    },
    content_add_info: {
      content: 'chatbox-ai',
    },
  },
}

describe('token exhausted card tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tracks card exposure with AUTO and the complete card context', () => {
    trackTokenExhaustedCard('exposure', context)

    expect(trackJkAutoEvent).toHaveBeenCalledWith(JK_EVENTS.TOKEN_EXHAUSTED_CARD, expectedOptions)
  })

  it('tracks CTA clicks with CLICK and the same card context', () => {
    trackTokenExhaustedCard('click', context)

    expect(trackJkClickEvent).toHaveBeenCalledWith(JK_EVENTS.TOKEN_EXHAUSTED_CARD_CLICK, expectedOptions)
  })

  it('maps the semantic upgrade action to the stable analytics code', () => {
    trackTokenExhaustedCard('exposure', { ...context, action: 'upgrade-plan' })

    expect(trackJkAutoEvent).toHaveBeenCalledWith(
      JK_EVENTS.TOKEN_EXHAUSTED_CARD,
      expect.objectContaining({
        props: expect.objectContaining({
          agent_info: expect.objectContaining({ content: 'upgrade' }),
        }),
      })
    )
  })
})
