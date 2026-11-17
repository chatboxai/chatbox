import type { ModelDependencies } from '@shared/types/adapters'
import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import type AbstractAISDKModel from '../../../models/abstract-ai-sdk'
import ChatboxAI from './chatboxai'
import Claude from './claude'
import CustomClaude from './custom-claude'
import OpenRouter from './openrouter'

const TOOL_ROUNDS = 3

type JsonObject = Record<string, unknown>
type CachedBlock = { message: number; block: number; type: string; cacheControl: unknown }

function sse(events: unknown[], named: boolean): Response {
  const text = events
    .map((event) =>
      named
        ? `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`
        : `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`
    )
    .join('')
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function anthropicResponse(round: number): Response {
  const usage = { input_tokens: 10, output_tokens: 2 }
  const start = {
    type: 'message_start',
    message: {
      id: `m${round}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [],
      stop_reason: null,
      usage,
    },
  }
  if (round > TOOL_ROUNDS) {
    return sse(
      [
        start,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ],
      true
    )
  }
  return sse(
    [
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need a file.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: `sig${round}` } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: `t${round}`, name: 'read', input: {} },
      },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ],
    true
  )
}

function openAIResponse(round: number): Response {
  const chunk = (delta: JsonObject, finishReason: string | null) => ({
    id: `c${round}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'anthropic/claude-test',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
  const body =
    round > TOOL_ROUNDS
      ? [chunk({ role: 'assistant', content: 'Done' }, null)]
      : [
          chunk(
            {
              role: 'assistant',
              tool_calls: [
                { index: 0, id: `t${round}`, type: 'function', function: { name: 'read', arguments: '{}' } },
              ],
            },
            null
          ),
        ]
  return sse(
    [
      ...body,
      {
        ...chunk({}, round > TOOL_ROUNDS ? 'stop' : 'tool_calls'),
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
      '[DONE]',
    ],
    false
  )
}

/** Records every request body and answers with a scripted tool loop. */
function createTransport(respond: (round: number) => Response) {
  const bodies: JsonObject[] = []
  const handle = (body: unknown) => {
    bodies.push(JSON.parse(String(body)))
    return Promise.resolve(respond(bodies.length))
  }
  return { bodies, handle }
}

function createDependencies(handle: (body: unknown) => Promise<Response>): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(async (options: { body?: unknown }) => handle(options.body)),
      fetchWithOptions: vi.fn(async (_url: string, init?: RequestInit) => handle(init?.body)),
    },
    storage: { saveImage: vi.fn(), getImage: vi.fn() },
    sentry: { captureException: vi.fn(), withScope: vi.fn() },
    getRemoteConfig: vi.fn(() => ({})),
    platformType: 'desktop',
  } as unknown as ModelDependencies
}

/** Anthropic Messages body: every content block carrying cache_control. */
function anthropicCachedBlocks(body: JsonObject): CachedBlock[] {
  const blocks: CachedBlock[] = []
  for (const [block, part] of ((body.system as JsonObject[] | undefined) ?? []).entries()) {
    if (part.cache_control) blocks.push({ message: -1, block, type: 'system', cacheControl: part.cache_control })
  }
  for (const [message, entry] of (body.messages as JsonObject[]).entries()) {
    for (const [block, part] of (entry.content as JsonObject[]).entries()) {
      if (part.cache_control) blocks.push({ message, block, type: String(part.type), cacheControl: part.cache_control })
    }
  }
  return blocks
}

function lastBlock(body: JsonObject): { message: number; block: number } {
  const messages = body.messages as JsonObject[]
  return { message: messages.length - 1, block: (messages.at(-1)?.content as unknown[]).length - 1 }
}

const tools: ToolSet = {
  read: {
    inputSchema: jsonSchema({ type: 'object', properties: {} }),
    execute: async () => 'file contents',
  },
}

const messages: ModelMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Earlier question' },
  { role: 'assistant', content: 'Earlier answer' },
  { role: 'user', content: 'Read the files.' },
]

async function runToolLoop(model: AbstractAISDKModel, viaChatStream: boolean) {
  if (viaChatStream) {
    for await (const _chunk of model.chatStream(messages, { tools, maxSteps: TOOL_ROUNDS + 1 })) {
    }
  } else {
    await model.chat(messages, { tools, maxSteps: TOOL_ROUNDS + 1 })
  }
}

function expectAnthropicTailBreakpoints(bodies: JsonObject[], cacheControl: unknown) {
  expect(bodies).toHaveLength(TOOL_ROUNDS + 1)
  let previousTail: { message: number; block: number } | undefined
  for (const body of bodies) {
    const cached = anthropicCachedBlocks(body)
    const tail = lastBlock(body)
    expect(cached.length).toBeLessThanOrEqual(3)
    expect(cached.every((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking')).toBe(true)
    expect(cached.every((block) => JSON.stringify(block.cacheControl) === JSON.stringify(cacheControl))).toBe(true)
    expect(cached[0]).toMatchObject({ message: -1, block: 0 })
    expect(cached.at(-1)).toMatchObject(tail)
    // The breakpoint the previous request wrote is still marked, so this request reads it.
    expect(cached.slice(1, -1).map(({ message, block }) => ({ message, block }))).toEqual([
      previousTail ?? { message: 0, block: 0 },
    ])
    previousTail = tail
  }
}

describe('Anthropic prompt-cache breakpoints across a tool loop', () => {
  it.each([true, false])('advances Chatbox AI breakpoints on every round (chatStream=%s)', async (viaChatStream) => {
    const transport = createTransport(anthropicResponse)
    const model = new ChatboxAI(
      {
        licenseKey: 'license',
        model: { modelId: 'claude-test', apiStyle: 'anthropic', capabilities: ['tool_use'] },
        language: 'en',
        dalleStyle: 'vivid',
      },
      { uuid: 'uuid' },
      createDependencies(transport.handle)
    )
    await runToolLoop(model, viaChatStream)
    expectAnthropicTailBreakpoints(transport.bodies, { type: 'ephemeral' })
  })

  it('re-marks the transcript after a step compacts it', async () => {
    const transport = createTransport(anthropicResponse)
    const model = new ChatboxAI(
      {
        licenseKey: 'license',
        model: { modelId: 'claude-test', apiStyle: 'anthropic', capabilities: ['tool_use'] },
        language: 'en',
        dalleStyle: 'vivid',
      },
      { uuid: 'uuid' },
      createDependencies(transport.handle)
    )
    for await (const _chunk of model.chatStream(messages, {
      tools,
      maxSteps: TOOL_ROUNDS + 1,
      prepareStep: ({ stepNumber, messages: transcript }) =>
        stepNumber === 2
          ? { messages: [transcript[0], { role: 'user', content: 'Summary of earlier work' }, ...transcript.slice(-2)] }
          : undefined,
    })) {
    }

    const compacted = transport.bodies[2]
    expect((compacted.messages as unknown[]).length).toBe(3)
    expect(anthropicCachedBlocks(compacted).map(({ message, block }) => ({ message, block }))).toEqual([
      { message: -1, block: 0 },
      { message: 0, block: 0 },
      lastBlock(compacted),
    ])
  })

  it('keeps the selected TTL on every Claude round', async () => {
    const transport = createTransport(anthropicResponse)
    const model = new Claude(
      {
        claudeApiKey: 'key',
        claudeApiHost: 'https://api.anthropic.com/v1',
        model: { modelId: 'claude-test', capabilities: ['tool_use'] },
        promptCacheTTL: '1h',
        customFetch: async (_url, init) => transport.handle(init?.body),
      },
      createDependencies(transport.handle)
    )
    await runToolLoop(model, true)
    expectAnthropicTailBreakpoints(transport.bodies, { type: 'ephemeral', ttl: '1h' })
  })

  it('advances custom Claude breakpoints on every round', async () => {
    const transport = createTransport(anthropicResponse)
    const model = new CustomClaude(
      {
        apiKey: 'key',
        apiHost: 'https://claude.example.com/v1',
        model: { modelId: 'claude-test', capabilities: ['tool_use'] },
      },
      createDependencies(transport.handle)
    )
    await runToolLoop(model, true)
    expectAnthropicTailBreakpoints(transport.bodies, { type: 'ephemeral' })
  })

  it('advances OpenRouter Claude breakpoints on every round and marks one tool result', async () => {
    const transport = createTransport(openAIResponse)
    const model = new OpenRouter(
      {
        apiKey: 'key',
        model: { modelId: 'anthropic/claude-test', capabilities: ['tool_use'] },
        customFetch: async (_url, init) => transport.handle(init?.body),
      },
      createDependencies(transport.handle)
    )
    await runToolLoop(model, true)

    expect(transport.bodies).toHaveLength(TOOL_ROUNDS + 1)
    for (const body of transport.bodies) {
      const requestMessages = body.messages as JsonObject[]
      const marked = requestMessages.flatMap((message, index) => {
        const content = Array.isArray(message.content) ? (message.content as JsonObject[]) : []
        return message.cache_control || content.some((part) => part.cache_control) ? [index] : []
      })
      expect(marked.length).toBeLessThanOrEqual(3)
      expect(marked[0]).toBe(0)
      expect(marked.at(-1)).toBe(requestMessages.length - 1)
    }
  })

  it('keeps the OpenRouter breakpoint on an assistant message that ends in reasoning', async () => {
    const transport = createTransport(() => openAIResponse(TOOL_ROUNDS + 1))
    const model = new OpenRouter(
      {
        apiKey: 'key',
        model: { modelId: 'anthropic/claude-test' },
        customFetch: async (_url, init) => transport.handle(init?.body),
      },
      createDependencies(transport.handle)
    )
    const reasoningDetails = [
      { type: 'reasoning.text', text: 'thinking', signature: 'sig', format: 'anthropic-claude-v1' },
    ]
    const transcript: ModelMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Answer briefly.' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'visible answer' },
          {
            type: 'reasoning',
            text: 'thinking',
            providerOptions: { openrouter: { reasoning_details: reasoningDetails } },
          },
        ],
      },
    ]
    for await (const _chunk of model.chatStream(transcript, {})) {
    }

    const assistant = (transport.bodies[0].messages as JsonObject[])[2]
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'visible answer',
      cache_control: { type: 'ephemeral' },
      reasoning_details: reasoningDetails,
    })
    expect(JSON.stringify(assistant.reasoning_details)).not.toContain('cache_control')
  })

  it('does not mark non-Anthropic Chatbox AI requests', async () => {
    const transport = createTransport(openAIResponse)
    const model = new ChatboxAI(
      {
        licenseKey: 'license',
        model: { modelId: 'gpt-test', apiStyle: 'openai', capabilities: ['tool_use'] },
        language: 'en',
        dalleStyle: 'vivid',
      },
      { uuid: 'uuid' },
      createDependencies(transport.handle)
    )
    await runToolLoop(model, true)
    expect(transport.bodies).toHaveLength(TOOL_ROUNDS + 1)
    expect(JSON.stringify(transport.bodies)).not.toContain('cache_control')
  })
})
