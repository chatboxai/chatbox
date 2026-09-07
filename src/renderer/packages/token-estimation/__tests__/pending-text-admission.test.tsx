// @vitest-environment jsdom

import {
  SESSION_TEXT_TOKEN_VERSION,
  type SessionTextTokenRead,
  type SessionTextTokenResult,
  type SessionTextTokenSource,
} from '@chatbox/core/ports'
import type { Message } from '@shared/types/session'
import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import * as analyzer from '../analyzer'
import { ComputationQueue, computationQueue, generateTaskId } from '../computation-queue'
import { getTokenizationTextDigest } from '../draft-tokenization'
import { _resetExactTokenizationFallbacks, recordExactTokenizationFallback } from '../exact-retry'
import { type UseTokenEstimationOptions, useTokenEstimation } from '../hooks/useTokenEstimation'
import { resultPersister } from '../result-persister'

const { acceptResults } = vi.hoisted(() => ({ acceptResults: vi.fn() }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessions: { acceptSessionTextTokenResults: acceptResults } },
}))
vi.mock('../draft-tokenizer-worker-client', () => ({ tokenizeDraftOffMainThread: vi.fn() }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  cleanup()
  resultPersister.cancel()
  computationQueue._reset()
  _resetExactTokenizationFallbacks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each([
  { count: 40, reenter: false },
  { count: 100_000, reenter: false },
  { count: 40, reenter: true },
])(
  'avoids preparing queued text again across partial publications ($count messages, re-entry: $reenter)',
  async ({ count, reenter }) => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    computationQueue._reset()
    resultPersister.cancel()
    const messages: Message[] = Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      role: 'user',
      contentParts: [{ type: 'text', text: `text ${index}` }],
    }))
    const sources: Record<string, SessionTextTokenSource> = Object.fromEntries(
      messages.map((message, index) => {
        const text = `text ${index}`
        return [
          message.id,
          {
            sessionId: 's',
            messageId: message.id,
            payloadId: `s:${message.id}:00000000-0000-4000-8000-000000000000`,
            calculationVersion: SESSION_TEXT_TOKEN_VERSION,
            text,
            textDigest: getTokenizationTextDigest(text),
          },
        ]
      })
    )
    let prepareReads = 0
    let analysisReads = 0
    let analyzing = false
    const analyzeContextTokens = analyzer.analyzeContextTokens
    vi.spyOn(analyzer, 'analyzeContextTokens').mockImplementation((options) => {
      analyzing = true
      try {
        return analyzeContextTokens(options)
      } finally {
        analyzing = false
      }
    })
    const observedSources = new Proxy(sources, {
      get(target, key, receiver) {
        if (typeof key === 'string' && key in target) {
          if (analyzing) analysisReads++
          else prepareReads++
        }
        return Reflect.get(target, key, receiver)
      },
    })
    const persisted = new Map<string, number>()
    acceptResults.mockReset().mockImplementation((sessionId: string, results: SessionTextTokenResult[]) => {
      for (const { source, value } of results) {
        if (source !== sources[source.messageId]) throw new Error('Unexpected source identity')
        persisted.set(source.messageId, value.tokens)
      }
      return Promise.resolve({ sessionId, results })
    })
    const executions: string[] = []
    let allowed = 0
    let gate = deferred()
    computationQueue.setExecutor(async (task) => {
      while (executions.length >= allowed) await gate.promise
      if (!task.textSource || task.textSource === 'read-current') throw new Error('Expected paired text source')
      executions.push(task.id)
      resultPersister.addResult({
        type: 'message-text',
        sessionId: task.sessionId,
        messageId: task.messageId,
        tokenizerType: task.tokenizerType,
        textDigest: task.textDigest,
        textSource: task.textSource,
        tokens: Number(task.messageId.slice(1)) + 1,
        calculatedAt: Date.now(),
      })
      return { success: true }
    })
    const pendingLookup = vi.spyOn(resultPersister, 'hasPendingExactTextResult')
    const render = () =>
      renderHook(
        ({ contextMessages, textTokens }: { contextMessages: Message[]; textTokens: SessionTextTokenRead }) =>
          useTokenEstimation({
            sessionId: 's',
            constructedMessage: undefined,
            contextMessages,
            textTokens,
            modelSupportToolUseForFile: false,
          }),
        {
          initialProps: { contextMessages: messages, textTokens: { sources: observedSources, results: [] } },
          wrapper: count === 40 ? StrictMode : undefined,
        }
      )
    let hook = render()
    const step = Math.max(1, Math.floor(count / 100))
    const measurements: Array<{ remaining: number; analysis: number; prepare: number; persister: number }> = []
    const release = async (limit: number) => {
      allowed = limit
      const previous = gate
      gate = deferred()
      await act(async () => {
        previous.resolve()
        await vi.advanceTimersByTimeAsync(500)
        await resultPersister.flushNow()
      })
      expect(executions).toHaveLength(limit)
    }
    try {
      expect(computationQueue.getStatus()).toEqual({ pending: count - 1, running: 1 })
      if (reenter) {
        hook.unmount()
        expect(computationQueue.isSessionCancelled('s')).toBe(true)
        hook = render()
        expect(computationQueue.isSessionCancelled('s')).toBe(false)
      }
      for (let publication = 1; publication <= 3; publication++) {
        await release(step * publication)
        const contextMessages = messages.map((message) => {
          const tokens = persisted.get(message.id)
          return tokens === undefined
            ? message
            : { ...message, tokenCountMap: { default: tokens }, tokenCalculatedAt: { default: Date.now() } }
        })
        const beforePrepare = prepareReads
        const beforeAnalysis = analysisReads
        const beforeLookup = pendingLookup.mock.calls.length
        hook.rerender({ contextMessages, textTokens: { sources: observedSources, results: [] } })
        const remaining = computationQueue.getStatus().pending
        expect(remaining).toBeGreaterThanOrEqual(count * 0.9)
        measurements.push({
          remaining,
          analysis: analysisReads - beforeAnalysis,
          prepare: prepareReads - beforePrepare,
          persister: pendingLookup.mock.calls.length - beforeLookup,
        })
      }
      await release(count)
      expect(computationQueue.getStatus()).toEqual({ pending: 0, running: 0 })
      expect(executions).toEqual(
        messages.toReversed().map((message) =>
          generateTaskId({
            type: 'message-text',
            sessionId: 's',
            messageId: message.id,
            tokenizerType: 'default',
            textDigest: sources[message.id].textDigest,
            priority: 0,
          })
        )
      )
      expect(persisted.size).toBe(count)
      for (let index = 0; index < count; index++) expect(persisted.get(`m${index}`)).toBe(index + 1)
      process.stdout.write(`${JSON.stringify({ count, reenter, executions: executions.length, measurements })}\n`)
      for (const measurement of measurements) {
        expect(measurement.analysis).toBeLessThanOrEqual(count * (count === 40 ? 2 : 1))
        expect(measurement.prepare).toBeLessThanOrEqual(measurement.remaining * 0.2)
        expect(measurement.persister).toBeLessThanOrEqual(measurement.remaining * 0.2)
      }
    } finally {
      hook.unmount()
      allowed = count + 1
      gate.resolve()
      await resultPersister.flushNow()
    }
  },
  180_000
)

it('uses full text identities, retains context/model first and preserves queued payload evidence', () => {
  const source = (text: string, nonce: string): SessionTextTokenSource => ({
    sessionId: 's',
    messageId: 'm',
    payloadId: `s:m:00000000-0000-4000-8000-${nonce}`,
    calculationVersion: SESSION_TEXT_TOKEN_VERSION,
    text,
    textDigest: getTokenizationTextDigest(text),
  })
  const original = source('original', '000000000000')
  const replacement = source('original', '000000000001')
  const edited = source('edited', '000000000002')
  const message: Message = { id: 'm', role: 'user', contentParts: [{ type: 'text', text: original.text }] }
  const other: Message = { ...message, id: 'other' }
  let options: UseTokenEstimationOptions = {
    sessionId: 's',
    constructedMessage: undefined,
    contextMessages: [message, other],
    textTokens: { sources: { m: original }, results: [] },
    modelSupportToolUseForFile: false,
  }
  const retainMessages = vi.spyOn(computationQueue, 'retainOnlyMessages')
  const retainTokenizer = vi.spyOn(computationQueue, 'retainOnlyTokenizerType')
  const membership = vi.spyOn(computationQueue, 'hasPendingTask')
  const view = renderHook((input) => useTokenEstimation(input), { initialProps: options })
  const originalTask = computationQueue.getPendingTasks().find((task) => task.messageId === 'm')
  expect(originalTask?.textSource).toBe(original)
  options = { ...options, textTokens: { sources: { m: replacement }, results: [] } }
  view.rerender(options)
  expect(computationQueue.getPendingTasks().find((task) => task.messageId === 'm')).toBe(originalTask)
  expect(computationQueue.getStatus().pending).toBe(2)

  options = {
    ...options,
    contextMessages: [{ ...message, contentParts: [{ type: 'text', text: edited.text }] }, other],
    textTokens: { sources: { m: edited }, results: [] },
  }
  view.rerender(options)
  expect(computationQueue.getPendingTasks().find((task) => task.textDigest === edited.textDigest)?.textSource).toBe(
    edited
  )
  expect(computationQueue.getStatus().pending).toBe(3)
  recordExactTokenizationFallback('m', 'default', edited.textDigest)
  options = { ...options, contextMessages: options.contextMessages.map((item) => ({ ...item })) }
  view.rerender(options)
  expect(computationQueue.getPendingTasks().some((task) => task.retryAttempt === 1)).toBe(true)
  expect(computationQueue.getStatus().pending).toBe(4)

  options = { ...options, contextMessages: options.contextMessages.slice(0, 1) }
  view.rerender(options)
  expect(computationQueue.getPendingTasks().every((task) => task.messageId === 'm')).toBe(true)
  expect(computationQueue.getStatus().pending).toBe(3)
  membership.mockClear()
  options = { ...options, model: { provider: 'deepseek', modelId: 'deepseek-chat' } }
  view.rerender(options)
  expect(computationQueue.getPendingTasks()).toMatchObject([
    { messageId: 'm', tokenizerType: 'deepseek', textDigest: edited.textDigest, retryAttempt: 0 },
  ])
  expect(retainMessages.mock.invocationCallOrder.at(-1)).toBeLessThan(membership.mock.invocationCallOrder[0])
  expect(retainTokenizer.mock.invocationCallOrder.at(-1)).toBeLessThan(membership.mock.invocationCallOrder[0])
  view.rerender({ ...options, contextMessages: [] })
  expect(computationQueue.getStatus().pending).toBe(0)
})

it('keeps pending attachments on the complete preparation path', () => {
  const lookup = vi.spyOn(resultPersister, 'hasPendingExactTextResult')
  const message: Message = {
    id: 'm',
    role: 'user',
    contentParts: [{ type: 'text', text: 'text' }],
    files: [{ id: 'file', name: 'a.txt', storageKey: 'file-key', fileType: 'text/plain', lineCount: 1, byteLength: 5 }],
  }
  const options: UseTokenEstimationOptions = {
    sessionId: 's',
    constructedMessage: undefined,
    contextMessages: [message],
    modelSupportToolUseForFile: false,
  }
  const view = renderHook((input) => useTokenEstimation(input), { initialProps: options })
  lookup.mockClear()
  view.rerender({ ...options, contextMessages: [{ ...message }] })
  expect(lookup.mock.calls.map(([task]) => task.type)).toEqual(['attachment'])
  expect(computationQueue.getStatus().pending).toBe(2)
})

it('reports only pending membership across start, completion, cancellation and reset', async () => {
  const queue = new ComputationQueue()
  const input = {
    type: 'message-text' as const,
    sessionId: 's',
    messageId: 'm',
    tokenizerType: 'default' as const,
    priority: 0,
  }
  const id = generateTaskId(input)
  queue.enqueue(input)
  expect(queue.hasPendingTask(id)).toBe(true)
  const gate = deferred()
  queue.setExecutor(async () => {
    await gate.promise
    return { success: true }
  })
  expect(queue.getStatus().running).toBe(1)
  expect(queue.hasPendingTask(id)).toBe(false)
  gate.resolve()
  await gate.promise
  await Promise.resolve()
  await Promise.resolve()
  expect(queue._getState().completed.has(id)).toBe(true)
  expect(queue.hasPendingTask(id)).toBe(false)
  const next = { ...input, messageId: 'next' }
  queue._reset()
  queue.enqueue(next)
  queue.cancelBySession('s')
  expect(queue.hasPendingTask(generateTaskId(next))).toBe(false)
  queue.enqueue(next)
  expect(queue.hasPendingTask(generateTaskId(next))).toBe(true)
  queue._reset()
  expect(queue.hasPendingTask(generateTaskId(next))).toBe(false)
})
