import { buildCompactionHandoff } from '@shared/context/compaction-handoff'
import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  collectToolCallIds,
  estimateModelMessagesTokens,
  estimateModelMessageTokens,
  findKeptContentPartStartIndex,
  findKeptModelMessageStartIndex,
  resolveKeptModelMessageStartIndex,
  retainTokensForThreshold,
  rewriteModelMessagesWithSummary,
} from './mid-run-compaction'

function user(text: string): ModelMessage {
  return { role: 'user', content: text }
}

function assistantCall(id: string): ModelMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: id, toolName: 'search', input: { q: id } }],
  }
}

function toolResult(id: string, size: number): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: 'search',
        output: { type: 'text', value: 'r'.repeat(size) },
      },
    ],
  }
}

describe('mid-run compaction helpers', () => {
  it('sizes the retained tail as a fraction of the compaction threshold', () => {
    expect(retainTokensForThreshold(100_000)).toBe(35_000)
  })

  it('keeps the newest tool round and never starts the tail on a tool message', () => {
    const messages = [
      user('task'),
      assistantCall('t1'),
      toolResult('t1', 40_000),
      assistantCall('t2'),
      toolResult('t2', 40_000),
      assistantCall('t3'),
      toolResult('t3', 8_000),
    ]
    const keep = Math.floor(estimateModelMessagesTokens([assistantCall('t3'), toolResult('t3', 8_000)]) * 1.1)
    const start = findKeptModelMessageStartIndex(messages, keep)

    expect(messages[start].role).toBe('assistant')
    expect(collectToolCallIds(messages.slice(start))).toEqual(new Set(['t3']))
  })

  it('rewrites the prefix to a summary while preserving a leading system message', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      user('task'),
      assistantCall('t1'),
      toolResult('t1', 100),
      assistantCall('t2'),
      toolResult('t2', 100),
    ]
    const rewritten = rewriteModelMessagesWithSummary(messages, 'Earlier work done.', 4)
    expect(rewritten[0]).toEqual({ role: 'system', content: 'You are helpful.' })
    expect(rewritten[1]).toEqual({
      role: 'user',
      content: buildCompactionHandoff('Earlier work done.', 'resume').text,
    })
    expect(rewritten.slice(2)).toEqual(messages.slice(4))
  })

  it('leads a retained user turn with the summary instead of adding a second user turn', () => {
    const messages: ModelMessage[] = [user('task'), assistantCall('t1'), toolResult('t1', 100), user('steer')]
    const rewritten = rewriteModelMessagesWithSummary(messages, 'Earlier work done.', 3, 'zh-Hans')
    expect(rewritten).toEqual([
      {
        role: 'user',
        content: `${buildCompactionHandoff('Earlier work done.', 'reference', 'zh-Hans').text}\n\nsteer`,
      },
    ])
  })

  it('splits generating content parts at the first kept tool call', () => {
    const parts: MessageContentParts = [
      { type: 'text', text: 'working' },
      { type: 'tool-call', state: 'result', toolCallId: 't1', toolName: 'search', args: {}, result: 'a' },
      { type: 'tool-call', state: 'result', toolCallId: 't2', toolName: 'search', args: {}, result: 'b' },
    ]
    expect(findKeptContentPartStartIndex(parts, new Set(['t2']))).toBe(2)
    expect(findKeptContentPartStartIndex(parts, new Set(['missing']))).toBe(-1)
    expect(findKeptContentPartStartIndex(parts, new Set())).toBe(-1)
  })

  it('does not treat inline image bytes as prompt tokens', () => {
    const withImage: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'see this' },
        { type: 'image', image: 'a'.repeat(500_000), mediaType: 'image/png' },
      ],
    }
    expect(estimateModelMessageTokens(withImage)).toBeLessThan(200)
    expect(estimateModelMessagesTokens([withImage, user('next')])).toBeLessThan(400)
  })

  it('keeps a view_image follow-up with the tool round that produced it', () => {
    const imageFollowUp: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: '[Image from view_image tool: shot.png]' },
        { type: 'image', image: 'abc', mediaType: 'image/png' },
      ],
    }
    const messages = [
      user('task'),
      assistantCall('t1'),
      toolResult('t1', 40_000),
      assistantCall('t2'),
      toolResult('t2', 8_000),
      imageFollowUp,
    ]
    const keep = Math.floor(estimateModelMessagesTokens([imageFollowUp]) * 1.1)
    const start = findKeptModelMessageStartIndex(messages, keep)

    expect(messages[start].role).toBe('assistant')
    expect(collectToolCallIds(messages.slice(start))).toEqual(new Set(['t2']))
  })

  it('resolves a cached keep identity after an earlier image follow-up is dropped', () => {
    const t2 = assistantCall('t2')
    const withImages: ModelMessage[] = [
      user('task'),
      assistantCall('t1'),
      toolResult('t1', 100),
      {
        role: 'user',
        content: [
          { type: 'text', text: '[Image from view_image tool: a.png]' },
          { type: 'image', image: 'a', mediaType: 'image/png' },
        ],
      },
      t2,
      toolResult('t2', 100),
    ]
    const withoutOlderImage: ModelMessage[] = [
      user('task'),
      assistantCall('t1'),
      toolResult('t1', 100),
      t2,
      toolResult('t2', 100),
    ]

    expect(resolveKeptModelMessageStartIndex(withImages, 't2')).toBe(4)
    expect(resolveKeptModelMessageStartIndex(withoutOlderImage, 't2')).toBe(3)
    expect(withoutOlderImage[3]).toBe(t2)
  })
})
