import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { applyAnthropicCacheBreakpoints } from './anthropic-cache'

const cacheControl = { type: 'ephemeral' as const }

type Marker = { message: number; part?: number }

function getMarker(options: unknown): unknown {
  const anthropic = (options as { anthropic?: Record<string, unknown> } | undefined)?.anthropic
  return anthropic?.cacheControl ?? anthropic?.cache_control
}

function markers(messages: ModelMessage[]): Marker[] {
  const found: Marker[] = []
  messages.forEach((message, index) => {
    if (getMarker(message.providerOptions)) found.push({ message: index })
    if (typeof message.content !== 'string') {
      message.content.forEach((part, partIndex) => {
        if ('providerOptions' in part && getMarker(part.providerOptions))
          found.push({ message: index, part: partIndex })
      })
    }
  })
  return found
}

const system: ModelMessage = { role: 'system', content: 'you are helpful' }
const user = (text: string): ModelMessage => ({ role: 'user', content: [{ type: 'text', text }] })
const toolCall = (id: string): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: 'read', input: {} }],
})
const toolResult = (...ids: string[]): ModelMessage => ({
  role: 'tool',
  content: ids.map((id) => ({
    type: 'tool-result' as const,
    toolCallId: id,
    toolName: 'read',
    output: { type: 'text' as const, value: `result ${id}` },
  })),
})

describe('applyAnthropicCacheBreakpoints', () => {
  it('returns an empty array unchanged', () => {
    expect(applyAnthropicCacheBreakpoints([])).toEqual([])
  })

  it('marks a single user message', () => {
    const result = applyAnthropicCacheBreakpoints([user('hello')])
    expect(result[0].providerOptions?.anthropic).toEqual({ cacheControl })
  })

  it.each(['5m', '1h'] as const)('applies an explicit %s TTL', (ttl) => {
    const result = applyAnthropicCacheBreakpoints([system, user('hello')], ttl)
    expect(getMarker(result[0].providerOptions)).toEqual({ type: 'ephemeral', ttl })
    expect(getMarker(result[1].providerOptions)).toEqual({ type: 'ephemeral', ttl })
  })

  it('marks the system prompt, the previous turn and the last turn of a conversation', () => {
    const messages: ModelMessage[] = [
      system,
      user('first'),
      { role: 'assistant', content: [{ type: 'text', text: 'response1' }] },
      user('second'),
      { role: 'assistant', content: [{ type: 'text', text: 'response2' }] },
      user('third'),
    ]
    expect(markers(applyAnthropicCacheBreakpoints(messages))).toEqual([{ message: 0 }, { message: 3 }, { message: 5 }])
  })

  it('moves the tail breakpoints forward on every round of a tool loop and never accumulates markers', () => {
    let transcript = applyAnthropicCacheBreakpoints([system, user('task')])
    expect(markers(transcript)).toEqual([{ message: 0 }, { message: 1 }])

    for (let round = 1; round <= 5; round++) {
      // The SDK carries the previous request's messages, markers included, into the next step.
      transcript = applyAnthropicCacheBreakpoints([...transcript, toolCall(`t${round}`), toolResult(`t${round}`)])
      const last = transcript.length - 1
      expect(markers(transcript)).toEqual([
        { message: 0 },
        { message: last - 2, part: round === 1 ? undefined : 0 },
        { message: last, part: 0 },
      ])
    }
  })

  it('marks only the last tool result of a message with parallel results', () => {
    const result = applyAnthropicCacheBreakpoints([system, user('task'), toolCall('a'), toolResult('a', 'b', 'c')])
    expect(markers(result)).toEqual([{ message: 0 }, { message: 1 }, { message: 3, part: 2 }])
  })

  it('falls back to the previous eligible block when an assistant message ends with thinking', () => {
    const messages: ModelMessage[] = [
      system,
      user('task'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool-call', toolCallId: 't1', toolName: 'read', input: {} },
          { type: 'reasoning', text: 'thinking' },
        ],
      },
    ]
    expect(markers(applyAnthropicCacheBreakpoints(messages))).toEqual([
      { message: 0 },
      { message: 1 },
      { message: 2, part: 1 },
    ])
  })

  it('falls back to the previous message when the last one has only thinking or empty text', () => {
    const messages: ModelMessage[] = [
      system,
      user('task'),
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: '' },
        ],
      },
    ]
    expect(markers(applyAnthropicCacheBreakpoints(messages))).toEqual([{ message: 0 }, { message: 1 }])
  })

  it('marks the inserted user message and the tail before the current run when a user message arrives mid-run', () => {
    const previous = applyAnthropicCacheBreakpoints([system, user('task'), toolCall('t1'), toolResult('t1')])
    const result = applyAnthropicCacheBreakpoints([...previous, user('also check b.txt')])
    expect(markers(result)).toEqual([{ message: 0 }, { message: 1 }, { message: 4 }])
  })

  it('drops stale markers when compaction replaces the transcript', () => {
    let transcript = applyAnthropicCacheBreakpoints([system, user('task')])
    for (const id of ['t1', 't2', 't3']) {
      transcript = applyAnthropicCacheBreakpoints([...transcript, toolCall(id), toolResult(id)])
    }
    const compacted = [transcript[0], user('Summary of earlier work'), ...transcript.slice(-2)]
    expect(markers(applyAnthropicCacheBreakpoints(compacted))).toEqual([
      { message: 0 },
      { message: 1 },
      { message: 3, part: 0 },
    ])
  })

  it('never places more than three markers, whatever markers the input already carries', () => {
    const marked = { anthropic: { cacheControl } }
    const messages: ModelMessage[] = [
      { ...system, providerOptions: marked },
      { role: 'user', content: [{ type: 'text', text: 'a', providerOptions: marked }], providerOptions: marked },
      { ...toolCall('t1'), providerOptions: marked },
      { ...toolResult('t1'), providerOptions: { anthropic: { cache_control: cacheControl } } },
      { role: 'user', content: 'b', providerOptions: marked },
      toolCall('t2'),
      toolResult('t2'),
    ]
    const result = applyAnthropicCacheBreakpoints(messages)
    expect(markers(result)).toEqual([{ message: 0 }, { message: 4 }, { message: 6, part: 0 }])
  })

  it('keeps other provider options while replacing markers', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'old', providerOptions: { anthropic: { cacheControl, citations: true } } }],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1000 } }, openai: { x: 1 } },
      },
    ]
    const result = applyAnthropicCacheBreakpoints(messages)
    expect(result[0].providerOptions?.anthropic).toEqual({ cacheControl })
    expect((result[0].content as Array<{ providerOptions?: unknown }>)[0].providerOptions).toEqual({
      anthropic: { citations: true },
    })
    expect(result[2].providerOptions).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1000 }, cacheControl },
      openai: { x: 1 },
    })
  })

  it('does not mutate the input messages', () => {
    const messages: ModelMessage[] = [system, user('task'), toolCall('t1'), toolResult('t1')]
    const snapshot = structuredClone(messages)
    applyAnthropicCacheBreakpoints(messages)
    expect(messages).toEqual(snapshot)
  })
})
