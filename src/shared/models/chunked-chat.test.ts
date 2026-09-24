import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHUNK_TOKEN_THRESHOLD,
  chunkedChatStream,
  estimateRequestTokens,
  toOpenAIMessages,
} from './chunked-chat'

const URL = 'https://api.example.com/chat'

function makeResponse(status: number, body: unknown = ''): Response {
  if (typeof body === 'string') return new Response(body, { status })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function okWithContent(content: string) {
  return makeResponse(200, {
    choices: [{ message: { content, role: 'assistant' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  })
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of gen) out.push(x)
  return out
}

function userMsg(text: string) {
  return { role: 'user' as const, content: text }
}

describe('estimateRequestTokens', () => {
  it('估算空消息列表', () => {
    expect(estimateRequestTokens({ messages: [], model: 'm' })).toBeGreaterThanOrEqual(0)
  })

  it('估算 system + messages', () => {
    const t = estimateRequestTokens({
      messages: [userMsg('hello world')],
      system: 'you are a helpful assistant',
      model: 'm',
    })
    expect(t).toBeGreaterThan(5)
  })
})

describe('toOpenAIMessages', () => {
  it('system 参数置为 messages[0]', () => {
    const out = toOpenAIMessages([userMsg('hi')], 'be helpful')
    expect(out[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(out[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('tool 消息降级为 user 文本', () => {
    const out = toOpenAIMessages([
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: 'tc1',
            toolName: 'search',
            output: { type: 'text' as const, value: 'tool output' },
          },
        ],
      },
    ])
    expect(out[0]).toEqual({ role: 'user', content: '[工具结果] tool output' })
  })

  it('非文本 part 被跳过', () => {
    const out = toOpenAIMessages([
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'look' },
          { type: 'image' as const, image: new Uint8Array([1, 2, 3]) },
        ],
      },
    ])
    expect(out).toEqual([{ role: 'user', content: 'look' }])
  })
})

describe('chunkedChatStream', () => {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  let fetchMock: any

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('单次完整 POST + 标准 OpenAI payload + 无自定义头', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okWithContent('hello back')))
    const parts = await collect(
      chunkedChatStream({
        endpoint: URL,
        apiKey: 'k',
        model: 'gpt-4',
        messages: [userMsg('hi')],
        system: 'be helpful',
        temperature: 0.5,
        maxOutputTokens: 128,
        signal: new AbortController().signal,
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(URL)
    expect(init.method).toBe('POST')

    // 标准头，且不带任何 X-* 自定义协议头
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBe('Bearer k')
    for (const key of Object.keys(headers)) {
      expect(key.startsWith('X-')).toBe(false)
    }

    // 标准 OpenAI 请求体
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-4')
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(128)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(body.system).toBeUndefined()
    expect(body.maxOutputTokens).toBeUndefined()

    // 流事件四件套
    const types = parts.map((p) => (p as { type: string }).type)
    expect(types).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
    const textDelta = parts[1] as { type: 'text-delta'; text: string }
    expect(textDelta.text).toBe('hello back')
    const finish = parts[3] as { type: 'finish'; finishReason: string; totalUsage: { totalTokens: number } }
    expect(finish.finishReason).toBe('stop')
    expect(finish.totalUsage.totalTokens).toBe(7)
  })

  it('超大消息仍然单次 POST（不分帧）', async () => {
    const big = 'A'.repeat(200_000)
    const messages = [userMsg(big), userMsg(big), userMsg(big)]
    fetchMock.mockImplementation(() => Promise.resolve(okWithContent('ok')))
    await collect(
      chunkedChatStream({
        endpoint: URL,
        apiKey: 'k',
        model: 'gpt-4',
        messages,
        signal: new AbortController().signal,
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toHaveLength(3)
    expect(body.messages[0].content).toBe(big)
  })

  it('HTTP 4xx → 抛错（不重试，POST 避免重复计费）', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(makeResponse(400, 'invalid request')))
    await expect(
      collect(
        chunkedChatStream({
          endpoint: URL,
          apiKey: 'k',
          model: 'm',
          messages: [userMsg('hi')],
          signal: new AbortController().signal,
        })
      )
    ).rejects.toThrow(/HTTP 400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('响应非 JSON → 抛错', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(makeResponse(200, 'not json {{{')))
    await expect(
      collect(
        chunkedChatStream({
          endpoint: URL,
          apiKey: 'k',
          model: 'm',
          messages: [userMsg('hi')],
          signal: new AbortController().signal,
        })
      )
    ).rejects.toThrow(/JSON/)
  })

  it('CHUNK_TOKEN_THRESHOLD 默认 80_000', () => {
    expect(CHUNK_TOKEN_THRESHOLD).toBe(80_000)
  })
})
