import { describe, expect, it } from 'vitest'
import { createInitialState, processStreamChunk } from '../../generation/stream-chunk-processor'
import type { Message } from '../../types/session'
import { snapshotStreamingMessage } from './streaming-message-snapshot'

describe('snapshotStreamingMessage', () => {
  it('retains published reasoning, text, tool state and status while processing later chunks', async () => {
    let state = createInitialState()
    const callbacks = { onFileReceived: async () => 'image' }
    const process = async (chunk: Parameters<typeof processStreamChunk>[0]) => {
      state = (await processStreamChunk(chunk, state, callbacks)).state
    }
    const message: Message = {
      id: 'stream',
      role: 'assistant',
      contentParts: state.contentParts,
      status: [{ type: 'retrying', attempt: 1, maxAttempts: 3 }],
      generating: true,
    }

    await process({ type: 'reasoning-delta', id: 'reasoning', text: 'Consider' })
    const reasoning = snapshotStreamingMessage(message)
    await process({ type: 'reasoning-delta', id: 'reasoning', text: ' carefully' })
    await process({ type: 'text-delta', id: 'text', text: 'Answer' })
    const text = snapshotStreamingMessage(message)
    await process({ type: 'text-delta', id: 'text', text: ' continues' })
    await process({ type: 'tool-call', toolCallId: 'search', toolName: 'search', input: { query: 'facts' } })
    const tool = snapshotStreamingMessage(message)
    await process({ type: 'tool-result', toolCallId: 'search', toolName: 'search', input: {}, output: { found: true } })
    const status = message.status?.[0]
    if (status?.type === 'retrying') status.attempt = 2
    message.generating = false

    expect(reasoning.contentParts).toEqual([{ type: 'reasoning', text: 'Consider', startTime: expect.any(Number) }])
    expect(text.contentParts[1]).toEqual({ type: 'text', text: 'Answer' })
    expect(tool.contentParts[2]).toMatchObject({ type: 'tool-call', state: 'call' })
    expect(tool.contentParts[2]).not.toHaveProperty('result')
    expect(tool.contentParts[2]).not.toHaveProperty('duration')
    expect(tool.status).toEqual([{ type: 'retrying', attempt: 1, maxAttempts: 3 }])
    expect(tool.generating).toBe(true)
    expect(message.contentParts[2]).toMatchObject({ state: 'result', result: { found: true } })
  })
})
