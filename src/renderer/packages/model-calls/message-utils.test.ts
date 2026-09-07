import type { Message } from '@shared/types'
import { formatTimestampWithZone, SYSTEM_REMINDER_PROMPT_INSTRUCTION } from '@shared/utils/system-reminder'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildModelSystemPrompt, injectModelSystemPrompt } from './message-utils'

function textOf(message: Message): string {
  return message.contentParts.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

const conversationStartedAt = new Date('2026-08-01T10:00:00Z').getTime()

afterEach(() => {
  vi.useRealTimers()
})

describe('buildModelSystemPrompt', () => {
  it('orders content by stability: instructions first, volatile runtime block last', () => {
    const prompt = buildModelSystemPrompt('gpt-test', 'be nice', { conversationStartedAt })

    expect(prompt.indexOf('be nice')).toBeLessThan(prompt.indexOf('## Runtime'))
    expect(prompt.indexOf('Current model: gpt-test')).toBeGreaterThan(prompt.indexOf('## Runtime'))
    expect(prompt).toContain(`Conversation started: ${formatTimestampWithZone(conversationStartedAt)}`)
  })

  it('explains the system-reminder contract inside the runtime block', () => {
    const prompt = buildModelSystemPrompt('gpt-test', 'info', { conversationStartedAt })

    expect(prompt.indexOf(SYSTEM_REMINDER_PROMPT_INSTRUCTION)).toBeGreaterThan(prompt.indexOf('## Runtime'))
  })

  it('stays byte-identical across day and minute rollovers when the start time is frozen', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T23:59:00Z'))
    const before = buildModelSystemPrompt('gpt-test', 'info', { conversationStartedAt })

    vi.setSystemTime(new Date('2026-08-16T00:01:00Z'))
    const afterDayRollover = buildModelSystemPrompt('gpt-test', 'info', { conversationStartedAt })

    vi.setSystemTime(new Date('2026-08-16T00:02:30Z'))
    const afterMinuteRollover = buildModelSystemPrompt('gpt-test', 'info', { conversationStartedAt })

    expect(afterDayRollover).toBe(before)
    expect(afterMinuteRollover).toBe(before)
  })

  it('renders the start line with the frozen snapshot offset, independent of the device zone', () => {
    const prompt = buildModelSystemPrompt('gpt-test', 'info', {
      conversationStartedAt,
      conversationStartUtcOffsetMinutes: 480,
    })

    // Byte-frozen: the stored capture-time offset wins over whatever timezone
    // the device is in now, so travel never rewrites the prompt prefix.
    expect(prompt).toContain('Conversation started: 2026-08-01 18:00 (UTC+08:00)')
  })

  it('falls back to now when no conversation start is known', () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-15T12:00:00Z')
    vi.setSystemTime(now)

    expect(buildModelSystemPrompt('gpt-test', 'info')).toContain(
      `Conversation started: ${formatTimestampWithZone(now.getTime())}`
    )
  })
})

describe('injectModelSystemPrompt', () => {
  const sessionPrompt = 'You are a helpful assistant with house rules.'
  const messagesFixture = (): Message[] => [
    { id: 'sys', role: 'system', timestamp: 1, contentParts: [{ type: 'text', text: sessionPrompt }] },
    { id: 'u1', role: 'user', timestamp: 2, contentParts: [{ type: 'text', text: 'hello' }] },
  ]

  const frozenPrompt = (model: string) => buildModelSystemPrompt(model, 'info', { conversationStartedAt })

  it('appends metadata below the session prompt so the byte prefix stays stable', () => {
    const injected = injectModelSystemPrompt('model-a', messagesFixture(), 'info', 'system', frozenPrompt('model-a'))

    expect(textOf(injected[0]).startsWith(sessionPrompt)).toBe(true)
    expect(textOf(injected[0])).toContain('Current model: model-a')
    expect(injected[1].id).toBe('u1')
  })

  it('keeps the same-model output byte-identical after switching models and back', () => {
    const build = (model: string) =>
      textOf(injectModelSystemPrompt(model, messagesFixture(), 'info', 'system', frozenPrompt(model))[0])

    const first = build('model-a')
    build('model-b')
    const back = build('model-a')

    expect(back).toBe(first)
  })

  it('does not mutate the original messages', () => {
    const messages = messagesFixture()

    injectModelSystemPrompt('model-a', messages, 'info', 'system', frozenPrompt('model-a'))

    expect(textOf(messages[0])).toBe(sessionPrompt)
  })

  it('unshifts a standalone prompt message when no matching role message exists', () => {
    const [, userMessage] = messagesFixture()

    const injected = injectModelSystemPrompt('model-a', [userMessage], 'info', 'system', frozenPrompt('model-a'))

    expect(injected[0].role).toBe('system')
    expect(textOf(injected[0])).toContain('## Runtime')
    expect(injected[1].id).toBe('u1')
  })
})
