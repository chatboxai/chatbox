import type { Message, MessageContentToolCallPart } from '@shared/types'
import { modelMessageSchema } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { convertToModelMessages } from './model-message-converter'

// Tool-call fixtures below never reference images, so the resolver is never called.
const noImage = () => Promise.resolve(null)

function assistantWithToolResult(result: unknown): Message {
  return {
    id: 'a1',
    role: 'assistant',
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'call-1',
        toolName: 'mcp__repro__crash_transport',
        args: { reason: 'repro invalid prompt bug' },
        result,
      },
    ],
  }
}

describe('convertToModelMessages — tool result sanitization', () => {
  it('produces a schema-valid prompt when a tool result is a raw Error object', async () => {
    // Regression: when an MCP tool crashed, the raw Error leaked into history. On the next
    // send, the AI SDK rejected the prompt with AI_InvalidPromptError because an Error is not
    // a valid ModelMessage[] tool output.
    const messages = [assistantWithToolResult(new Error('transport crashed'))]

    const output = await convertToModelMessages(messages, noImage)

    // Every produced message must pass the exact schema the AI SDK validates against.
    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }

    const toolMsg = output.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    const part = (toolMsg?.content as Array<{ type: string; output: unknown }>)[0]
    expect(part.output).toEqual({ type: 'json', value: { error: 'transport crashed' } })
  })

  it('strips non-serializable values (circular refs) from tool results', async () => {
    const circular: Record<string, unknown> = { ok: true }
    circular.self = circular
    const messages = [assistantWithToolResult(circular)]

    const output = await convertToModelMessages(messages, noImage)

    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }
    // The whole prompt must JSON round-trip (this is what the SDK ultimately serializes).
    expect(() => JSON.stringify(output)).not.toThrow()
  })

  it('coerces nested Errors and BigInt instead of dropping/throwing', async () => {
    const messages = [assistantWithToolResult({ inner: new Error('boom'), count: 10n, ok: true })]

    const output = await convertToModelMessages(messages, noImage)

    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }
    const toolMsg = output.find((m) => m.role === 'tool')
    const part = (toolMsg?.content as Array<{ type: string; output: { value: unknown } }>)[0]
    expect(part.output).toEqual({
      type: 'json',
      value: { inner: { error: 'boom' }, count: '10', ok: true },
    })
  })

  it('passes plain JSON tool results through unchanged', async () => {
    const messages = [assistantWithToolResult({ content: [{ type: 'text', text: 'hello' }] })]

    const output = await convertToModelMessages(messages, noImage)

    const toolMsg = output.find((m) => m.role === 'tool')
    const part = (toolMsg?.content as Array<{ type: string; output: unknown }>)[0]
    expect(part.output).toEqual({ type: 'json', value: { content: [{ type: 'text', text: 'hello' }] } })
  })

  it('preserves Gemini thought signatures on assistant tool-call parts', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-1' } }
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:write_file',
            args: { path: 'demo.txt', content: 'hello' },
            providerMetadata,
            providerExecuted: true,
            result: { ok: true },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)
    const assistantMsg = output.find((m) => m.role === 'assistant')
    const toolCallPart = (assistantMsg?.content as Array<{ type: string; providerOptions?: unknown }>)[0]

    expect(toolCallPart.providerOptions).toEqual(providerMetadata)
    expect(toolCallPart).toMatchObject({ providerExecuted: true })
    expect(() => modelMessageSchema.parse(assistantMsg)).not.toThrow()
  })

  it('keeps parallel Gemini tool calls in one assistant turn with one matching tool-result turn', async () => {
    const firstProviderMetadata = { google: { thoughtSignature: 'signature-1' } }
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(1)', language: 'node' },
            providerMetadata: firstProviderMetadata,
            stepIndex: 0,
            result: { stdout: '1\n', stderr: '', exitCode: 0 },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-2',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(2)', language: 'node' },
            stepIndex: 0,
            result: { stdout: '2\n', stderr: '', exitCode: 0 },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)

    expect(output).toHaveLength(2)
    expect(output[0].role).toBe('assistant')
    expect(output[1].role).toBe('tool')

    const assistantParts = output[0].content as Array<{ type: string; providerOptions?: unknown }>
    expect(assistantParts).toHaveLength(2)
    expect(assistantParts[0].providerOptions).toEqual(firstProviderMetadata)
    expect(assistantParts[1].providerOptions).toBeUndefined()

    const toolParts = output[1].content as Array<{ type: string; toolCallId: string }>
    expect(toolParts.map((part) => part.toolCallId)).toEqual(['call-1', 'call-2'])
    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }
  })

  it('adds the documented Google validator bypass to a missing sequential function-call signature', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(1)', language: 'node' },
            result: { stdout: '1\n', stderr: '', exitCode: 0 },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      ensureGoogleFunctionCallSignatures: true,
    })

    const assistantParts = output[0].content as Array<{ type: string; providerOptions?: unknown }>
    expect(assistantParts[0].providerOptions).toEqual({
      google: { thoughtSignature: 'skip_thought_signature_validator' },
    })
    expect(() => modelMessageSchema.parse(output[0])).not.toThrow()
  })

  it('keeps later parallel calls unsigned when the first call has a signature', async () => {
    const firstProviderMetadata = { google: { thoughtSignature: 'signature-1' } }
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(1)', language: 'node' },
            providerMetadata: firstProviderMetadata,
            stepIndex: 0,
            result: { stdout: '1\n', stderr: '', exitCode: 0 },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-2',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(2)', language: 'node' },
            stepIndex: 0,
            result: { stdout: '2\n', stderr: '', exitCode: 0 },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      ensureGoogleFunctionCallSignatures: true,
    })

    const assistantParts = output[0].content as Array<{ type: string; providerOptions?: unknown }>
    expect(assistantParts[0].providerOptions).toEqual(firstProviderMetadata)
    expect(assistantParts[1].providerOptions).toBeUndefined()
  })

  it('keeps tool calls with the same step index in one assistant turn', async () => {
    const firstProviderMetadata = { google: { thoughtSignature: 'signature-1' } }
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(1)', language: 'node' },
            providerMetadata: firstProviderMetadata,
            stepIndex: 0,
            result: { stdout: '1\n', stderr: '', exitCode: 0 },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-2',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(2)', language: 'node' },
            stepIndex: 0,
            result: { stdout: '2\n', stderr: '', exitCode: 0 },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)

    expect(output.map((message) => message.role)).toEqual(['assistant', 'tool'])
    expect(output[0].content).toHaveLength(2)
    expect(output[1].content).toHaveLength(2)
  })

  it('keeps different step indices as serial history', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(1)', language: 'node' },
            stepIndex: 0,
            result: { stdout: '1\n', stderr: '', exitCode: 0 },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-2',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(2)', language: 'node' },
            stepIndex: 1,
            result: { stdout: '2\n', stderr: '', exitCode: 0 },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)

    expect(output.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant', 'tool'])
  })

  it('keeps ungrouped consecutive tool calls as serial history', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(1)', language: 'node' },
            result: { stdout: '1\n', stderr: '', exitCode: 0 },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-2',
            toolName: 'default_api:code_execution',
            args: { code: 'console.log(2)', language: 'node' },
            result: { stdout: '2\n', stderr: '', exitCode: 0 },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)

    expect(output.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant', 'tool'])
    expect((output[0].content as Array<{ toolCallId?: string }>)[0].toolCallId).toBe('call-1')
    expect((output[2].content as Array<{ toolCallId?: string }>)[0].toolCallId).toBe('call-2')
  })

  it('preserves provider metadata on tool results', async () => {
    const resultProviderMetadata = { openai: { itemId: 'result-item-1' } }
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'tool_search',
            args: { query: 'docs' },
            resultProviderMetadata,
            result: { ok: true },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)
    const toolMsg = output.find((m) => m.role === 'tool')
    const toolResultPart = (toolMsg?.content as Array<{ type: string; providerOptions?: unknown }>)[0]

    expect(toolResultPart.providerOptions).toEqual(resultProviderMetadata)
    expect(() => modelMessageSchema.parse(toolMsg)).not.toThrow()
  })

  it('coerces an unparseable string tool-call input into an object', async () => {
    // Regression: when a model emits malformed tool-call arguments (e.g. two concatenated JSON
    // objects), the raw string was stored in `args` and serialized verbatim as `tool_use.input`.
    // Strict Anthropic-compatible upstreams reject that with HTTP 422 ("Input should be a valid
    // dictionary"). The serialized input must always be a JSON object.
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'error',
            toolCallId: 'call-1',
            toolName: 'web_search',
            args: '{"query":"A"}{"query":"B"}',
            result: { error: 'JSON parsing failed', input: '{"query":"A"}{"query":"B"}', toolName: 'web_search' },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)
    const assistantMsg = output.find((m) => m.role === 'assistant')
    const toolCallPart = (assistantMsg?.content as Array<{ type: string; input: unknown }>)[0]

    expect(toolCallPart.type).toBe('tool-call')
    expect(toolCallPart.input).toEqual({})
    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }
  })

  it('parses a valid JSON-string tool-call input into an object', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'call-1',
            toolName: 'web_search',
            args: '{"query":"hello"}',
            result: { ok: true },
          },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage)
    const assistantMsg = output.find((m) => m.role === 'assistant')
    const toolCallPart = (assistantMsg?.content as Array<{ type: string; input: unknown }>)[0]

    expect(toolCallPart.input).toEqual({ query: 'hello' })
  })

  it('preserves reasoning only when requested by the provider path', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          { type: 'reasoning', text: 'thinking about the answer' },
          { type: 'text', text: 'final answer' },
        ],
      },
    ]

    const defaultOutput = await convertToModelMessages(messages, noImage)
    const defaultAssistant = defaultOutput.find((m) => m.role === 'assistant')
    expect(defaultAssistant?.content).toEqual([{ type: 'text', text: 'final answer' }])

    const preservedOutput = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: true,
    })
    const preservedAssistant = preservedOutput.find((m) => m.role === 'assistant')
    expect(preservedAssistant?.content).toEqual([
      { type: 'reasoning', text: 'thinking about the answer' },
      { type: 'text', text: 'final answer' },
    ])
    expect(() => modelMessageSchema.parse(preservedAssistant)).not.toThrow()
  })
})

describe('convertToModelMessages — Anthropic thinking replay', () => {
  const signedContinuationParts = (): Message['contentParts'] => [
    {
      type: 'reasoning',
      text: '',
      providerMetadata: { anthropic: { signature: 'signature-a' } },
      protocolOnly: true,
    },
    {
      type: 'reasoning',
      text: 'Let me look that up.',
      providerMetadata: { anthropic: { signature: 'signature-b' } },
    },
    {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'tool-1',
      toolName: 'lookup',
      args: {},
      result: { value: 'found' },
    },
  ]

  it('replays signatures and redacted thinking in their original order', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'reasoning',
            text: '',
            providerMetadata: { anthropic: { redactedData: 'encrypted-thinking' } },
            protocolOnly: true,
          },
          ...signedContinuationParts(),
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    const assistant = output.find((message) => message.role === 'assistant')

    expect(assistant?.content).toMatchObject([
      { type: 'reasoning', text: '', providerOptions: { anthropic: { redactedData: 'encrypted-thinking' } } },
      { type: 'reasoning', text: '', providerOptions: { anthropic: { signature: 'signature-a' } } },
      {
        type: 'reasoning',
        text: 'Let me look that up.',
        providerOptions: { anthropic: { signature: 'signature-b' } },
      },
      { type: 'tool-call', toolCallId: 'tool-1', toolName: 'lookup' },
    ])
    expect(() => modelMessageSchema.parse(assistant)).not.toThrow()
  })

  it('never emits empty or protocol-only text parts', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          { type: 'text', text: '' },
          { type: 'text', text: '', protocolOnly: true },
          { type: 'text', text: 'visible answer' },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    const assistant = output.find((message) => message.role === 'assistant')

    expect(assistant?.content).toEqual([{ type: 'text', text: 'visible answer' }])
  })

  it('only replays whitelisted provider metadata', async () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          {
            type: 'reasoning',
            text: 'thought',
            providerMetadata: {
              anthropic: { signature: 'signature-a', cacheControl: { type: 'ephemeral' } },
              openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' },
            },
          },
          { type: 'reasoning', text: '', providerMetadata: { openai: { itemId: 'rs_2' } } },
        ],
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    const assistant = output.find((message) => message.role === 'assistant')

    expect(assistant?.content).toEqual([
      {
        type: 'reasoning',
        text: 'thought',
        providerOptions: { anthropic: { signature: 'signature-a' } },
      },
    ])
  })

  it('replays signed thinking from earlier turns when asked for all-turns signed replay', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'First question' }] },
      { id: 'a1', role: 'assistant', contentParts: signedContinuationParts() },
      { id: 'u2', role: 'user', contentParts: [{ type: 'text', text: 'Second question' }] },
      { id: 'a2', role: 'assistant', contentParts: signedContinuationParts() },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    const assistants = output.filter((message) => message.role === 'assistant')

    expect(assistants[0].content).toMatchObject([
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-a' } } },
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-b' } } },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
    expect(assistants[1].content).toMatchObject([
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-a' } } },
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-b' } } },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
  })

  it('keeps Anthropic signatures when the current model id differs from the minting model', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] },
      {
        id: 'a1',
        role: 'assistant',
        aiProvider: 'claude',
        model: 'Claude API (claude-sonnet-4-5)',
        modelId: 'claude-sonnet-4-5',
        contentParts: signedContinuationParts(),
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    expect(output.find((message) => message.role === 'assistant')?.content).toMatchObject([
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-a' } } },
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-b' } } },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
  })

  it('omits unsigned reasoning from the signed replay channel', async () => {
    // Reasoning saved by app versions predating metadata capture has text but no
    // signature; replaying it unsigned could not pass upstream validation.
    const messages: Message[] = [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [
          { type: 'reasoning', text: 'Legacy unsigned thought' },
          {
            type: 'reasoning',
            text: 'Signed thought',
            providerMetadata: { anthropic: { signature: 'signature-a' } },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
        ],
      },
    ]

    const signedOnly = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    expect(signedOnly.find((message) => message.role === 'assistant')?.content).toMatchObject([
      { type: 'reasoning', text: 'Signed thought', providerOptions: { anthropic: { signature: 'signature-a' } } },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])

    // The DeepSeek all-turns text channel still carries unsigned reasoning.
    const allTurns = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
    })
    const allTurnsAssistant = allTurns.find((message) => message.role === 'assistant')
    expect(allTurnsAssistant?.content).toMatchObject([
      { type: 'reasoning', text: 'Legacy unsigned thought' },
      { type: 'reasoning', text: 'Signed thought' },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
  })

  it('keeps signed replay intact when a synthetic trailing user message follows the paused turn', async () => {
    // Stale resumes append a trailing time-gap reminder after the paused
    // assistant turn. All-turns replay is boundary-free, so the reminder must
    // not affect which thinking blocks go back on the wire.
    const messages: Message[] = [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Look this up.' }] },
      { id: 'a1', role: 'assistant', contentParts: signedContinuationParts() },
      {
        id: 'time-gap-reminder-1',
        role: 'user',
        contentParts: [{ type: 'text', text: '<system-reminder>Current date and time: ...</system-reminder>' }],
      },
    ]

    const output = await convertToModelMessages(messages, noImage, {
      modelSupportVision: true,
      preserveReasoning: 'all-turns',
      signedReasoningOnly: true,
    })
    expect(output.find((message) => message.role === 'assistant')?.content).toMatchObject([
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-a' } } },
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-b' } } },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
  })
})

describe('convertToModelMessages — view_image tool results', () => {
  const viewImageMessage = (result: unknown, fields: Partial<MessageContentToolCallPart> = {}): Message => ({
    id: 'a1',
    role: 'assistant',
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'call-1',
        toolName: 'view_image',
        args: { file_path: 'chart.png' },
        result,
        ...fields,
      },
    ],
  })

  const viewImageResult = {
    file_path: 'chart.png',
    image_storage_key: 'picture:view-image:s1:uuid',
    media_type: 'image/png',
  }

  const resolveStored = (storageKey: string) =>
    Promise.resolve(storageKey === 'picture:view-image:s1:uuid' ? 'data:image/png;base64,SU1BR0U=' : null)

  it('re-inlines the stored image when the model supports tool-result images', async () => {
    const output = await convertToModelMessages([viewImageMessage(viewImageResult)], resolveStored, {
      modelSupportVision: true,
      supportToolResultImages: true,
    })

    const toolMsg = output.find((m) => m.role === 'tool')
    const part = (toolMsg?.content as Array<{ type: string; output: unknown }>)[0]
    expect(part.output).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Viewed image: chart.png' },
        { type: 'image-data', data: 'SU1BR0U=', mediaType: 'image/png' },
      ],
    })
    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }
  })

  it('re-inlines a first-class image reference from any image-producing tool', async () => {
    const output = await convertToModelMessages(
      [
        viewImageMessage(
          { file_path: 'chart.png', media_type: 'image/png' },
          {
            toolName: 'render_chart',
            resultImageStorageKey: 'picture:view-image:s1:uuid',
            resultImageMediaType: 'image/png',
          }
        ),
      ],
      resolveStored,
      { modelSupportVision: true, supportToolResultImages: true }
    )

    const toolMsg = output.find((message) => message.role === 'tool')
    const part = (toolMsg?.content as Array<{ output: { type: string } }>)[0]
    expect(part.output.type).toBe('content')
  })

  it('re-inlines an image even when auxiliary tool result data was offloaded', async () => {
    const output = await convertToModelMessages(
      [
        viewImageMessage('truncated preview', {
          toolName: 'render_chart',
          resultStorageKey: 'blob:large-result',
          resultImageStorageKey: 'picture:view-image:s1:uuid',
          resultImageMediaType: 'image/png',
        }),
      ],
      resolveStored,
      { modelSupportVision: true, supportToolResultImages: true }
    )

    const toolMsg = output.find((message) => message.role === 'tool')
    const part = (toolMsg?.content as Array<{ output: { type: string; value: Array<{ type: string }> } }>)[0]
    expect(part.output.type).toBe('content')
    expect(part.output.value.some((value) => value.type === 'image-data')).toBe(true)
  })

  it('delivers the image as a follow-up user message when tool-result images are unsupported', async () => {
    const output = await convertToModelMessages([viewImageMessage(viewImageResult)], resolveStored, {
      modelSupportVision: true,
      supportToolResultImages: false,
    })

    // The tool output is a plain text notice — never base64-as-text.
    const toolIndex = output.findIndex((m) => m.role === 'tool')
    const part = (output[toolIndex]?.content as Array<{ type: string; output: { type: string; value: unknown } }>)[0]
    expect(part.output.type).toBe('text')
    expect(String(part.output.value)).toContain('attached in the user message')
    expect(JSON.stringify(part.output)).not.toContain('SU1BR0U=')

    // The image itself follows as a real user-message image part (same as a user upload).
    const followUp = output[toolIndex + 1]
    expect(followUp).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[Image from view_image tool: chart.png]' },
        { type: 'image', image: 'SU1BR0U=', mediaType: 'image/png' },
      ],
    })
    for (const msg of output) {
      expect(() => modelMessageSchema.parse(msg)).not.toThrow()
    }
  })

  it('keeps compact json when view_image re-inlining is not explicitly enabled', async () => {
    const resolver = vi.fn(resolveStored)
    const output = await convertToModelMessages([viewImageMessage(viewImageResult)], resolver, {
      modelSupportVision: true,
    })

    const toolIndex = output.findIndex((message) => message.role === 'tool')
    const part = (output[toolIndex]?.content as Array<{ output: { type: string; value: unknown } }>)[0]
    expect(part.output).toEqual({ type: 'json', value: viewImageResult })
    expect(output[toolIndex + 1]).toBeUndefined()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('falls back to json output when the model has no vision', async () => {
    const output = await convertToModelMessages([viewImageMessage(viewImageResult)], resolveStored, {
      modelSupportVision: false,
      supportToolResultImages: true,
    })
    const toolMsg = output.find((m) => m.role === 'tool')
    const part = (toolMsg?.content as Array<{ type: string; output: { type: string } }>)[0]
    expect(part.output.type).toBe('json')
  })

  it('falls back to json output when the stored blob is gone', async () => {
    const output = await convertToModelMessages(
      [viewImageMessage({ ...viewImageResult, image_storage_key: 'picture:missing' })],
      resolveStored,
      { modelSupportVision: true, supportToolResultImages: true }
    )
    const toolMsg = output.find((m) => m.role === 'tool')
    const part = (toolMsg?.content as Array<{ type: string; output: { type: string } }>)[0]
    expect(part.output.type).toBe('json')
  })

  it('only inlines the most recent image occurrences when tool call IDs repeat', async () => {
    const resolver = vi.fn((storageKey: string) => Promise.resolve(`data:image/webp;base64,${storageKey}`))
    const messages = ['oldest', 'middle', 'latest'].map(
      (name): Message =>
        viewImageMessage(
          { file_path: `${name}.webp`, media_type: 'image/webp' },
          {
            toolCallId: 'call-0',
            toolName: 'render_chart',
            resultImageStorageKey: `picture:${name}`,
            resultImageMediaType: 'image/webp',
          }
        )
    )

    const output = await convertToModelMessages(messages, resolver, {
      modelSupportVision: true,
      supportToolResultImages: false,
      maxInlineToolResultImages: 2,
    })

    expect(resolver.mock.calls.map(([storageKey]) => storageKey)).toEqual(['picture:middle', 'picture:latest'])
    const imageParts = output.flatMap((message) =>
      message.role === 'user' && Array.isArray(message.content)
        ? message.content.filter((part) => part.type === 'image')
        : []
    )
    expect(imageParts).toHaveLength(2)
    const firstTool = output.find((message) => message.role === 'tool')
    expect((firstTool?.content as Array<{ output: { type: string } }>)[0].output.type).toBe('json')
  })
})
