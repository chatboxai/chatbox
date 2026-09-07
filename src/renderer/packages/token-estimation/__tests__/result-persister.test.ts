import {
  SESSION_TEXT_TOKEN_VERSION,
  type SessionMessageDerivedPatch,
  type SessionTextTokenSource,
} from '@chatbox/core/ports'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTokenizationTextDigest } from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, getExactTokenizationFallbackCount } from '../exact-retry'
import { ResultPersister } from '../result-persister'
import type { TaskResult } from '../types'

const { patchMock, acceptMock, readMock } = vi.hoisted(() => ({
  patchMock: vi.fn(),
  acceptMock: vi.fn(),
  readMock: vi.fn(),
}))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: {
      patchSessionMessageDerivedData: patchMock,
      acceptSessionTextTokenResults: acceptMock,
      readSessionMessages: readMock,
    },
  },
}))

function textResult(overrides: Partial<NonNullable<TaskResult['result']>> = {}): NonNullable<TaskResult['result']> {
  return {
    type: 'message-text',
    sessionId: 's',
    messageId: 'm',
    tokenizerType: 'default',
    tokens: 100,
    textDigest: getTokenizationTextDigest('text'),
    calculatedAt: 100,
    ...overrides,
  }
}

function attachmentResult(
  overrides: Partial<NonNullable<TaskResult['result']>> = {}
): NonNullable<TaskResult['result']> {
  return {
    type: 'attachment',
    sessionId: 's',
    messageId: 'm',
    tokenizerType: 'default',
    attachmentId: 'a',
    attachmentType: 'file',
    sourceStorageKey: 'blob-a',
    sourceName: 'a.txt',
    contentMode: 'full',
    tokens: 200,
    lineCount: 5,
    byteLength: 50,
    calculatedAt: 100,
    ...overrides,
  }
}

describe('ResultPersister narrow writes', () => {
  let persister: ResultPersister
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    persister = new ResultPersister()
    acceptMock.mockReset().mockImplementation(async (sessionId, results) => ({ sessionId, results }))
    readMock.mockReset().mockResolvedValue(null)
    patchMock.mockReset().mockImplementation(async (sessionId: string, patches: SessionMessageDerivedPatch[]) => ({
      sessionId,
      previousRevision: 1,
      revision: 2,
      patches,
    }))
    _resetExactTokenizationFallbacks()
  })

  const source: SessionTextTokenSource = {
    sessionId: 's',
    messageId: 'm',
    payloadId: 's:m:00000000-0000-4000-8000-000000000001',
    calculationVersion: SESSION_TEXT_TOKEN_VERSION,
    textDigest: getTokenizationTextDigest('text'),
    text: 'text',
  }

  it('routes a source-bound text result only to the numerical owner, retaining attachment routing', async () => {
    persister.addResult(textResult({ textSource: source }))
    persister.addResult(attachmentResult())
    await persister.flushNow()
    expect(patchMock).toHaveBeenCalledTimes(1)
    expect(patchMock.mock.calls[0][1][0].text).toBeUndefined()
    expect(acceptMock).toHaveBeenCalledTimes(1)
    expect(acceptMock.mock.calls[0][1][0].source).toBe(source)
    expect(readMock).not.toHaveBeenCalled()
  })

  it('keeps failed numerical work pending and exact-protected, then retries without recalculation', async () => {
    acceptMock.mockRejectedValueOnce(new Error('SQL unavailable'))
    const result = textResult({ textSource: source })
    persister.addResult(result)
    await expect(persister.flushNow()).rejects.toThrow('remains pending')
    expect(persister.getPendingCount()).toBe(1)
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(acceptMock).toHaveBeenCalledTimes(1)
    await persister.flushNow()
    expect(persister.getPendingCount()).toBe(0)
    expect(acceptMock).toHaveBeenCalledTimes(2)
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('keeps flushNow pending through SQL acknowledgement and source-checked readback', async () => {
    let release!: () => void
    acceptMock.mockImplementationOnce(async (sessionId, results) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { sessionId, results }
    })
    const result = textResult({ textSource: source })
    persister.addResult(result)
    let complete = false
    const flush = persister.flushNow().then(() => {
      complete = true
    })
    await Promise.resolve()
    expect(complete).toBe(false)
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    release()
    await flush
    expect(complete).toBe(true)
  })

  it('rebinds an unchanged verified text once after attachment payload turnover; rejects changed text or deletion', async () => {
    const nextSource = { ...source, payloadId: 's:m:00000000-0000-4000-8000-000000000002' }
    acceptMock.mockResolvedValueOnce({ sessionId: 's', results: [] })
    readMock.mockResolvedValueOnce({ textTokens: { sources: { m: nextSource }, results: [] } })
    persister.addResult(textResult({ textSource: source }))
    await persister.flushNow()
    expect(acceptMock).toHaveBeenCalledTimes(2)
    expect(acceptMock.mock.calls[1][1][0].source).toBe(nextSource)
    acceptMock.mockResolvedValueOnce({ sessionId: 's', results: [] })
    readMock.mockResolvedValueOnce({ textTokens: { sources: { m: { ...nextSource, text: 'edited' } }, results: [] } })
    persister.addResult(textResult({ textSource: source, calculatedAt: 200 }))
    await persister.flushNow()
    expect(acceptMock).toHaveBeenCalledTimes(3)
    expect(persister.getPendingCount()).toBe(0)
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('does not resurrect cancelled numerical pending work after an in-flight failure', async () => {
    let reject!: (reason: Error) => void
    acceptMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    persister.addResult(textResult({ textSource: source }))
    const flush = persister.flushNow()
    persister.cancel()
    reject(new Error('SQL unavailable'))
    await flush
    expect(persister.getPendingCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(acceptMock).toHaveBeenCalledTimes(1)
  })
  afterEach(() => {
    persister.cancel()
    vi.useRealTimers()
    _resetExactTokenizationFallbacks()
  })

  it('protects only exact text with the same session, message, tokenizer and source digest', () => {
    const result = textResult()
    persister.addResult(result)
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    for (const changed of [
      { sessionId: 'different' },
      { messageId: 'different' },
      { tokenizerType: 'deepseek' as const },
      { textDigest: getTokenizationTextDigest('edited') },
      { textDigest: undefined },
    ])
      expect(persister.hasPendingExactTextResult({ ...result, ...changed })).toBe(false)
    expect(persister.hasPendingExactTextResult(attachmentResult())).toBe(false)
    persister.addResult(textResult({ approximate: true, calculatedAt: 101 }))
    expect(persister.hasPendingExactTextResult(result)).toBe(false)
    persister.addResult(textResult({ calculatedAt: 102 }))
    const retry = { ...result, retryAttempt: 1 }
    expect(persister.hasPendingExactTextResult(retry)).toBe(true)
    persister.cancel()
    expect(persister.hasPendingExactTextResult(result)).toBe(false)
  })

  it('keeps late pending results protected after the same identity finishes its in-flight flush', async () => {
    let release!: () => void
    patchMock.mockImplementationOnce(async (sessionId: string, patches: SessionMessageDerivedPatch[]) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { sessionId, patches, previousRevision: 1, revision: 2 }
    })
    const result = textResult()
    persister.addResult(result)
    await vi.advanceTimersByTimeAsync(1000)
    expect(persister.getPendingCount()).toBe(0)
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    persister.addResult(textResult({ calculatedAt: 200 }))
    release()
    await vi.advanceTimersByTimeAsync(1)
    expect(persister.getPendingCount()).toBe(1)
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    await persister.flushNow()
    expect(patchMock).toHaveBeenCalledTimes(2)
    expect(persister.hasPendingExactTextResult(result)).toBe(false)
  })

  it('does not treat cancel as cancellation of a commit already in flight', async () => {
    let release!: () => void
    patchMock.mockImplementationOnce(async (sessionId: string, patches: SessionMessageDerivedPatch[]) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { sessionId, patches, previousRevision: 1, revision: 2 }
    })
    const result = textResult()
    persister.addResult(result)
    await vi.advanceTimersByTimeAsync(1000)
    persister.addResult(textResult({ messageId: 'pending' }))
    persister.cancel()
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    expect(persister.hasPendingExactTextResult(textResult({ messageId: 'pending' }))).toBe(false)
    release()
    await persister.flushNow()
    expect(persister.hasPendingExactTextResult(result)).toBe(false)
  })

  it.each(['failure', 'rejected'] as const)('releases exact protection after a %s result', async (outcome) => {
    if (outcome === 'failure') patchMock.mockRejectedValueOnce(new Error('write failed'))
    else patchMock.mockResolvedValueOnce({ sessionId: 's', patches: [], previousRevision: 1, revision: 1 })
    const result = textResult()
    persister.addResult(result)
    expect(persister.hasPendingExactTextResult(result)).toBe(true)
    await persister.flushNow()
    expect(persister.hasPendingExactTextResult(result)).toBe(false)
    expect(getExactTokenizationFallbackCount('m', 'default', getTokenizationTextDigest('text'))).toBe(0)
    persister.addResult(textResult({ calculatedAt: 200 }))
    await persister.flushNow()
    expect(patchMock).toHaveBeenCalledTimes(2)
  })

  it('batches by session and message ID, retaining each tokenizer and its source digest', async () => {
    persister.addResult(textResult())
    persister.addResult(textResult({ tokenizerType: 'deepseek', tokens: 70 }))
    persister.addResult(textResult({ messageId: 'other' }))
    persister.addResult(textResult({ sessionId: 'other-session' }))
    expect(persister.getPendingCount()).toBe(3)
    expect(patchMock).not.toHaveBeenCalled()
    await persister.flushNow()
    expect(patchMock).toHaveBeenCalledTimes(2)
    expect(patchMock.mock.calls[0]).toEqual([
      's',
      [
        {
          messageId: 'm',
          text: [
            {
              tokenizerType: 'default',
              sourceDigest: getTokenizationTextDigest('text'),
              tokens: 100,
              calculatedAt: 100,
              approximate: false,
            },
            {
              tokenizerType: 'deepseek',
              sourceDigest: getTokenizationTextDigest('text'),
              tokens: 70,
              calculatedAt: 100,
              approximate: false,
            },
          ],
        },
        { messageId: 'other', text: [expect.objectContaining({ tokens: 100 })] },
      ],
    ])
    expect(persister.getPendingCount()).toBe(0)
  })

  it('keeps newest text and metadata clocks when results arrive out of order', async () => {
    persister.addResult(textResult({ tokens: 120, calculatedAt: 120 }))
    persister.addResult(textResult({ tokens: 0, calculatedAt: 90 }))
    persister.addResult(attachmentResult({ tokens: 120, calculatedAt: 120 }))
    persister.addResult(
      attachmentResult({ contentMode: 'preview', tokens: 0, calculatedAt: 90, lineCount: 0, byteLength: 0 })
    )
    await persister.flushNow()
    expect(patchMock.mock.calls[0][1][0]).toEqual({
      messageId: 'm',
      text: [expect.objectContaining({ tokens: 120, calculatedAt: 120 })],
      attachments: [
        {
          id: 'a',
          type: 'file',
          sourceStorageKey: 'blob-a',
          sourceName: 'a.txt',
          tokenCountMap: { default: 120, default_preview: 0 },
          tokenCalculatedAt: { default: 120, default_preview: 90 },
          metadataCalculatedAt: 120,
          lineCount: 5,
          byteLength: 50,
        },
      ],
    })
  })

  it('keeps each text source digest while retaining its newest calculation', async () => {
    const currentDigest = getTokenizationTextDigest('current')
    const oldDigest = getTokenizationTextDigest('old')
    persister.addResult(textResult({ textDigest: currentDigest, tokens: 100, calculatedAt: 100 }))
    persister.addResult(textResult({ textDigest: oldDigest, tokens: 200, calculatedAt: 200 }))
    persister.addResult(textResult({ textDigest: currentDigest, tokens: 50, calculatedAt: 50 }))
    persister.addResult(textResult({ textDigest: oldDigest, tokens: 250, calculatedAt: 250 }))
    await persister.flushNow()
    expect(patchMock.mock.calls[0][1][0].text).toEqual([
      expect.objectContaining({ sourceDigest: currentDigest, tokens: 100, calculatedAt: 100 }),
      expect.objectContaining({ sourceDigest: oldDigest, tokens: 250, calculatedAt: 250 }),
    ])
  })

  it('keeps distinct attachment identities and rejects results missing source evidence', async () => {
    persister.addResult(textResult({ textDigest: undefined }))
    persister.addResult(attachmentResult({ sourceStorageKey: undefined }))
    persister.addResult(attachmentResult({ sourceName: undefined }))
    expect(persister.getPendingCount()).toBe(0)
    persister.addResult(attachmentResult())
    persister.addResult(attachmentResult({ sourceStorageKey: 'replacement' }))
    persister.addResult(attachmentResult({ attachmentType: 'link', sourceName: 'Link' }))
    await persister.flushNow()
    expect(patchMock.mock.calls[0][1][0].attachments).toHaveLength(3)
  })

  it('updates exact retry bookkeeping only for accepted committed patches', async () => {
    const digest = getTokenizationTextDigest('text')
    patchMock.mockResolvedValueOnce({ sessionId: 's', previousRevision: 1, revision: 1, patches: [] })
    persister.addResult(textResult({ approximate: true }))
    await persister.flushNow()
    expect(getExactTokenizationFallbackCount('m', 'default', digest)).toBe(0)
    persister.addResult(textResult({ approximate: true }))
    await persister.flushNow()
    expect(getExactTokenizationFallbackCount('m', 'default', digest)).toBe(1)
    persister.addResult(textResult({ approximate: false }))
    await persister.flushNow()
    expect(getExactTokenizationFallbackCount('m', 'default', digest)).toBe(0)
  })

  it('serializes flushes and drains results added during an in-flight write', async () => {
    let release: (() => void) | undefined
    patchMock.mockImplementationOnce(async (sessionId: string, patches: SessionMessageDerivedPatch[]) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { sessionId, previousRevision: 1, revision: 2, patches }
    })
    persister.addResult(textResult())
    const flush = persister.flushNow()
    persister.addResult(textResult({ messageId: 'later' }))
    expect(patchMock).toHaveBeenCalledTimes(1)
    release?.()
    await flush
    expect(patchMock).toHaveBeenCalledTimes(2)
    expect(patchMock.mock.calls[1][1][0].messageId).toBe('later')
  })

  it('throttles writes, isolates failures and listeners, and cancels pending work', async () => {
    const broken = vi.fn(() => {
      throw new Error('listener')
    })
    const listener = vi.fn()
    persister.subscribe(broken)
    const unsubscribe = persister.subscribe(listener)
    patchMock.mockRejectedValueOnce(new Error('write failed'))
    persister.addResult(textResult({ approximate: true }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getExactTokenizationFallbackCount('m', 'default', getTokenizationTextDigest('text'))).toBe(0)
    persister.addResult(textResult())
    await vi.advanceTimersByTimeAsync(999)
    expect(patchMock).toHaveBeenCalledTimes(1)
    unsubscribe()
    persister.cancel()
    await vi.runAllTimersAsync()
    expect(patchMock).toHaveBeenCalledTimes(1)
    expect(persister.getPendingCount()).toBe(0)
  })
})
