import { type Message, MessageRoleEnum } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'
import {
  ASSISTANT_CONTENT_MAX_WIDTH,
  getConversationContentClassName,
  getConversationRowLayout,
  getLongPressSurfaceClassName,
  hasConversationContentSurface,
  isErrorOnlyMessage,
  isUserMessageOnRight,
} from './message-layout'
import { getMessageRoleClass } from './message-role-class'
import { getMessageTokenDisplay } from './message-token-display'

vi.mock('@/stores/session', async () => vi.importActual('@/stores/session/message-success'))

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-message',
    role: 'assistant',
    contentParts: [{ type: 'text', text: 'Completed answer' }],
    ...overrides,
  }
}

describe('Message role classes', () => {
  test('maps each message role to its semantic class', () => {
    expect(getMessageRoleClass(MessageRoleEnum.User)).toBe('user-msg')
    expect(getMessageRoleClass(MessageRoleEnum.Assistant)).toBe('assistant-msg')
    expect(getMessageRoleClass(MessageRoleEnum.System)).toBe('system-msg')
    expect(getMessageRoleClass(MessageRoleEnum.Tool)).toBe('tool-msg')
  })
})

describe('Conversation row layout', () => {
  test('uses the wide-screen avatar, gap and far-side space', () => {
    expect(getConversationRowLayout(false, true)).toEqual({
      avatarSize: 28,
      avatarGap: 10,
      userFarSideSpace: 64,
      assistantFarSideSpace: 64,
      assistantAvatarAbove: false,
      userBubbleMaxWidth: 'min(640px, 72%)',
      spansColumn: false,
      assistantContentMaxWidth: ASSISTANT_CONTENT_MAX_WIDTH,
      generatingLoaderSize: 32,
      nameRowOffset: 4,
    })
    expect(getConversationRowLayout(false, false)).toMatchObject({
      userFarSideSpace: 128,
      assistantFarSideSpace: 128,
      nameRowOffset: 0,
    })
  })

  test('puts the small-screen assistant avatar above a reply that runs to the right edge', () => {
    expect(getConversationRowLayout(true, true)).toEqual({
      avatarSize: 24,
      avatarGap: 8,
      userFarSideSpace: 0,
      assistantFarSideSpace: 0,
      assistantAvatarAbove: true,
      userBubbleMaxWidth: 'calc(100% - 3rem)',
      spansColumn: false,
      assistantContentMaxWidth: ASSISTANT_CONTENT_MAX_WIDTH,
      generatingLoaderSize: 28,
      nameRowOffset: 2,
    })
  })

  test('widens small-screen replies and user bubbles with avatars hidden', () => {
    expect(getConversationRowLayout(true, false)).toMatchObject({
      userFarSideSpace: 0,
      assistantFarSideSpace: 0,
      assistantAvatarAbove: false,
      userBubbleMaxWidth: '95%',
      nameRowOffset: 0,
    })
  })

  test('lets replies span the full-width column on wide screens', () => {
    for (const showAvatar of [true, false]) {
      const layout = getConversationRowLayout(false, showAvatar, true)
      expect(layout.spansColumn).toBe(true)
      expect(layout.userFarSideSpace).toBe(0)
      expect(layout.assistantFarSideSpace).toBe(0)
      expect(layout.assistantAvatarAbove).toBe(false)
      expect(layout.assistantContentMaxWidth).toBeUndefined()
      expect(layout.userBubbleMaxWidth).toBe('min(640px, 72%)')
    }
  })

  test('keeps the small-screen row unchanged in the full-width column', () => {
    expect(getConversationRowLayout(true, true, true)).toEqual(getConversationRowLayout(true, true))
    expect(getConversationRowLayout(true, false, true)).toEqual(getConversationRowLayout(true, false))
  })
})

describe('User message side', () => {
  test('keeps the user avatar on the left in classic and on the right in bubble', () => {
    expect(isUserMessageOnRight('classic')).toBe(false)
    expect(isUserMessageOnRight('bubble')).toBe(true)
  })
})

describe('Conversation content surface', () => {
  const content = (layout: 'classic' | 'bubble', role: 'user' | 'assistant', errorOnly = false) =>
    getConversationContentClassName({ layout, role, isSmallScreen: false, errorOnly })

  test('fills the classic user bubble gray and the bubble-layout user bubble with the brand color', () => {
    expect(content('classic', 'user')).toContain('bg-chatbox-background-secondary')
    expect(content('classic', 'user')).not.toContain('brand')
    expect(content('classic', 'user')).not.toContain('text-white')
    expect(content('bubble', 'user')).toContain('bg-[var(--mantine-color-chatbox-brand-filled)]')
    expect(content('bubble', 'user')).toContain('text-white')
  })

  test('points the user bubble tail toward the user avatar', () => {
    expect(content('classic', 'user')).toContain('rounded-tl-[4px]')
    expect(content('classic', 'user')).not.toContain('rounded-tr-[4px]')
    expect(content('bubble', 'user')).toContain('rounded-tr-[4px]')
    expect(content('bubble', 'user')).not.toContain('rounded-tl-[4px]')
  })

  test('lays assistant replies flat in classic and inside a bubble in bubble layout', () => {
    expect(content('classic', 'assistant')).not.toContain('bg-')
    expect(content('classic', 'assistant')).not.toContain('px-')
    expect(content('bubble', 'assistant')).toContain('bg-chatbox-background-secondary')
    expect(content('bubble', 'assistant')).toContain('rounded-tl-[4px]')
    expect(content('bubble', 'assistant')).toContain('px-4 py-2.5')
    expect(
      getConversationContentClassName({ layout: 'bubble', role: 'assistant', isSmallScreen: true, errorOnly: false })
    ).toContain('px-3.5 py-[9px]')
  })

  test('keeps error-only replies out of the bubble surface', () => {
    expect(content('bubble', 'assistant', true)).not.toContain('bg-')
  })

  test('fills the full-width column with a classic reply while a bubble keeps fitting its content', () => {
    const spanning = (layout: 'classic' | 'bubble', errorOnly = false) =>
      getConversationContentClassName({ layout, role: 'assistant', isSmallScreen: false, errorOnly, spansColumn: true })
    expect(content('classic', 'assistant').split(' ')).not.toContain('w-full')
    expect(spanning('classic').split(' ')).toContain('w-full')
    expect(spanning('bubble')).toBe(content('bubble', 'assistant'))
    expect(spanning('classic', true)).toBe(content('classic', 'assistant', true))
  })
})

describe('Long-press surface', () => {
  test('gives the pressed tint to bubbles only', () => {
    expect(hasConversationContentSurface({ layout: 'classic', role: 'user', errorOnly: false })).toBe(true)
    expect(hasConversationContentSurface({ layout: 'bubble', role: 'user', errorOnly: false })).toBe(true)
    expect(hasConversationContentSurface({ layout: 'bubble', role: 'assistant', errorOnly: false })).toBe(true)
    expect(hasConversationContentSurface({ layout: 'classic', role: 'assistant', errorOnly: false })).toBe(false)
    expect(hasConversationContentSurface({ layout: 'bubble', role: 'assistant', errorOnly: true })).toBe(false)
  })

  test('draws the tint inside the surface, clipped to its corners, only while pressed', () => {
    const pressed = getLongPressSurfaceClassName(true).split(' ')
    expect(pressed).toEqual(
      expect.arrayContaining(['relative', 'isolate', 'before:inset-0', 'before:-z-10', 'before:rounded-[inherit]'])
    )
    expect(pressed).toContain('before:bg-black/[0.08]')
    expect(getLongPressSurfaceClassName(false).split(' ')).toContain('before:bg-transparent')
    expect(getLongPressSurfaceClassName(false)).not.toContain('before:bg-black')
  })
})

describe('Message token display', () => {
  test('shows provider usage as consumed for a successful completed reply', () => {
    expect(
      getMessageTokenDisplay(
        assistantMessage({
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          tokensUsed: 999,
        })
      )
    ).toEqual({ totalTokens: 15 })
  })

  test('includes cached input tokens reported by the provider', () => {
    expect(
      getMessageTokenDisplay(
        assistantMessage({
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 8 },
        })
      )
    ).toEqual({ totalTokens: 15, cachedInputTokens: 8 })
  })

  test.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    'hides an invalid cached input count: %s',
    (cachedInputTokens) => {
      expect(
        getMessageTokenDisplay(
          assistantMessage({
            finishReason: 'stop',
            usage: { totalTokens: 15, cachedInputTokens },
          })
        )
      ).toEqual({ totalTokens: 15 })
    }
  )

  test.each([{ error: 'request failed' }, { errorCode: 500 }, { finishReason: 'error' }])(
    'hides residual usage and estimates for failed replies: %o',
    (failure) => {
      expect(
        getMessageTokenDisplay(
          assistantMessage({
            ...failure,
            usage: { totalTokens: 15, cachedInputTokens: 8 },
            tokensUsed: 999,
          })
        )
      ).toBeNull()
    }
  )

  test('hides token metadata for canceled and blank replies', () => {
    expect(
      getMessageTokenDisplay(
        assistantMessage({
          finishReason: 'canceled',
          usage: { totalTokens: 15 },
          tokensUsed: 999,
        })
      )
    ).toBeNull()
    expect(
      getMessageTokenDisplay(
        assistantMessage({
          contentParts: [],
          finishReason: 'stop',
          usage: { totalTokens: 15 },
          tokensUsed: 999,
        })
      )
    ).toBeNull()
  })

  test('hides successful legacy messages without provider usage', () => {
    expect(getMessageTokenDisplay(assistantMessage({ finishReason: 'stop', tokensUsed: 42 }))).toBeNull()
  })

  test('does not treat usage without a completion signal as consumed', () => {
    expect(getMessageTokenDisplay(assistantMessage({ usage: { totalTokens: 15 } }))).toBeNull()
  })
})

describe('Error-only message layout', () => {
  test.each<Partial<Message>>([
    { contentParts: [] },
    { contentParts: [{ type: 'text', text: '  ' }] },
    { contentParts: [{ type: 'reasoning', text: '', protocolOnly: true }] },
  ])('uses a standalone card when no visible content preceded the failure: %o', (content) => {
    expect(isErrorOnlyMessage(assistantMessage({ error: 'Connection interrupted', ...content }))).toBe(true)
  })

  test.each<Partial<Message>>([
    { contentParts: [{ type: 'text', text: 'Partial streamed answer' }] },
    { contentParts: [{ type: 'reasoning', text: 'Inspecting the request' }] },
    { contentParts: [], reasoningContent: 'Legacy reasoning' },
    { contentParts: [{ type: 'image', storageKey: 'generated-image' }] },
    {
      contentParts: [
        {
          type: 'tool-call',
          toolCallId: 'download',
          toolName: 'create_download',
          state: 'result',
          args: {},
          result: 'ready',
        },
      ],
    },
  ])('preserves the normal bubble when content preceded the failure: %o', (content) => {
    expect(isErrorOnlyMessage(assistantMessage({ error: 'Connection interrupted', ...content }))).toBe(false)
  })

  test('keeps ordinary empty messages in the normal layout', () => {
    expect(isErrorOnlyMessage(assistantMessage({ contentParts: [] }))).toBe(false)
  })
})
