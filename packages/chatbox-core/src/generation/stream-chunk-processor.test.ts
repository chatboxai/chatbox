import type { ModelStreamPart } from '@shared/models/types'
import type { MessageReasoningPart, MessageToolCallPart } from '@shared/types/session'
import type { ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { generationStreamFixture } from '../testing/generation-stream'
import {
  createInitialState,
  finalizeReasoningDuration,
  finalizeToolCallDuration,
  processStreamChunk,
  type StreamProcessorCallbacks,
  TOOL_RESULT_PREVIEW_LENGTH,
  TOOL_RESULT_SIZE_LIMIT,
} from './stream-chunk-processor'

const callbacks: StreamProcessorCallbacks = {
  onFileReceived: vi.fn(async () => 'mock-storage-key'),
}

function chunk(type: string, data: Record<string, unknown> = {}): ModelStreamPart<ToolSet> {
  return { type, ...data } as ModelStreamPart<ToolSet>
}

describe('createInitialState', () => {
  it('creates empty state', () => {
    const state = createInitialState()
    expect(state.contentParts).toEqual([])
    expect(state.currentTextPart).toBeUndefined()
    expect(state.currentReasoningPart).toBeUndefined()
    expect(state.usage).toBeUndefined()
    expect(state.finishReason).toBeUndefined()
  })

  it('creates state with initial parts', () => {
    const parts = [{ type: 'text' as const, text: 'hello' }]
    const state = createInitialState(parts)
    expect(state.contentParts).toHaveLength(1)
    expect(state.contentParts[0]).toEqual({ type: 'text', text: 'hello' })
    expect(state.stepIndex).toBe(0)
  })
})

describe('finalizeReasoningDuration', () => {
  it('sets duration when startTime exists and duration is missing', () => {
    const part: MessageReasoningPart = {
      type: 'reasoning',
      text: 'thinking',
      startTime: Date.now() - 1000,
    }
    finalizeReasoningDuration(part)
    expect(part.duration).toBeGreaterThan(0)
  })

  it('does nothing when part is undefined', () => {
    expect(() => finalizeReasoningDuration(undefined)).not.toThrow()
  })

  it('does nothing when duration already set', () => {
    const part = { type: 'reasoning' as const, text: 'thinking', startTime: Date.now() - 1000, duration: 500 }
    finalizeReasoningDuration(part)
    expect(part.duration).toBe(500)
  })
})

describe('finalizeToolCallDuration', () => {
  it('sets duration when startTime exists and duration is missing', () => {
    const part: MessageToolCallPart = {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'tc1',
      toolName: 'search',
      args: {},
      startTime: Date.now() - 1000,
    }
    finalizeToolCallDuration(part)
    expect(part.duration).toBeGreaterThan(0)
  })

  it('does nothing when part is undefined', () => {
    expect(() => finalizeToolCallDuration(undefined)).not.toThrow()
  })

  it('does nothing when duration already set', () => {
    const part: MessageToolCallPart = {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'tc1',
      toolName: 'search',
      args: {},
      startTime: Date.now() - 1000,
      duration: 500,
    }
    finalizeToolCallDuration(part)
    expect(part.duration).toBe(500)
  })
})

describe('processStreamChunk', () => {
  it('replays the reusable cross-host generation fixture', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    try {
      let state = createInitialState()
      for (const streamChunk of generationStreamFixture.chunks) {
        const result = await processStreamChunk(streamChunk, state, callbacks)
        state = result.state
      }

      const portableParts = state.contentParts.map((part) => {
        if (part.type !== 'tool-call') return part
        const { duration: _duration, startTime: _startTime, ...portablePart } = part
        return portablePart
      })

      expect(portableParts).toEqual(generationStreamFixture.expectedContentParts)
      expect(state.usage).toEqual(generationStreamFixture.expectedUsage)
      expect(state.finishReason).toBe(generationStreamFixture.expectedFinishReason)
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles text-delta by appending to content parts', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(chunk('text-delta', { text: 'Hello' }), state, callbacks)
    expect(result.skipUpdate).toBe(false)
    expect(result.state.contentParts).toHaveLength(1)
    expect(result.state.contentParts[0]).toEqual({ type: 'text', text: 'Hello' })
  })

  it('handles consecutive text-delta by concatenating', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(chunk('text-delta', { text: 'Hello' }), state, callbacks)
    const r2 = await processStreamChunk(chunk('text-delta', { text: ' world' }), r1.state, callbacks)
    expect(r2.state.contentParts).toHaveLength(1)
    expect(r2.state.contentParts[0]).toEqual({ type: 'text', text: 'Hello world' })
  })

  it('handles reasoning-delta', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(chunk('reasoning-delta', { text: 'Thinking...' }), state, callbacks)
    expect(result.state.contentParts).toHaveLength(1)
    expect(result.state.contentParts[0]).toMatchObject({ type: 'reasoning', text: 'Thinking...' })
    expect(result.state.currentReasoningPart).toBeDefined()
  })

  it('ignores empty reasoning-delta', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(chunk('reasoning-delta', { text: '   ' }), state, callbacks)
    expect(result.state.contentParts).toHaveLength(0)
  })

  it('persists ordered signed Anthropic thinking blocks and marks empty ones protocol-only', async () => {
    const chunks = [
      chunk('reasoning-start', { id: 'reasoning-0' }),
      chunk('reasoning-delta', {
        id: 'reasoning-0',
        text: '',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
      }),
      chunk('reasoning-end', { id: 'reasoning-0' }),
      chunk('reasoning-start', { id: 'reasoning-1' }),
      chunk('reasoning-delta', { id: 'reasoning-1', text: 'Let me look that up.' }),
      chunk('reasoning-delta', {
        id: 'reasoning-1',
        text: '',
        providerMetadata: { anthropic: { signature: 'signature-b' } },
      }),
      chunk('reasoning-end', { id: 'reasoning-1' }),
      chunk('tool-call', { toolCallId: 'tool-1', toolName: 'lookup', input: {} }),
    ]

    let state = createInitialState()
    for (const streamChunk of chunks) {
      state = (await processStreamChunk(streamChunk, state, callbacks)).state
    }

    expect(state.contentParts).toMatchObject([
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
      { type: 'tool-call', toolCallId: 'tool-1', toolName: 'lookup' },
    ])
    expect((state.contentParts[1] as MessageReasoningPart).protocolOnly).toBeUndefined()
  })

  it('persists Anthropic redacted thinking metadata emitted at block start', async () => {
    const started = await processStreamChunk(
      chunk('reasoning-start', {
        id: 'reasoning-0',
        providerMetadata: { anthropic: { redactedData: 'encrypted-thinking' } },
      }),
      createInitialState(),
      callbacks
    )
    const ended = await processStreamChunk(chunk('reasoning-end', { id: 'reasoning-0' }), started.state, callbacks)

    expect(ended.state.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { redactedData: 'encrypted-thinking' } },
        protocolOnly: true,
      },
    ])
  })

  it('does not persist non-whitelisted provider metadata or create parts for it', async () => {
    const chunks = [
      chunk('reasoning-start', {
        id: 'reasoning-0',
        providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'encrypted' } },
      }),
      chunk('reasoning-delta', {
        id: 'reasoning-0',
        text: '',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      }),
      chunk('reasoning-end', { id: 'reasoning-0', providerMetadata: { openai: { itemId: 'rs_1' } } }),
      chunk('reasoning-delta', {
        id: 'reasoning-1',
        text: 'visible thought',
        providerMetadata: { openai: { itemId: 'rs_2' } },
      }),
      chunk('reasoning-end', { id: 'reasoning-1' }),
    ]

    let state = createInitialState()
    for (const streamChunk of chunks) {
      state = (await processStreamChunk(streamChunk, state, callbacks)).state
    }

    expect(state.contentParts).toHaveLength(1)
    expect(state.contentParts[0]).toMatchObject({ type: 'reasoning', text: 'visible thought' })
    expect((state.contentParts[0] as MessageReasoningPart).providerMetadata).toBeUndefined()
  })

  it('preserves whitespace-only deltas inside a signed reasoning block verbatim', async () => {
    const chunks = [
      chunk('reasoning-start', { id: 'reasoning-0' }),
      chunk('reasoning-delta', { id: 'reasoning-0', text: '\n ' }),
      chunk('reasoning-delta', { id: 'reasoning-0', text: 'first thought' }),
      chunk('reasoning-delta', { id: 'reasoning-0', text: '\n\n' }),
      chunk('reasoning-delta', { id: 'reasoning-0', text: 'second thought' }),
      chunk('reasoning-delta', {
        id: 'reasoning-0',
        text: '',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
      }),
      chunk('reasoning-end', { id: 'reasoning-0' }),
    ]

    let state = createInitialState()
    for (const streamChunk of chunks) {
      state = (await processStreamChunk(streamChunk, state, callbacks)).state
    }

    expect(state.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: '\n first thought\n\nsecond thought',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
      },
    ])
  })

  it('prepends buffered whitespace when only the signature materializes the block', async () => {
    const chunks = [
      chunk('reasoning-start', { id: 'reasoning-0' }),
      chunk('reasoning-delta', { id: 'reasoning-0', text: '\n' }),
      chunk('reasoning-delta', {
        id: 'reasoning-0',
        text: '',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
      }),
      chunk('reasoning-end', { id: 'reasoning-0' }),
    ]

    let state = createInitialState()
    for (const streamChunk of chunks) {
      state = (await processStreamChunk(streamChunk, state, callbacks)).state
    }

    expect(state.contentParts).toMatchObject([
      {
        type: 'reasoning',
        text: '\n',
        providerMetadata: { anthropic: { signature: 'signature-a' } },
        protocolOnly: true,
      },
    ])
  })

  it('discards buffered whitespace from blocks that never materialize', async () => {
    const chunks = [
      chunk('reasoning-delta', { id: 'reasoning-0', text: '   ' }),
      chunk('reasoning-end', { id: 'reasoning-0' }),
      chunk('text-delta', { id: 'text-0', text: 'answer' }),
      chunk('reasoning-start', { id: 'reasoning-1' }),
      chunk('reasoning-delta', { id: 'reasoning-1', text: 'real thought' }),
      chunk('reasoning-end', { id: 'reasoning-1' }),
    ]

    let state = createInitialState()
    for (const streamChunk of chunks) {
      state = (await processStreamChunk(streamChunk, state, callbacks)).state
    }

    expect(state.contentParts).toMatchObject([
      { type: 'text', text: 'answer' },
      { type: 'reasoning', text: 'real thought' },
    ])
  })

  it('does not split a streaming text part on spurious empty reasoning blocks', async () => {
    const chunks = [
      chunk('text-delta', { id: 'text-0', text: 'Hello ' }),
      chunk('reasoning-start', { id: 'reasoning-0' }),
      chunk('reasoning-end', { id: 'reasoning-0' }),
      chunk('text-delta', { id: 'text-0', text: 'world' }),
    ]

    let state = createInitialState()
    for (const streamChunk of chunks) {
      state = (await processStreamChunk(streamChunk, state, callbacks)).state
    }

    expect(state.contentParts).toMatchObject([{ type: 'text', text: 'Hello world' }])
  })

  it('finalizes the previous reasoning duration when a new block starts', async () => {
    let state = createInitialState()
    state = (await processStreamChunk(chunk('reasoning-delta', { id: 'reasoning-0', text: 'first' }), state, callbacks))
      .state
    const firstPart = state.contentParts[0] as MessageReasoningPart
    expect(firstPart.duration).toBeUndefined()

    state = (await processStreamChunk(chunk('reasoning-start', { id: 'reasoning-1' }), state, callbacks)).state
    expect(firstPart.duration).toBeDefined()
  })

  it('emits generic preparing status when reasoning ends', async () => {
    const state = createInitialState()
    const reasoning = await processStreamChunk(chunk('reasoning-delta', { text: 'Thinking...' }), state, callbacks)
    const result = await processStreamChunk(chunk('reasoning-end', { id: 'r1' }), reasoning.state, callbacks)

    expect(result.skipUpdate).toBe(true)
    expect(result.statusChunk).toEqual({
      type: 'status',
      status: { type: 'preparing_tool_call' },
    })
  })

  it('emits tool-specific preparing status on tool input start', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(
      chunk('tool-input-start', { id: 'tc1', toolName: 'code_execution' }),
      state,
      callbacks
    )

    expect(result.skipUpdate).toBe(true)
    expect(result.statusChunk).toEqual({
      type: 'status',
      status: { type: 'preparing_tool_call', toolName: 'code_execution' },
    })
  })

  it('keeps tool input deltas as status-only updates', async () => {
    const state = createInitialState([{ type: 'reasoning', text: 'Thinking...', duration: 100 }])
    const result = await processStreamChunk(
      chunk('tool-input-delta', { toolCallId: 'tc1', inputTextDelta: '{"code":' }),
      state,
      callbacks
    )

    expect(result.skipUpdate).toBe(true)
    expect(result.statusChunk).toBeUndefined()
    expect(result.state.contentParts).toEqual(state.contentParts)
  })

  it('does not report progress for small or fast tool input', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const start = await processStreamChunk(
        chunk('tool-input-start', { toolCallId: 'tc1', toolName: 'code_execution' }),
        createInitialState(),
        callbacks
      )
      vi.setSystemTime(1000)
      const smallResult = await processStreamChunk(
        chunk('tool-input-delta', { toolCallId: 'tc1', inputTextDelta: '{"code":"one\\ntwo"' }),
        start.state,
        callbacks
      )

      expect(smallResult.statusChunk).toBeUndefined()

      vi.setSystemTime(2000)
      const fastStart = await processStreamChunk(
        chunk('tool-input-start', { toolCallId: 'tc2', toolName: 'code_execution' }),
        createInitialState(),
        callbacks
      )
      vi.setSystemTime(2200)
      const fastResult = await processStreamChunk(
        chunk('tool-input-delta', {
          toolCallId: 'tc2',
          inputTextDelta: `{"code":"${Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\\n')}"`,
        }),
        fastStart.state,
        callbacks
      )

      expect(fastResult.statusChunk).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports line progress for code execution tool input after the display threshold', async () => {
    vi.useFakeTimers()
    const state = createInitialState()
    vi.setSystemTime(0)
    const start = await processStreamChunk(
      chunk('tool-input-start', { toolCallId: 'tc1', toolName: 'code_execution' }),
      state,
      callbacks
    )
    vi.setSystemTime(1000)
    const result = await processStreamChunk(
      chunk('tool-input-delta', {
        toolCallId: 'tc1',
        inputTextDelta: `{"code":"${Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\\n')}"`,
      }),
      start.state,
      callbacks
    )
    vi.useRealTimers()

    expect(result.skipUpdate).toBe(true)
    expect(result.statusChunk).toEqual({
      type: 'status',
      status: { type: 'preparing_tool_call', toolName: 'code_execution', progress: { kind: 'lines', value: 12 } },
    })
  })

  it('reports line progress for file write and edit tool input', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const writeStart = await processStreamChunk(
      chunk('tool-input-start', { toolCallId: 'tc1', toolName: 'sandbox_write' }),
      createInitialState(),
      callbacks
    )
    vi.setSystemTime(1000)
    const writeResult = await processStreamChunk(
      chunk('tool-input-delta', {
        toolCallId: 'tc1',
        inputTextDelta: `{"content":"${Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join('\\n')}"`,
      }),
      writeStart.state,
      callbacks
    )

    expect(writeResult.statusChunk).toEqual({
      type: 'status',
      status: { type: 'preparing_tool_call', toolName: 'sandbox_write', progress: { kind: 'lines', value: 11 } },
    })

    vi.setSystemTime(2000)
    const editStart = await processStreamChunk(
      chunk('tool-input-start', { toolCallId: 'tc2', toolName: 'edit_file' }),
      createInitialState(),
      callbacks
    )
    vi.setSystemTime(3000)
    const editResult = await processStreamChunk(
      chunk('tool-input-delta', {
        toolCallId: 'tc2',
        inputTextDelta: `{"new_text":"${Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\\n')}"`,
      }),
      editStart.state,
      callbacks
    )
    vi.useRealTimers()

    expect(editResult.statusChunk).toEqual({
      type: 'status',
      status: { type: 'preparing_tool_call', toolName: 'edit_file', progress: { kind: 'lines', value: 10 } },
    })
  })

  it('keeps tool input end as a status-only update', async () => {
    const state = createInitialState([{ type: 'reasoning', text: 'Thinking...', duration: 100 }])
    const result = await processStreamChunk(chunk('tool-input-end', { toolCallId: 'tc1' }), state, callbacks)

    expect(result.skipUpdate).toBe(true)
    expect(result.statusChunk).toBeUndefined()
    expect(result.state.contentParts).toEqual(state.contentParts)
  })

  it('handles tool-call', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'test' } }),
      state,
      callbacks
    )
    expect(result.state.contentParts).toHaveLength(1)
    expect(result.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      state: 'call',
      toolCallId: 'tc1',
      toolName: 'search',
    })
  })

  it('clears the preparing status when the tool-call consumes its preparation state', async () => {
    let state = createInitialState()
    state = (await processStreamChunk(chunk('tool-input-start', { id: 'tc1', toolName: 'search' }), state, callbacks))
      .state

    const result = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'test' } }),
      state,
      callbacks
    )

    expect(result.clearStatus).toBe(true)
  })

  it('keeps the preparing status when a parallel sibling is still streaming its input', async () => {
    let state = createInitialState()
    // Sibling tc2 owns the preparing slot when tc1's tool-call chunk arrives.
    state = (
      await processStreamChunk(chunk('tool-input-start', { id: 'tc2', toolName: 'edit_file' }), state, callbacks)
    ).state

    const result = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'test' } }),
      state,
      callbacks
    )

    expect(result.clearStatus).toBeFalsy()
    // tc2's preparation state must survive so its later chunks can still consume it.
    const followUp = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc2', toolName: 'edit_file', args: { path: 'a.ts' } }),
      result.state,
      callbacks
    )
    expect(followUp.clearStatus).toBe(true)
  })

  it('preserves provider metadata on tool-call chunks', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-1' } }
    const state = createInitialState()
    const result = await processStreamChunk(
      chunk('tool-call', {
        toolCallId: 'tc1',
        toolName: 'search',
        args: { q: 'test' },
        providerMetadata,
        providerExecuted: true,
      }),
      state,
      callbacks
    )

    expect(result.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      providerMetadata,
      providerExecuted: true,
    })
  })

  it('preserves provider metadata from tool input start when the tool-call chunk omits it', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-from-start' } }
    const start = await processStreamChunk(
      chunk('tool-input-start', { id: 'tc1', toolName: 'search', providerMetadata }),
      createInitialState(),
      callbacks
    )
    const result = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'test' } }),
      start.state,
      callbacks
    )

    expect(result.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      providerMetadata,
    })
  })

  it('preserves provider metadata from tool input delta when the tool-call chunk omits it', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-from-delta' } }
    const start = await processStreamChunk(
      chunk('tool-input-start', { id: 'tc1', toolName: 'search' }),
      createInitialState(),
      callbacks
    )
    const delta = await processStreamChunk(
      chunk('tool-input-delta', { id: 'tc1', delta: '{"q":"test"}', providerMetadata }),
      start.state,
      callbacks
    )
    const result = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'test' } }),
      delta.state,
      callbacks
    )

    expect(result.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      providerMetadata,
    })
  })

  it('preserves provider metadata from tool input end when the tool-call chunk omits it', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-from-end' } }
    const start = await processStreamChunk(
      chunk('tool-input-start', { id: 'tc1', toolName: 'search' }),
      createInitialState(),
      callbacks
    )
    const end = await processStreamChunk(
      chunk('tool-input-end', { id: 'tc1', providerMetadata }),
      start.state,
      callbacks
    )
    const result = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'test' } }),
      end.state,
      callbacks
    )

    expect(result.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      providerMetadata,
    })
  })

  it("does not stamp a still-streaming sibling call's provider metadata onto an interleaved tool-result", async () => {
    const siblingMetadata = { google: { thoughtSignature: 'signature-of-tc2' } }
    // tc1's tool-call chunk arrives without metadata, then tc2's input starts streaming
    // (carrying tc2's signature) while tc1 executes; tc1's result interleaves before tc2's tool-call.
    const firstCall = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'one' } }),
      createInitialState(),
      callbacks
    )
    const siblingInputStart = await processStreamChunk(
      chunk('tool-input-start', { id: 'tc2', toolName: 'search', providerMetadata: siblingMetadata }),
      firstCall.state,
      callbacks
    )
    const firstResult = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: { data: 'one' } }),
      siblingInputStart.state,
      callbacks
    )
    const secondCall = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc2', toolName: 'search', args: { q: 'two' } }),
      firstResult.state,
      callbacks
    )

    const [firstPart, secondPart] = secondCall.state.contentParts as Array<{
      providerMetadata?: Record<string, unknown>
    }>
    // tc1 must not inherit tc2's signature, and tc2's pending metadata must survive tc1's result.
    expect(firstPart.providerMetadata).toBeUndefined()
    expect(secondPart.providerMetadata).toEqual(siblingMetadata)
  })

  it('stamps tool calls in the same generation step with the same step index', async () => {
    const state = createInitialState()
    const first = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'one' } }),
      state,
      callbacks
    )
    const second = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc2', toolName: 'search', args: { q: 'two' } }),
      first.state,
      callbacks
    )

    const [firstPart, secondPart] = second.state.contentParts as Array<{ stepIndex?: number }>
    expect(firstPart.stepIndex).toBe(0)
    expect(secondPart.stepIndex).toBe(0)
  })

  it('keeps one step index when a fast tool-result interleaves before a sibling tool-call', async () => {
    // A fast tc1 result can arrive before tc2's tool-call chunk; without a finish-step
    // in between they are still one parallel batch and must share a step index.
    const firstCall = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'one' } }),
      createInitialState(),
      callbacks
    )
    const firstResult = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: { data: 'one' } }),
      firstCall.state,
      callbacks
    )
    const secondCall = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc2', toolName: 'search', args: { q: 'two' } }),
      firstResult.state,
      callbacks
    )

    const [firstPart, secondPart] = secondCall.state.contentParts as Array<{ stepIndex?: number }>
    expect(firstPart.stepIndex).toBe(0)
    expect(secondPart.stepIndex).toBe(0)
  })

  it('increments step index after finish-step and resumes after persisted step indices', async () => {
    const first = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: { q: 'one' } }),
      createInitialState(),
      callbacks
    )
    const nextStep = await processStreamChunk(chunk('finish-step', {}), first.state, callbacks)
    const second = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc2', toolName: 'search', args: { q: 'two' } }),
      nextStep.state,
      callbacks
    )

    const [firstPart, secondPart] = second.state.contentParts as Array<{ stepIndex?: number }>
    expect(firstPart.stepIndex).toBe(0)
    expect(secondPart.stepIndex).toBe(1)

    const resumed = createInitialState(second.state.contentParts)
    const third = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc3', toolName: 'search', args: { q: 'three' } }),
      resumed,
      callbacks
    )
    const thirdPart = third.state.contentParts[2] as { stepIndex?: number }
    expect(thirdPart.stepIndex).toBe(2)
  })

  it('records startTime on tool-call and duration on tool-result', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: {} }),
      state,
      callbacks
    )
    const created = r1.state.contentParts[0] as { startTime?: number; duration?: number }
    expect(created.startTime).toBeGreaterThan(0)
    expect(created.duration).toBeUndefined()

    const r2 = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: { data: 'found' } }),
      r1.state,
      callbacks
    )
    const finished = r2.state.contentParts[0] as { duration?: number }
    expect(finished.duration).toBeGreaterThanOrEqual(0)
  })

  it('records duration on tool-error', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: {} }),
      state,
      callbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-error', { toolCallId: 'tc1', error: new Error('failed'), input: {}, toolName: 'search' }),
      r1.state,
      callbacks
    )
    const part = r2.state.contentParts[0] as { duration?: number }
    expect(part.duration).toBeGreaterThanOrEqual(0)
  })

  it('handles tool-result by updating existing tool-call', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: {} }),
      state,
      callbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: { data: 'found' } }),
      r1.state,
      callbacks
    )
    const part = r2.state.contentParts[0] as { state: string; result: unknown }
    expect(part.state).toBe('result')
    expect(part.result).toEqual({ data: 'found' })
  })

  it('preserves provider metadata on tool-result chunks', async () => {
    const providerMetadata = { openai: { itemId: 'item-1' } }
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: {} }),
      state,
      callbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: { data: 'found' }, providerMetadata }),
      r1.state,
      callbacks
    )
    const part = r2.state.contentParts[0] as { providerMetadata?: unknown; resultProviderMetadata?: unknown }
    expect(part.providerMetadata).toBeUndefined()
    expect(part.resultProviderMetadata).toEqual(providerMetadata)
  })

  it('handles tool-error by updating existing tool-call', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: {} }),
      state,
      callbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-error', { toolCallId: 'tc1', error: new Error('failed'), input: {}, toolName: 'search' }),
      r1.state,
      callbacks
    )
    const part = r2.state.contentParts[0] as { state: string; result: { error: string } }
    expect(part.state).toBe('error')
    expect(part.result.error).toBe('failed')
  })

  it('returns tool-call limit pauses for orchestration instead of storing them as tool results', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'code_execution', args: {} }),
      state,
      callbacks
    )
    const error = new Error('Tool call limit reached before executing code_execution')
    error.name = 'ToolCallLimitPausedError'

    const result = await processStreamChunk(
      chunk('tool-error', { toolCallId: 'tc1', error, input: {}, toolName: 'code_execution' }),
      r1.state,
      callbacks
    )
    expect(result.persistentToolCallPause).toBe(error)
    expect((r1.state.contentParts[0] as { state: string }).state).toBe('call')
  })

  it('preserves provider metadata when a tool-call limit pause arrives as tool-error without a tool-call chunk', async () => {
    const providerMetadata = { google: { thoughtSignature: 'signature-before-pause' } }
    const start = await processStreamChunk(
      chunk('tool-input-start', { id: 'tc1', toolName: 'code_execution', providerMetadata }),
      createInitialState(),
      callbacks
    )
    const error = new Error('Tool call limit reached before executing code_execution')
    error.name = 'ToolCallLimitPausedError'

    const result = await processStreamChunk(
      chunk('tool-error', { toolCallId: 'tc1', error, input: { code: '1' }, toolName: 'code_execution' }),
      start.state,
      callbacks
    )

    expect(result.persistentToolCallPause).toBe(error)
    expect(start.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      state: 'call',
      toolCallId: 'tc1',
      providerMetadata,
    })
  })

  it.each([
    'UserExecApprovalPausedError',
    'CommandEscalationApprovalPausedError',
    'FileMutationApprovalPausedError',
    'AppActionApprovalPausedError',
  ])('returns %s for orchestration instead of storing it as a tool result', async (errorName) => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'user_exec', args: {} }),
      state,
      callbacks
    )
    const error = new Error('approval required')
    error.name = errorName

    const result = await processStreamChunk(
      chunk('tool-error', { toolCallId: 'tc1', error, input: {}, toolName: 'user_exec' }),
      r1.state,
      callbacks
    )
    expect(result.persistentToolCallPause).toBe(error)
    expect((r1.state.contentParts[0] as { state: string }).state).toBe('call')
  })

  // AI SDK v6 dropped the dedicated `tool-input-error` chunk; input-parse failures now
  // arrive as `tool-error` without a preceding `tool-call`, so the part is created here.
  it('handles tool-error by creating an error tool-call part when none exists', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(
      chunk('tool-error', {
        toolCallId: 'tc1',
        toolName: 'code_execution',
        input: '{"code":"console.log(1)",',
        error: 'Invalid JSON',
      }),
      state,
      callbacks
    )

    expect(result.state.contentParts).toHaveLength(1)
    expect(result.state.contentParts[0]).toMatchObject({
      type: 'tool-call',
      state: 'error',
      toolCallId: 'tc1',
      toolName: 'code_execution',
      args: '{"code":"console.log(1)",',
      result: {
        error: 'Invalid JSON',
        input: '{"code":"console.log(1)",',
        toolName: 'code_execution',
      },
    })
  })

  it('handles file chunk by calling onFileReceived callback', async () => {
    const mockCallback = { onFileReceived: vi.fn(async () => 'stored-key') }
    const state = createInitialState()
    const result = await processStreamChunk(
      chunk('file', { file: { mediaType: 'image/png', base64: 'abc123' } }),
      state,
      mockCallback
    )
    expect(mockCallback.onFileReceived).toHaveBeenCalledWith('image/png', 'abc123')
    expect(result.state.contentParts).toHaveLength(1)
    expect(result.state.contentParts[0]).toEqual({ type: 'image', storageKey: 'stored-key' })
  })

  it('handles status chunk by returning skipUpdate=true with statusChunk', async () => {
    const state = createInitialState()
    const statusData = chunk('status', { status: 'Processing...' })
    const result = await processStreamChunk(statusData, state, callbacks)
    expect(result.skipUpdate).toBe(true)
    expect(result.statusChunk).toBe(statusData)
  })

  it('handles finish chunk with totalUsage and finishReason', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(
      chunk('finish', { finishReason: 'stop', totalUsage: { promptTokens: 10, completionTokens: 20 } }),
      state,
      callbacks
    )
    expect(result.state.finishReason).toBe('stop')
    expect(result.state.usage).toEqual({ promptTokens: 10, completionTokens: 20 })
  })

  it('handles error chunk without crashing', async () => {
    const state = createInitialState()
    const result = await processStreamChunk(chunk('error'), state, callbacks)
    expect(result.skipUpdate).toBe(false)
    expect(result.state.contentParts).toHaveLength(0)
  })

  it('offloads large tool-result to blob storage via onLargeToolResult', async () => {
    const largeResult = 'x'.repeat(TOOL_RESULT_SIZE_LIMIT + 100)
    const providerMetadata = { openai: { itemId: 'result-item-1' } }
    const mockCallbacks: StreamProcessorCallbacks = {
      onFileReceived: vi.fn(async () => 'mock-key'),
      onLargeToolResult: vi.fn(async () => 'tool-result:sess:tc1'),
    }

    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'web_search', args: {} }),
      state,
      mockCallbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: largeResult, providerMetadata }),
      r1.state,
      mockCallbacks
    )

    const part = r2.state.contentParts[0] as {
      state: string
      result: string
      resultStorageKey: string
      resultProviderMetadata?: unknown
    }
    expect(part.state).toBe('result')
    expect(part.resultStorageKey).toBe('tool-result:sess:tc1')
    expect(part.result).toBe(largeResult.slice(0, TOOL_RESULT_PREVIEW_LENGTH))
    expect(part.resultProviderMetadata).toEqual(providerMetadata)
    expect(mockCallbacks.onLargeToolResult).toHaveBeenCalledWith('tc1', largeResult)
  })

  it('does not offload small tool-result even when callback is provided', async () => {
    const smallResult = { data: 'small' }
    const mockCallbacks: StreamProcessorCallbacks = {
      onFileReceived: vi.fn(async () => 'mock-key'),
      onLargeToolResult: vi.fn(async () => 'should-not-be-called'),
    }

    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc1', toolName: 'search', args: {} }),
      state,
      mockCallbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-result', { toolCallId: 'tc1', result: smallResult }),
      r1.state,
      mockCallbacks
    )

    const part = r2.state.contentParts[0] as { state: string; result: unknown; resultStorageKey?: string }
    expect(part.state).toBe('result')
    expect(part.result).toEqual(smallResult)
    expect(part.resultStorageKey).toBeUndefined()
    expect(mockCallbacks.onLargeToolResult).not.toHaveBeenCalled()
  })

  it('promotes image storage metadata out of a tool private result', async () => {
    const state = createInitialState()
    const r1 = await processStreamChunk(
      chunk('tool-call', { toolCallId: 'tc-image', toolName: 'render_chart', args: {} }),
      state,
      callbacks
    )
    const r2 = await processStreamChunk(
      chunk('tool-result', {
        toolCallId: 'tc-image',
        result: {
          success: true,
          file_path: 'chart.png',
          image_storage_key: 'picture:chart',
          media_type: 'image/webp',
        },
      }),
      r1.state,
      callbacks
    )

    expect(r2.state.contentParts[0]).toMatchObject({
      resultImageStorageKey: 'picture:chart',
      resultImageMediaType: 'image/webp',
      result: { success: true, file_path: 'chart.png', media_type: 'image/webp' },
    })
    expect((r2.state.contentParts[0] as MessageToolCallPart).result).not.toHaveProperty('image_storage_key')
  })
})
