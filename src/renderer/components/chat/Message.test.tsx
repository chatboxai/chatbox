import { type Message, MessageRoleEnum } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'
import { getConversationContentClassName, getConversationRowLayout, isErrorOnlyMessage } from './message-layout'
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
      farSideSpace: 64,
      userBubbleMaxWidth: 'min(640px, 72%)',
      generatingLoaderSize: 32,
      nameRowOffset: 4,
    })
    expect(getConversationRowLayout(false, false)).toMatchObject({ farSideSpace: 128, nameRowOffset: 0 })
  })

  test('uses the small-screen avatar, gap and far-side space', () => {
    expect(getConversationRowLayout(true, true)).toEqual({
      avatarSize: 24,
      avatarGap: 8,
      farSideSpace: 24,
      userBubbleMaxWidth: '80%',
      generatingLoaderSize: 28,
      nameRowOffset: 2,
    })
    expect(getConversationRowLayout(true, false)).toMatchObject({ farSideSpace: 44, nameRowOffset: 0 })
  })
})

describe('Conversation content surface', () => {
  const content = (layout: 'classic' | 'bubble', role: 'user' | 'assistant', errorOnly = false) =>
    getConversationContentClassName({ layout, role, isSmallScreen: false, errorOnly })

  test('draws the same user bubble in both layouts', () => {
    expect(content('classic', 'user')).toBe(content('bubble', 'user'))
    expect(content('classic', 'user')).toContain('bg-[var(--mantine-color-chatbox-brand-filled)]')
    expect(content('classic', 'user')).toContain('rounded-tr-[4px]')
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
