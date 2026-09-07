import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuideUIMessage } from './types'
import { parseStreamResponse, type StreamParserCallbacks } from './useStreamParser'

vi.mock('@/components/Confetti', () => ({ confetti: vi.fn() }))
vi.mock('@/stores/onboardingStore', () => ({
  onboardingStore: {
    getState: () => ({ markCompleted: vi.fn() }),
  },
}))
vi.mock('@/stores/premiumActions', () => ({ activate: vi.fn() }))

function createReader(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }).getReader()
}

function createHarness() {
  let messages: GuideUIMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      parts: [],
      isStreaming: true,
    },
  ]
  const pendingUpdateRef: StreamParserCallbacks['pendingUpdateRef'] = { current: null }
  const setMessages: StreamParserCallbacks['setMessages'] = (update) => {
    messages = typeof update === 'function' ? update(messages) : update
  }
  const callbacks: StreamParserCallbacks = {
    setMessages,
    setOnboardingStep: vi.fn(),
    pendingUpdateRef,
    pendingTimeouts: new Set(),
    markGuideCompleted: vi.fn(async () => undefined),
    t: ((key: string) => key) as StreamParserCallbacks['t'],
  }

  return {
    callbacks,
    getMessage: () => messages[0],
    getMessages: () => messages,
    pendingUpdateRef,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('parseStreamResponse', () => {
  it('flushes and parses the final unterminated stream line at EOF', async () => {
    const decoderSpy = vi.spyOn(TextDecoder.prototype, 'decode')
    const payload = [
      'data: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"show_new_chat_button"}',
      'data: {"type":"tool-output-available","toolCallId":"tool-1","output":{"label":"尾部"}}',
    ].join('\n')
    const encoded = new TextEncoder().encode(payload)
    const multibyteStart = encoded.lastIndexOf(0xe5)
    const reader = createReader([encoded.slice(0, multibyteStart + 1), encoded.slice(multibyteStart + 1)])
    const { callbacks, getMessage } = createHarness()

    await parseStreamResponse(reader, callbacks)

    expect(getMessage()).toMatchObject({
      isStreaming: false,
      parts: [
        {
          type: 'tool-show_new_chat_button',
          toolCallId: 'tool-1',
          toolName: 'show_new_chat_button',
          state: 'result',
          result: { label: '尾部' },
        },
      ],
    })
    expect(decoderSpy).toHaveBeenLastCalledWith()
  })

  it('commits a pending animation-frame update before completing the stream', async () => {
    let pendingFrame: FrameRequestCallback | undefined
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      pendingFrame = callback
      return 0
    })
    const cancelAnimationFrameMock = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)

    const reader = createReader([
      new TextEncoder().encode(
        'data: {"type":"text-delta","delta":"final"}\ndata: {"type":"text-delta","delta":" answer"}\n'
      ),
    ])
    const { callbacks, getMessage, pendingUpdateRef } = createHarness()

    await parseStreamResponse(reader, callbacks)

    expect(getMessage()).toMatchObject({
      content: 'final answer',
      parts: [{ type: 'text', text: 'final answer' }],
      isStreaming: false,
    })
    expect(requestAnimationFrameMock).toHaveBeenCalledOnce()
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(0)
    expect(pendingUpdateRef.current).toBeNull()

    pendingFrame?.(0)
    expect(getMessage()).toMatchObject({
      content: 'final answer',
      parts: [{ type: 'text', text: 'final answer' }],
      isStreaming: false,
    })
  })

  it('flushes pending content and invalidates the stale frame when reading aborts', async () => {
    let pendingFrame: FrameRequestCallback | undefined
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      pendingFrame = callback
      return 17
    })
    const cancelAnimationFrameMock = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock)

    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('data: {"type":"text-delta","delta":"partial answer"}\n'),
      })
      .mockRejectedValueOnce(abortError)
    const reader = { read } as unknown as ReadableStreamDefaultReader<Uint8Array>
    const { callbacks, getMessage, getMessages, pendingUpdateRef } = createHarness()
    let thrown: unknown

    try {
      await parseStreamResponse(reader, callbacks)
    } catch (error) {
      thrown = error
    }

    expect(getMessage()).toMatchObject({
      content: 'partial answer',
      parts: [{ type: 'text', text: 'partial answer' }],
      isStreaming: true,
    })
    expect(thrown).toBe(abortError)
    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(17)
    expect(pendingUpdateRef.current).toBeNull()

    callbacks.setMessages((prev) => [
      { ...prev[0], isStreaming: false },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: 'new answer',
        parts: [{ type: 'text', text: 'new answer' }],
        isStreaming: true,
      },
    ])
    pendingFrame?.(0)

    expect(getMessages()[1]).toMatchObject({
      content: 'new answer',
      parts: [{ type: 'text', text: 'new answer' }],
      isStreaming: true,
    })
  })
})
