import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTokenizationTextDigest } from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, getExactTokenizationFallbackCount } from '../exact-retry'
import { ResultPersister, resultPersister } from '../result-persister'
import type { TaskResult } from '../types'

const { updateMessagesMock } = vi.hoisted(() => ({
  updateMessagesMock: vi.fn().mockResolvedValue({
    id: 'session-1',
    name: 'Test Session',
    messages: [],
  }),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { updateMessages: updateMessagesMock } },
}))

const mockSession = { id: 'session-1', name: 'Test Session', messages: [] }

function createMessageTextResult(
  overrides: Partial<NonNullable<TaskResult['result']>> = {}
): NonNullable<TaskResult['result']> {
  return {
    type: 'message-text',
    sessionId: 'session-1',
    messageId: 'msg-1',
    tokenizerType: 'default',
    tokens: 100,
    // The bare test messages carry no content parts, so their projection is ''.
    textDigest: getTokenizationTextDigest(''),
    approximate: false,
    calculatedAt: Date.now(),
    ...overrides,
  }
}

function createAttachmentResult(
  overrides: Partial<NonNullable<TaskResult['result']>> = {}
): NonNullable<TaskResult['result']> {
  return {
    type: 'attachment',
    sessionId: 'session-1',
    messageId: 'msg-1',
    attachmentId: 'att-1',
    attachmentType: 'file',
    tokenizerType: 'default',
    contentMode: 'full',
    tokens: 200,
    lineCount: 50,
    byteLength: 1024,
    calculatedAt: Date.now(),
    ...overrides,
  }
}

describe('ResultPersister', () => {
  let persister: ResultPersister

  beforeEach(() => {
    persister = new ResultPersister()
    vi.clearAllMocks()
    vi.useFakeTimers()
    _resetExactTokenizationFallbacks()
  })

  afterEach(() => {
    persister.cancel()
    _resetExactTokenizationFallbacks()
    vi.useRealTimers()
  })

  describe('addResult', () => {
    it('adds message text result to pending updates', async () => {
      persister.addResult(createMessageTextResult())
      // With throttle, first call triggers immediate flush
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('adds attachment result to pending updates', async () => {
      persister.addResult(createAttachmentResult())
      // With throttle, first call triggers immediate flush
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('merges multiple results for same message', async () => {
      persister.addResult(createMessageTextResult({ tokenizerType: 'default', tokens: 100 }))
      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ tokenizerType: 'deepseek', tokens: 150 }))
      // Second result within throttle window should be batched, not flushed yet
      expect(updateMessagesMock).not.toHaveBeenCalled()
    })

    it('keeps separate entries for different messages', async () => {
      persister.addResult(createMessageTextResult({ messageId: 'msg-1' }))
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      // Reset mock for second message
      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('merges multiple attachment results for same message', async () => {
      persister.addResult(createAttachmentResult({ attachmentId: 'att-1' }))
      vi.clearAllMocks()
      persister.addResult(createAttachmentResult({ attachmentId: 'att-2' }))
      // Second result within throttle window should be batched, not flushed yet
      expect(updateMessagesMock).not.toHaveBeenCalled()
    })

    it('updates existing attachment in pending updates', async () => {
      persister.addResult(createAttachmentResult({ attachmentId: 'att-1', tokens: 100 }))
      vi.clearAllMocks()
      persister.addResult(createAttachmentResult({ attachmentId: 'att-1', tokens: 200 }))
      // Second result within throttle window should be batched, not flushed yet
      expect(updateMessagesMock).not.toHaveBeenCalled()
    })

    it('handles preview content mode for attachments', async () => {
      persister.addResult(createAttachmentResult({ contentMode: 'preview' }))
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('throttle behavior', () => {
    it('flushes immediately on first call', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('batches results within throttle window (1000ms)', async () => {
      persister.addResult(createMessageTextResult({ messageId: 'msg-1' }))
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()

      // Add another result within 1000ms - should be batched
      vi.advanceTimersByTime(500)
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      // Don't run timers yet - the scheduled flush should happen at 1000ms
      expect(updateMessagesMock).not.toHaveBeenCalled()

      // Advance to complete the throttle window
      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      // Now the batched result should flush
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('flushes after throttle delay (1000ms) if no flush occurred', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      // Add result after throttle window expires
      vi.advanceTimersByTime(1000)
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('flushNow', () => {
    it('flushes immediately without waiting for debounce', async () => {
      persister.addResult(createMessageTextResult())
      await persister.flushNow()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('clears pending updates after flush', async () => {
      persister.addResult(createMessageTextResult())
      await persister.flushNow()
      expect(persister.getPendingCount()).toBe(0)
    })

    it('cancels pending debounce timer', async () => {
      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      vi.advanceTimersByTime(500)
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)
    })

    it('handles empty pending updates', async () => {
      await persister.flushNow()
      expect(updateMessagesMock).not.toHaveBeenCalled()
    })

    it('waits for in-progress flush to complete', async () => {
      let resolveUpdate: (() => void) | undefined
      updateMessagesMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveUpdate = () =>
              resolve(mockSession as ReturnType<typeof updateMessagesMock> extends Promise<infer T> ? T : never)
          }) as ReturnType<typeof updateMessagesMock>
      )

      persister.addResult(createMessageTextResult({ messageId: 'msg-1' }))
      const firstFlush = persister.flushNow()

      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      const secondFlush = persister.flushNow()

      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      resolveUpdate?.()
      await firstFlush
      await secondFlush

      expect(updateMessagesMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('cancel', () => {
    it('clears pending updates', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      persister.cancel()

      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).not.toHaveBeenCalled()
    })

    it('cancels pending throttle timer', async () => {
      persister.addResult(createMessageTextResult())
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ messageId: 'msg-2' }))
      persister.cancel()

      vi.advanceTimersByTime(1000)
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    it('notifies listeners after flush', async () => {
      const listener = vi.fn()
      persister.subscribe(listener)

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('returns unsubscribe function', async () => {
      const listener = vi.fn()
      const unsubscribe = persister.subscribe(listener)

      unsubscribe()

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      expect(listener).not.toHaveBeenCalled()
    })

    it('handles listener errors gracefully', async () => {
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const normalListener = vi.fn()

      persister.subscribe(errorListener)
      persister.subscribe(normalListener)

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      expect(errorListener).toHaveBeenCalled()
      expect(normalListener).toHaveBeenCalled()
    })
  })

  describe('flush behavior', () => {
    it('groups updates by sessionId', async () => {
      persister.addResult(createMessageTextResult({ sessionId: 'session-1', messageId: 'msg-1' }))
      await vi.runAllTimersAsync()
      expect(updateMessagesMock).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()
      persister.addResult(createMessageTextResult({ sessionId: 'session-1', messageId: 'msg-2' }))
      persister.addResult(createMessageTextResult({ sessionId: 'session-2', messageId: 'msg-3' }))

      await persister.flushNow()

      expect(updateMessagesMock).toHaveBeenCalledTimes(2)
      expect(updateMessagesMock).toHaveBeenCalledWith('session-1', expect.any(Function))
      expect(updateMessagesMock).toHaveBeenCalledWith('session-2', expect.any(Function))
    })

    it('handles updateMessages errors gracefully', async () => {
      updateMessagesMock.mockRejectedValueOnce(new Error('Update failed'))

      persister.addResult(createMessageTextResult({ sessionId: 'session-1' }))
      persister.addResult(createMessageTextResult({ sessionId: 'session-2' }))

      await persister.flushNow()

      expect(updateMessagesMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('update application', () => {
    it('applies message text token updates correctly', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(
        createMessageTextResult({
          messageId: 'msg-1',
          tokenizerType: 'default',
          tokens: 100,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [{ id: 'msg-1', tokenCountMap: {}, tokenCalculatedAt: {} }]
      const result = capturedUpdater?.(messages)

      expect(result).toEqual([
        {
          id: 'msg-1',
          tokenCountMap: { default: 100 },
          tokenCalculatedAt: { default: 12345 },
        },
      ])
    })

    it('applies attachment token updates correctly', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(
        createAttachmentResult({
          messageId: 'msg-1',
          attachmentId: 'att-1',
          attachmentType: 'file',
          tokenizerType: 'default',
          contentMode: 'full',
          tokens: 200,
          lineCount: 50,
          byteLength: 1024,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          files: [{ id: 'att-1', tokenCountMap: {}, tokenCalculatedAt: {} }],
        },
      ]
      const result = capturedUpdater?.(messages) as Array<{ files: unknown[] }>

      expect(result?.[0]?.files?.[0]).toEqual({
        id: 'att-1',
        tokenCountMap: { default: 200 },
        tokenCalculatedAt: { default: 12345 },
        lineCount: 50,
        byteLength: 1024,
      })
    })

    it('applies link attachment updates correctly', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(
        createAttachmentResult({
          messageId: 'msg-1',
          attachmentId: 'link-1',
          attachmentType: 'link',
          tokens: 150,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          links: [{ id: 'link-1', tokenCountMap: {}, tokenCalculatedAt: {} }],
        },
      ]
      const result = capturedUpdater?.(messages) as Array<{ links: unknown[] }>

      expect(result?.[0]?.links?.[0]).toMatchObject({
        id: 'link-1',
        tokenCountMap: { default: 150 },
        tokenCalculatedAt: { default: 12345 },
      })
    })

    it('uses preview cache key for preview content mode', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(
        createAttachmentResult({
          messageId: 'msg-1',
          attachmentId: 'att-1',
          attachmentType: 'file',
          tokenizerType: 'deepseek',
          contentMode: 'preview',
          tokens: 50,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          files: [{ id: 'att-1', tokenCountMap: {}, tokenCalculatedAt: {} }],
        },
      ]
      const result = capturedUpdater?.(messages) as Array<{ files: unknown[] }>

      expect(result?.[0]?.files?.[0]).toMatchObject({
        tokenCountMap: { deepseek_preview: 50 },
        tokenCalculatedAt: { deepseek_preview: 12345 },
      })
    })

    it('preserves existing token data when adding new', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(
        createMessageTextResult({
          messageId: 'msg-1',
          tokenizerType: 'deepseek',
          tokens: 150,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [
        {
          id: 'msg-1',
          tokenCountMap: { default: 100 },
          tokenCalculatedAt: { default: 11111 },
        },
      ]
      const result = capturedUpdater?.(messages)

      expect(result).toEqual([
        {
          id: 'msg-1',
          tokenCountMap: { default: 100, deepseek: 150 },
          tokenCalculatedAt: { default: 11111, deepseek: 12345 },
        },
      ])
    })

    it('returns empty array when messages is null', async () => {
      let capturedUpdater: ((messages: unknown[] | null) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[] | null) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(createMessageTextResult())
      await persister.flushNow()

      const result = capturedUpdater?.(null)
      expect(result).toEqual([])
    })

    it('drops a result computed against text the message no longer holds', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      // The encode ran against the original long text; the user edited the
      // message while the result sat in the worker and this throttle window.
      persister.addResult(
        createMessageTextResult({
          tokens: 80000,
          textDigest: getTokenizationTextDigest('the original long text'),
          approximate: true,
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [{ id: 'msg-1', contentParts: [{ type: 'text', text: 'now something short' }] }]
      const result = capturedUpdater?.(messages) as Array<{
        tokenCountMap?: unknown
        tokenCalculatedAt?: unknown
      }>

      expect(result?.[0]?.tokenCountMap).toBeUndefined()
      expect(result?.[0]?.tokenCalculatedAt).toBeUndefined()
      expect(
        getExactTokenizationFallbackCount('msg-1', 'default', getTokenizationTextDigest('the original long text'))
      ).toBe(0)
    })

    it('applies a result whose digest matches the current text', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(
        createMessageTextResult({
          tokens: 321,
          textDigest: getTokenizationTextDigest('the current text'),
          calculatedAt: 12345,
        })
      )
      await persister.flushNow()

      const messages = [{ id: 'msg-1', contentParts: [{ type: 'text', text: 'the current text' }] }]
      const result = capturedUpdater?.(messages)

      expect(result?.[0]).toMatchObject({
        tokenCountMap: { default: 321 },
        tokenCalculatedAt: { default: 12345 },
      })
    })

    it('marks a fallback result approximate and clears the marker on an exact overwrite', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(createMessageTextResult({ tokens: 500, approximate: true }))
      await persister.flushNow()

      const approximated = capturedUpdater?.([{ id: 'msg-1' }]) as Array<{ tokenCountApproximate?: unknown }>
      expect(approximated?.[0]?.tokenCountApproximate).toEqual({ default: true })
      expect(getExactTokenizationFallbackCount('msg-1', 'default', getTokenizationTextDigest(''))).toBe(1)

      persister.addResult(createMessageTextResult({ tokens: 480, approximate: false }))
      await persister.flushNow()

      const exact = capturedUpdater?.(approximated as unknown[]) as Array<{
        tokenCountMap?: unknown
        tokenCountApproximate?: unknown
      }>
      expect(exact?.[0]?.tokenCountMap).toMatchObject({ default: 480 })
      expect(exact?.[0]?.tokenCountApproximate).toBeUndefined()
      expect(getExactTokenizationFallbackCount('msg-1', 'default', getTokenizationTextDigest(''))).toBe(0)
    })

    it('leaves unmatched messages unchanged', async () => {
      let capturedUpdater: ((messages: unknown[]) => unknown[]) | undefined
      updateMessagesMock.mockImplementation((async (_sessionId: string, updater: unknown) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater as (messages: unknown[]) => unknown[]
        }
        return mockSession
      }) as typeof updateMessagesMock)

      persister.addResult(createMessageTextResult({ messageId: 'msg-1', tokens: 100 }))
      await persister.flushNow()

      const messages = [
        { id: 'msg-1', content: 'hello' },
        { id: 'msg-2', content: 'world' },
      ]
      const result = capturedUpdater?.(messages)

      expect(result?.[1]).toEqual({ id: 'msg-2', content: 'world' })
    })
  })
})

describe('resultPersister singleton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resultPersister.cancel()
    vi.useRealTimers()
  })

  it('is a ResultPersister instance', () => {
    expect(resultPersister).toBeInstanceOf(ResultPersister)
  })

  it('can be used directly', async () => {
    resultPersister.addResult(createMessageTextResult())
    await vi.runAllTimersAsync()
    expect(updateMessagesMock).toHaveBeenCalledTimes(1)
  })
})
