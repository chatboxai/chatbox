import { createDeepSeek } from '@ai-sdk/deepseek'
import type { InMemorySessionRepository } from '@chatbox/core/testing'
import type { Message } from '@shared/types'
import { generateText, stepCountIs } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { buildMemorySearchTool } from './memory-search'

const state = vi.hoisted(() => ({ sessions: undefined as InMemorySessionRepository | undefined }))

vi.mock('@/app/renderer-application', async () => {
  const { InMemorySessionRepository } = await import('@chatbox/core/testing')
  state.sessions = new InMemorySessionRepository()
  return { rendererApplication: { sessions: state.sessions } }
})

function message(id: string, role: Message['role'], text: string): Message {
  return { id, timestamp: 1, role, contentParts: [{ type: 'text', text }] }
}

describe('memory_search', () => {
  it('recalls an older selected topic while excluding the query, system prompts and other chats', async () => {
    if (!state.sessions) throw new Error('Missing session repository')
    await state.sessions.seedSession({
      id: 'current',
      name: 'Moonstone',
      type: 'chat',
      messages: [
        message('system', 'system', 'Moonstone system prompt'),
        message('later', 'assistant', 'The blue teapot is made of ceramic.'),
        message('question', 'user', 'Where did we leave the Moonstone?'),
      ],
      threads: [
        {
          id: 'old-topic',
          name: 'Earlier topic',
          createdAt: 1,
          messages: [message('old-answer', 'assistant', 'We left the Moonstone in the blue teapot.')],
        },
      ],
    })
    await state.sessions.seedSession({
      id: 'other',
      name: 'Another chat',
      type: 'chat',
      messages: [message('other-secret', 'user', 'Moonstone and the codeword is starlight.')],
    })

    const tool = buildMemorySearchTool('current', 'question')
    const call = { toolCallId: 'recall', messages: [], context: undefined }
    await expect(tool.execute?.({ query: ' moonstone ' }, call)).resolves.toEqual({
      matches: [{ messageId: 'old-answer', excerpt: 'We left the Moonstone in the blue teapot.' }],
    })
    await expect(tool.execute?.({ query: 'moonstone blue teapot' }, call)).resolves.toEqual({
      matches: [{ messageId: 'old-answer', excerpt: 'We left the Moonstone in the blue teapot.' }],
    })
    await expect(tool.execute?.({ query: 'moonstone ceramic' }, call)).resolves.toEqual({ matches: [] })
    await expect(tool.execute?.({ query: 'starlight' }, call)).resolves.toEqual({ matches: [] })
    await expect(tool.execute?.({ query: '  ' }, call)).resolves.toMatchObject({ error: expect.any(String) })
  })

  it('returns at most five bounded excerpts and propagates cancellation', async () => {
    if (!state.sessions) throw new Error('Missing session repository')
    await state.sessions.seedSession({
      id: 'long-chat',
      name: 'Long chat',
      type: 'chat',
      messages: Array.from({ length: 105 }, (_, index) =>
        message(`line-${index}`, 'user', index < 8 ? `${'a'.repeat(500)} needle ${'b'.repeat(500)}` : 'Ordinary turn')
      ),
    })

    const tool = buildMemorySearchTool('long-chat')
    const call = { toolCallId: 'recall', messages: [], context: undefined }
    const result = await tool.execute?.({ query: 'needle' }, call)
    expect(result?.matches).toHaveLength(5)
    for (const match of result.matches) {
      expect(match.excerpt).toContain('needle')
      expect(match.excerpt.length).toBeLessThanOrEqual(322)
    }

    const canceled = new Error('Canceled search')
    await expect(
      tool.execute?.({ query: 'needle' }, { ...call, abortSignal: AbortSignal.abort(canceled) })
    ).rejects.toBe(canceled)
  })

  it('sends the recalled excerpt only in the tool response to DeepSeek', async () => {
    if (!state.sessions) throw new Error('Missing session repository')
    const fact = 'We planted the jasmine behind the lighthouse.'
    const question = 'Where did we plant the jasmine?'
    await state.sessions.seedSession({
      id: 'wire-test',
      name: 'Garden chat',
      type: 'chat',
      messages: [message('fact', 'assistant', fact), message('question', 'user', question)],
    })
    const fetch = vi.fn<typeof globalThis.fetch>()
    fetch.mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'recall',
                  type: 'function',
                  function: { name: 'memory_search', arguments: '{"query":"jasmine"}' },
                },
              ],
            },
          },
        ],
      })
    )
    fetch.mockResolvedValueOnce(
      Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: fact } }] })
    )

    const result = await generateText({
      model: createDeepSeek({ apiKey: 'test-key', fetch }).chat('deepseek-v4-flash'),
      tools: { memory_search: buildMemorySearchTool('wire-test', 'question') },
      prompt: question,
      stopWhen: stepCountIs(2),
    })

    expect(result.text).toBe(fact)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(fetch.mock.calls[0][1]?.body)).not.toContain(fact)
    const secondRequest = JSON.parse(String(fetch.mock.calls[1][1]?.body))
    expect(secondRequest.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining(fact) })
  })
})
