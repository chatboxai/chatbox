/**
 * @vitest-environment jsdom
 */
import type { Message } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computationQueue } from '../computation-queue'
import {
  estimateDraftTokensImmediately,
  getDraftTokenizationText,
  getTokenizationTextDigest,
  LONG_DRAFT_TOKENIZATION_THRESHOLD,
} from '../draft-tokenization'
import { tokenizeDraftOffMainThread } from '../draft-tokenizer-worker-client'
import {
  _resetExactTokenizationFallbacks,
  MAX_EXACT_TOKENIZATION_FALLBACKS,
  recordExactTokenizationFallback,
} from '../exact-retry'
import { LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS, useTokenEstimation } from '../hooks/useTokenEstimation'

vi.mock('../draft-tokenizer-worker-client', () => ({
  tokenizeDraftOffMainThread: vi.fn(),
}))

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    contentParts: [{ type: 'text', text: 'Hello world' }],
    ...overrides,
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function advanceDraftTokenizationDebounce(): void {
  act(() => {
    vi.advanceTimersByTime(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
  })
}

describe('useTokenEstimation', () => {
  beforeEach(() => {
    computationQueue._reset()
    _resetExactTokenizationFallbacks()
    vi.mocked(tokenizeDraftOffMainThread).mockReset()
  })

  afterEach(() => {
    computationQueue._reset()
    _resetExactTokenizationFallbacks()
    vi.useRealTimers()
  })

  describe('basic functionality', () => {
    it('returns zero values when no messages provided', () => {
      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: undefined,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(result.current.currentInputTokens).toBe(0)
      expect(result.current.contextTokens).toBe(0)
      expect(result.current.totalTokens).toBe(0)
      expect(result.current.isCalculating).toBe(false)
      expect(result.current.isDraftCalculating).toBe(false)
      expect(result.current.isCurrentInputApproximate).toBe(false)
      expect(result.current.isTotalApproximate).toBe(false)
      expect(result.current.isContextCalculating).toBe(false)
      expect(result.current.pendingTasks).toBe(0)
      expect(result.current.pendingContextMessages).toBe(0)
    })

    it('keeps context marked approximate for a persisted sampling fallback', () => {
      // Budget exhausted: the entry stays as-is instead of re-enqueueing.
      const contextMessage = createMessage({
        id: 'ctx-1',
        tokenCountMap: { default: 5000 },
        tokenCalculatedAt: { default: 1000 },
        tokenCountApproximate: { default: true },
      })
      const textDigest = getTokenizationTextDigest(getDraftTokenizationText(contextMessage))
      for (let attempt = 0; attempt < MAX_EXACT_TOKENIZATION_FALLBACKS; attempt++) {
        recordExactTokenizationFallback('ctx-1', 'default', textDigest)
      }

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: undefined,
          contextMessages: [contextMessage],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(result.current.contextTokens).toBe(5000)
      expect(result.current.isContextApproximate).toBe(true)
      expect(result.current.isTotalApproximate).toBe(true)
      expect(result.current.isContextCalculating).toBe(false)
      expect(result.current.isCalculating).toBe(false)
    })

    it('calculates current input tokens inline (ignores cache)', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 2 tokens (calculated inline, cache ignored)
      expect(result.current.currentInputTokens).toBe(2)
      expect(result.current.totalTokens).toBe(2)
    })

    it('calculates totalTokens as sum of currentInput and context', () => {
      const currentInput = createMessage({
        id: 'current',
        tokenCountMap: { default: 50 },
        tokenCalculatedAt: { default: 1000 },
      })
      const contextMsg = createMessage({
        id: 'context',
        tokenCountMap: { default: 150 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: currentInput,
          contextMessages: [contextMsg],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // currentInput: 2 (inline), context: 150 (cached)
      expect(result.current.currentInputTokens).toBe(2)
      expect(result.current.contextTokens).toBe(150)
      expect(result.current.totalTokens).toBe(152)
    })

    it('returns breakdown of token sources', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 2 tokens (calculated inline)
      expect(result.current.breakdown).toEqual({
        currentInput: { text: 2, attachments: 0, toolCalls: 0 },
        context: { text: 0, attachments: 0, toolCalls: 0 },
      })
    })

    it('returns a fast estimate for a long new-session draft, then converges without losing other totals', async () => {
      vi.useFakeTimers()
      const deferred = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValue(deferred.promise)
      const text = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const message = createMessage({
        contentParts: [{ type: 'text', text }],
        files: [
          {
            id: 'file-1',
            name: 'notes.txt',
            fileType: 'text/plain',
            storageKey: 'file-key',
            lineCount: 1,
            byteLength: 10,
            tokenCountMap: { default: 50 },
          },
        ],
      })
      const contextMessage = createMessage({
        id: 'context',
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'new',
          constructedMessage: message,
          contextMessages: [contextMessage],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      const immediateTextTokens = estimateDraftTokensImmediately(text, 'default')
      expect(result.current.breakdown.currentInput).toEqual({
        text: immediateTextTokens,
        attachments: 50,
        toolCalls: 0,
      })
      expect(result.current.totalTokens).toBe(immediateTextTokens + 150)
      expect(result.current.isCalculating).toBe(true)
      expect(result.current.isDraftCalculating).toBe(true)
      expect(result.current.isCurrentInputApproximate).toBe(true)
      expect(result.current.isTotalApproximate).toBe(true)
      expect(result.current.isContextCalculating).toBe(false)
      expect(result.current.pendingTasks).toBe(1)
      expect(result.current.pendingContextMessages).toBe(0)
      expect(result.current.exactDraftTokens).toBeNull()
      expect(tokenizeDraftOffMainThread).not.toHaveBeenCalled()

      advanceDraftTokenizationDebounce()
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledWith(text, 'default', expect.any(AbortSignal))

      await act(async () => {
        deferred.resolve(1234)
        await deferred.promise
      })

      expect(result.current.breakdown.currentInput).toEqual({ text: 1234, attachments: 50, toolCalls: 0 })
      expect(result.current.totalTokens).toBe(1384)
      expect(result.current.isCalculating).toBe(false)
      expect(result.current.isDraftCalculating).toBe(false)
      expect(result.current.isCurrentInputApproximate).toBe(false)
      expect(result.current.isTotalApproximate).toBe(false)
      expect(result.current.isContextCalculating).toBe(false)
      expect(result.current.pendingTasks).toBe(0)
      expect(result.current.pendingContextMessages).toBe(0)
      // The exact count is exposed for seeding the outgoing message at submit.
      expect(result.current.exactDraftTokens).toEqual({ text, tokenizerType: 'default', tokens: 1234 })
    })

    it.each([new Error('Worker is unavailable'), new Error('Draft tokenization worker timed out')])(
      'keeps the immediate estimate marked approximate after worker failure: %s',
      async (workerError) => {
        vi.useFakeTimers()
        vi.mocked(tokenizeDraftOffMainThread).mockRejectedValue(workerError)
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const text = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)

        try {
          const { result } = renderHook(() =>
            useTokenEstimation({
              sessionId: 'session-1',
              constructedMessage: createMessage({ contentParts: [{ type: 'text', text }] }),
              contextMessages: [],
              model: undefined,
              modelSupportToolUseForFile: false,
            })
          )

          expect(result.current.isCalculating).toBe(true)
          expect(tokenizeDraftOffMainThread).not.toHaveBeenCalled()

          await act(async () => {
            vi.advanceTimersByTime(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)
            await Promise.resolve()
          })

          expect(result.current.currentInputTokens).toBe(estimateDraftTokensImmediately(text, 'default'))
          expect(result.current.isCalculating).toBe(false)
          expect(result.current.isDraftCalculating).toBe(false)
          expect(result.current.isCurrentInputApproximate).toBe(true)
          expect(result.current.isTotalApproximate).toBe(true)
          expect(result.current.isContextCalculating).toBe(false)
          expect(result.current.pendingTasks).toBe(0)
          // An approximate fallback must never seed the outgoing message.
          expect(result.current.exactDraftTokens).toBeNull()
          expect(consoleError).toHaveBeenCalledWith('Failed to tokenize long draft in worker', workerError)
        } finally {
          consoleError.mockRestore()
        }
      }
    )
  })

  describe('tokenizer type selection', () => {
    it('uses default tokenizer for current input calculation', () => {
      const message = createMessage({
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 2 tokens (default tiktoken)
      expect(result.current.currentInputTokens).toBe(2)
    })

    it('uses deepseek tokenizer for current input when model is deepseek', () => {
      const message = createMessage({
        tokenCountMap: { default: 100, deepseek: 80 },
        tokenCalculatedAt: { default: 1000, deepseek: 1000 },
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: { provider: 'deepseek', modelId: 'deepseek-chat' },
          modelSupportToolUseForFile: false,
        })
      )

      // 'Hello world' = 4 tokens (deepseek: 10 letters × 0.3 + 1 space)
      expect(result.current.currentInputTokens).toBe(4)
    })

    it('uses the DeepSeek tokenizer in the worker for a long draft', async () => {
      vi.useFakeTimers()
      const deferred = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValue(deferred.promise)
      const text = '深'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const message = createMessage({ contentParts: [{ type: 'text', text }] })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: { provider: 'deepseek', modelId: 'deepseek-chat' },
          modelSupportToolUseForFile: false,
        })
      )

      expect(result.current.isCalculating).toBe(true)
      expect(tokenizeDraftOffMainThread).not.toHaveBeenCalled()

      advanceDraftTokenizationDebounce()
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledWith(text, 'deepseek', expect.any(AbortSignal))

      await act(async () => {
        deferred.resolve(2458)
        await deferred.promise
      })

      expect(result.current.currentInputTokens).toBe(2458)
      expect(result.current.isCalculating).toBe(false)
    })

    it('cancels active work and debounces again when the tokenizer changes', () => {
      vi.useFakeTimers()
      const first = createDeferred<number>()
      const second = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const text = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const message = createMessage({ contentParts: [{ type: 'text', text }] })
      const initialProps: { model?: { provider: string; modelId: string } } = { model: undefined }

      const { rerender } = renderHook(
        ({ model }: { model?: { provider: string; modelId: string } }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage: message,
            contextMessages: [],
            model,
            modelSupportToolUseForFile: false,
          }),
        { initialProps }
      )
      advanceDraftTokenizationDebounce()
      const defaultSignal = vi.mocked(tokenizeDraftOffMainThread).mock.calls[0][2]

      rerender({ model: { provider: 'deepseek', modelId: 'deepseek-chat' } })

      expect(defaultSignal.aborted).toBe(true)
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(1)

      advanceDraftTokenizationDebounce()

      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(2)
      expect(tokenizeDraftOffMainThread).toHaveBeenLastCalledWith(text, 'deepseek', expect.any(AbortSignal))
    })
  })

  describe('task submission', () => {
    it('does not submit tasks for current input text (calculated inline)', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      // No tasks submitted because current input text is calculated inline
      expect(computationQueue.getStatus().pending).toBe(0)
    })

    it('submits tasks for context messages without cache', () => {
      const contextMsg = createMessage({ id: 'ctx-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: undefined,
          contextMessages: [contextMsg],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(1)
      const tasks = computationQueue.getPendingTasks()
      expect(tasks[0]).toMatchObject({
        sessionId: 'session-1',
        messageId: 'ctx-no-cache',
      })
    })

    it('counts distinct context messages instead of computation tasks', () => {
      const contextMsg = createMessage({
        id: 'ctx-multi-task',
        files: [
          {
            id: 'file-1',
            name: 'notes.txt',
            fileType: 'text/plain',
            storageKey: 'file-key',
            lineCount: 1,
            byteLength: 10,
          },
        ],
      })

      const { result } = renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: undefined,
          contextMessages: [contextMsg],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getPendingTasks()).toHaveLength(2)
      expect(result.current.isContextCalculating).toBe(true)
      expect(result.current.pendingContextMessages).toBe(1)
    })

    it('does not submit tasks when sessionId is null', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: null,
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(0)
    })

    it('does not submit tasks when sessionId is "new"', () => {
      const message = createMessage({ id: 'msg-no-cache' })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'new',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(0)
    })

    it('does not submit tasks when all tokens are cached', () => {
      const message = createMessage({
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })

      renderHook(() =>
        useTokenEstimation({
          sessionId: 'session-1',
          constructedMessage: message,
          contextMessages: [],
          model: undefined,
          modelSupportToolUseForFile: false,
        })
      )

      expect(computationQueue.getStatus().pending).toBe(0)
    })
  })

  describe('queue status subscription', () => {
    it('updates isCalculating when queue status changes (after throttle window)', () => {
      vi.useFakeTimers()
      try {
        const message = createMessage({
          tokenCountMap: { default: 100 },
          tokenCalculatedAt: { default: 1000 },
        })
        const contextMsg = createMessage({
          id: 'ctx-msg',
          tokenCountMap: { default: 50 },
          tokenCalculatedAt: { default: 1000 },
        })

        const { result } = renderHook(() =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage: message,
            contextMessages: [contextMsg],
            model: undefined,
            modelSupportToolUseForFile: false,
          })
        )

        expect(result.current.isCalculating).toBe(false)

        act(() => {
          computationQueue.enqueue({
            type: 'message-text',
            sessionId: 'session-1',
            messageId: 'ctx-msg',
            tokenizerType: 'default',
            priority: 10,
          })
        })

        // Queue notifications are throttled (trailing edge) so per-task
        // completions during a backfill don't re-render the InputBox each time.
        act(() => {
          vi.advanceTimersByTime(150)
        })

        expect(result.current.isCalculating).toBe(true)
        expect(result.current.isContextCalculating).toBe(true)
        expect(result.current.pendingTasks).toBe(1)
        expect(result.current.pendingContextMessages).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('bounds re-renders during a notification storm (backfill)', () => {
      vi.useFakeTimers()
      try {
        const contextMsg = createMessage({
          id: 'ctx-msg',
          tokenCountMap: { default: 50 },
          tokenCalculatedAt: { default: 1000 },
        })

        let renderCount = 0
        const { result } = renderHook(() => {
          renderCount++
          return useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage: undefined,
            contextMessages: [contextMsg],
            model: undefined,
            modelSupportToolUseForFile: false,
          })
        })

        const rendersBeforeStorm = renderCount

        // A backfill enqueues one task per message in rapid succession; each
        // enqueue notifies subscribers. The status subscription must coalesce
        // these into (at most) one state update per throttle window instead of
        // re-rendering the consumer once per task.
        act(() => {
          for (let i = 0; i < 50; i++) {
            computationQueue.enqueue({
              type: 'message-text',
              sessionId: 'session-1',
              messageId: `backfill-${i}`,
              tokenizerType: 'default',
              priority: 10 + i,
            })
          }
        })

        act(() => {
          vi.advanceTimersByTime(150)
        })

        expect(result.current.pendingTasks).toBe(50)
        expect(renderCount - rendersBeforeStorm).toBeLessThanOrEqual(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('session change cleanup', () => {
    it('cancels tasks when session changes', () => {
      const contextMsg = createMessage({ id: 'ctx-no-cache' })

      const { rerender } = renderHook(
        ({ sessionId }) =>
          useTokenEstimation({
            sessionId,
            constructedMessage: undefined,
            contextMessages: [contextMsg],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { sessionId: 'session-1' } }
      )

      expect(computationQueue.getStatus().pending).toBe(1)

      rerender({ sessionId: 'session-2' })

      const tasks = computationQueue.getPendingTasks()
      const session1Tasks = tasks.filter((t) => t.sessionId === 'session-1')
      expect(session1Tasks).toHaveLength(0)
    })

    it('removes pending tasks when sessionId changes to null', () => {
      const contextMsg = createMessage({ id: 'ctx-no-cache' })

      const { rerender } = renderHook(
        ({ sessionId }) =>
          useTokenEstimation({
            sessionId,
            constructedMessage: undefined,
            contextMessages: [contextMsg],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { sessionId: 'session-1' as string | null } }
      )

      expect(computationQueue.getStatus().pending).toBe(1)
      expect(computationQueue.getPendingTasks()[0].sessionId).toBe('session-1')

      rerender({ sessionId: null })

      const session1Tasks = computationQueue.getPendingTasks().filter((t) => t.sessionId === 'session-1')
      expect(session1Tasks).toHaveLength(0)
    })

    it('keeps the in-flight draft tokenization when only the session changes', async () => {
      vi.useFakeTimers()
      const deferred = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValueOnce(deferred.promise)
      const text = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const message = createMessage({ contentParts: [{ type: 'text', text }] })

      const { result, rerender } = renderHook(
        ({ sessionId }) =>
          useTokenEstimation({
            sessionId,
            constructedMessage: message,
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { sessionId: 'session-1' } }
      )
      advanceDraftTokenizationDebounce()
      const firstSignal = vi.mocked(tokenizeDraftOffMainThread).mock.calls[0][2]

      rerender({ sessionId: 'session-2' })

      // The draft count is a pure function of (text, tokenizerType): switching
      // sessions with the same draft neither aborts nor re-requests.
      expect(firstSignal.aborted).toBe(false)
      advanceDraftTokenizationDebounce()
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(1)

      await act(async () => {
        deferred.resolve(222)
        await deferred.promise
      })
      expect(result.current.currentInputTokens).toBe(222)
      expect(result.current.isCalculating).toBe(false)
    })
  })

  describe('memoization', () => {
    it('does not resubmit tasks when same props are passed', () => {
      const message = createMessage({
        id: 'msg-cached',
        tokenCountMap: { default: 100 },
        tokenCalculatedAt: { default: 1000 },
      })
      const enqueueSpy = vi.spyOn(computationQueue, 'enqueueBatch')

      const { rerender } = renderHook(
        ({ constructedMessage }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage,
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { constructedMessage: message } }
      )

      const initialCallCount = enqueueSpy.mock.calls.length

      rerender({ constructedMessage: message })

      expect(enqueueSpy.mock.calls.length).toBe(initialCallCount)

      enqueueSpy.mockRestore()
    })

    it('reanalyzes when messages change', () => {
      const message1 = createMessage({
        id: 'msg-1',
        contentParts: [{ type: 'text', text: 'Hello' }],
      })
      const message2 = createMessage({
        id: 'msg-2',
        contentParts: [{ type: 'text', text: 'Hello world, how are you doing today?' }],
      })

      const { result, rerender } = renderHook(
        ({ constructedMessage }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage,
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { constructedMessage: message1 } }
      )

      const firstTokens = result.current.currentInputTokens

      rerender({ constructedMessage: message2 })

      // Different message content should result in different token count
      expect(result.current.currentInputTokens).not.toBe(firstTokens)
    })

    it('does not let a stale long-draft result overwrite newer text', async () => {
      vi.useFakeTimers()
      const first = createDeferred<number>()
      const second = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const firstText = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const secondText = `${firstText} newer`

      const { result, rerender } = renderHook(
        ({ text }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage: createMessage({ contentParts: [{ type: 'text', text }] }),
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { text: firstText } }
      )
      advanceDraftTokenizationDebounce()
      const firstSignal = vi.mocked(tokenizeDraftOffMainThread).mock.calls[0][2]

      rerender({ text: secondText })
      expect(firstSignal.aborted).toBe(true)
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(1)

      advanceDraftTokenizationDebounce()

      await act(async () => {
        second.resolve(222)
        await second.promise
      })
      expect(result.current.currentInputTokens).toBe(222)

      await act(async () => {
        first.resolve(111)
        await first.promise
      })
      expect(result.current.currentInputTokens).toBe(222)
    })

    it('does not reuse a completed long-draft result after switching to another draft', async () => {
      vi.useFakeTimers()
      const first = createDeferred<number>()
      const second = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const longText = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const shortText = 'short'

      const { result, rerender } = renderHook(
        ({ text }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage: createMessage({ contentParts: [{ type: 'text', text }] }),
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { text: longText } }
      )
      advanceDraftTokenizationDebounce()

      await act(async () => {
        first.resolve(1234)
        await first.promise
      })
      expect(result.current.currentInputTokens).toBe(1234)

      rerender({ text: shortText })
      rerender({ text: longText })

      expect(result.current.currentInputTokens).toBe(estimateDraftTokensImmediately(longText, 'default'))
      expect(result.current.isCalculating).toBe(true)
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(1)

      advanceDraftTokenizationDebounce()
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(2)

      await act(async () => {
        second.resolve(2345)
        await second.promise
      })
      expect(result.current.currentInputTokens).toBe(2345)
      expect(result.current.isCalculating).toBe(false)
    })

    it('coalesces a long-draft typing burst into one worker for the latest text', () => {
      vi.useFakeTimers()
      const pending = createDeferred<number>()
      vi.mocked(tokenizeDraftOffMainThread).mockReturnValue(pending.promise)
      const firstText = 'a'.repeat(LONG_DRAFT_TOKENIZATION_THRESHOLD)
      const secondText = `${firstText}b`
      const latestText = `${secondText}c`

      const { rerender } = renderHook(
        ({ text }) =>
          useTokenEstimation({
            sessionId: 'session-1',
            constructedMessage: createMessage({ contentParts: [{ type: 'text', text }] }),
            contextMessages: [],
            model: undefined,
            modelSupportToolUseForFile: false,
          }),
        { initialProps: { text: firstText } }
      )

      act(() => {
        vi.advanceTimersByTime(LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS - 1)
      })
      rerender({ text: secondText })
      rerender({ text: latestText })

      expect(tokenizeDraftOffMainThread).not.toHaveBeenCalled()

      advanceDraftTokenizationDebounce()

      expect(tokenizeDraftOffMainThread).toHaveBeenCalledTimes(1)
      expect(tokenizeDraftOffMainThread).toHaveBeenCalledWith(latestText, 'default', expect.any(AbortSignal))
    })
  })
})
