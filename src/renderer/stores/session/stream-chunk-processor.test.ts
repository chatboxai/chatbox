import type { ModelStreamPart } from '@shared/models/types'
import type { MessageReasoningPart } from '@shared/types/session'
import type { ToolSet } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import {
  createInitialState,
  finalizeReasoningDuration,
  processStreamChunk,
  type StreamProcessorCallbacks,
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

describe('processStreamChunk', () => {
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
})
