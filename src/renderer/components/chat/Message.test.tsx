import { type Message, MessageRoleEnum } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'
import { shouldRightAlignMessage } from './message-layout'
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

describe('Message layout alignment', () => {
  test('keeps user messages left-aligned in classic layout', () => {
    expect(shouldRightAlignMessage('left', MessageRoleEnum.User)).toBe(false)
  })

  test('right-aligns user messages only in bubble layout', () => {
    expect(shouldRightAlignMessage('bubble', MessageRoleEnum.User)).toBe(true)
    expect(shouldRightAlignMessage('bubble', MessageRoleEnum.Assistant)).toBe(false)
  })

  test('does not right-align system or tool messages in any layout', () => {
    expect(shouldRightAlignMessage('left', MessageRoleEnum.System)).toBe(false)
    expect(shouldRightAlignMessage('bubble', MessageRoleEnum.System)).toBe(false)
    expect(shouldRightAlignMessage('left', MessageRoleEnum.Tool)).toBe(false)
    expect(shouldRightAlignMessage('bubble', MessageRoleEnum.Tool)).toBe(false)
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
