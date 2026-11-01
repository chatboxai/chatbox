import { describe, expect, it } from 'vitest'
import type { Message } from '../../types'
import { FALLBACK_CONTEXT_WINDOW_TOKENS, getCompactionBudget } from '../token-estimation/math'
import { type CompactionRetention, selectCompactionPrefix } from './compaction-retention'

function message(id: string, tokens: number, overrides: Partial<Message> = {}): Message {
  return { id, role: 'user', contentParts: [], tokenCountMap: { default: tokens }, ...overrides }
}

function retention(overrides: Partial<CompactionRetention> = {}): CompactionRetention {
  return {
    budget: getCompactionBudget(10_000, { maxOutputTokens: 2_000 })!,
    ratio: 0.16,
    requestOverheadTokens: 0,
    countTokens: (messages) =>
      Promise.resolve(messages.reduce((total, item) => total + (item.tokenCountMap?.default ?? 0), 0)),
    ...overrides,
  }
}

describe('conversation compaction retention', () => {
  it('retains a continuous tail up to the first whole-message boundary past the target', async () => {
    // 8K usable, 1,280 target: retain 900 + 600 tokens.
    const messages = [message('old', 4000), message('recent-user', 600), message('recent-assistant', 900)]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual([messages[0]])
  })

  it('retains an exact target without adding an extra message', async () => {
    const messages = [message('old', 4000), message('recent', 1280)]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual([messages[0]])
  })

  it('uses the same ratio with the unknown-window fallback and no fixed token cap', async () => {
    for (const window of [FALLBACK_CONTEXT_WINDOW_TOKENS, 1_000_000]) {
      const budget = getCompactionBudget(window)!
      const target = Math.floor(budget.usableTokens * 0.16)
      const messages = [message('old', window), message('recent', target)]
      expect(await selectCompactionPrefix(messages, undefined, retention({ budget }))).toEqual([messages[0]])
    }
  })

  it('uses system, tools, pending input and summary reservations to limit the tail', async () => {
    // Target after compaction 4K - system 500 - tools 500 - pending 1K - summary 800 = 1,200.
    const messages = [
      message('system', 500, { role: 'system' }),
      message('old', 4000),
      message('u', 600),
      message('a', 900),
    ]
    const prefix = await selectCompactionPrefix(
      messages,
      message('pending', 1000),
      retention({ requestOverheadTokens: 500 })
    )
    expect(prefix.map((item) => item.id)).toEqual(['system', 'old', 'u'])
  })

  it('summarizes all completed history when there is no space for a retained tail', async () => {
    const messages = [message('old', 4000), message('recent', 900)]
    expect(await selectCompactionPrefix(messages, message('pending', 4000), retention())).toEqual(messages)
  })

  it('never skips an oversized recent message to retain an older one', async () => {
    const messages = [message('old-small', 100), message('recent-large', 5000)]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual(messages)
  })

  it('keeps the content of a tool call and its result intact', async () => {
    const tool = message('tool-round', 1500, {
      role: 'assistant',
      contentParts: [
        { type: 'tool-call', state: 'result', toolCallId: 'call', toolName: 'read', args: {}, result: 'body' },
      ],
    })
    const messages = [message('old', 4000), tool]
    const before = structuredClone(messages)
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual([messages[0]])
    expect(messages).toEqual(before)
  })

  it('keeps legacy standalone tool results with their assistant call', async () => {
    const messages = [
      message('old', 4000),
      message('call', 300, { role: 'assistant' }),
      message('result', 1400, { role: 'tool' }),
    ]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual([messages[0]])
  })

  it('does not retain only a result when its complete tool group exceeds capacity', async () => {
    const messages = [
      message('old', 4000),
      message('call', 2500, { role: 'assistant' }),
      message('result', 1400, { role: 'tool' }),
    ]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual(messages)
  })

  it('leaves system messages and an old summary outside the retention target', async () => {
    const messages = [
      message('system', 100, { role: 'system' }),
      message('summary', 500, { role: 'assistant', isSummary: true }),
      message('recent', 100),
    ]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual(messages.slice(0, 2))
  })

  it('can leave no older history to summarize', async () => {
    const messages = [message('recent', 100)]
    expect(await selectCompactionPrefix(messages, undefined, retention())).toEqual([])
    expect(await selectCompactionPrefix([], undefined, retention())).toEqual([])
  })

  it('treats zero as explicitly retaining nothing', async () => {
    const messages = [message('old', 4000), message('recent', 900)]
    expect(await selectCompactionPrefix(messages, undefined, retention({ ratio: 0 }))).toBe(messages)
  })

  it('caps a high retention ratio at the existing compaction target', async () => {
    const messages = [message('old', 4000), message('u', 1000), message('a', 2500)]
    expect(await selectCompactionPrefix(messages, undefined, retention({ ratio: 0.5 }))).toEqual(messages.slice(0, 2))
  })
})
