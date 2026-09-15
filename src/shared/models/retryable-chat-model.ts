import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError, wrapLanguageModel } from 'ai'
import { createRetryable, isErrorAttempt } from 'ai-retry'
import { ApiError, MidStreamApiError, NetworkError, NonReplayableRequestError } from './errors'
import type { ModelStatus } from './types'

type ModelStream = Awaited<ReturnType<LanguageModelV3['doStream']>>['stream']
type ModelStreamConstructor = new (source: {
  pull(controller: { enqueue(part: LanguageModelV3StreamPart): void; close(): void }): Promise<void>
  cancel(reason: unknown): Promise<void>
}) => ModelStream

const MAX_ATTEMPTS = 5

function getStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  if (error instanceof ApiError) {
    const match = error.message.match(/Status Code (\d+)/)
    if (match) return Number(match[1])
  }
  return undefined
}

function hasNonReplayableCause(error: unknown): boolean {
  const visited = new Set<object>()
  let current = error
  while (current !== null && typeof current === 'object' && !visited.has(current)) {
    if (current instanceof NonReplayableRequestError || current instanceof MidStreamApiError) return true
    visited.add(current)
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}

export function isRetryableStatusError(error: unknown): boolean {
  if (hasNonReplayableCause(error)) return false
  const code = getStatusCode(error)
  return code !== undefined && (code === 429 || (code >= 500 && code < 600))
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (hasNonReplayableCause(error) || (error instanceof Error && error.name === 'AbortError')) return false
  const status = getStatusCode(error)
  if (status !== undefined && status !== 0) return false
  if (error instanceof NetworkError) return true
  if (APICallError.isInstance(error) && error.isRetryable) return true
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'ENOTFOUND',
        'EPIPE',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(error.code)
    )
      return true
  }
  return (
    error instanceof Error &&
    /^(?:Failed to fetch|fetch failed|Network request failed|Load failed|NetworkError when attempting to fetch resource\.?|Network disconnected)$/i.test(
      error.message
    )
  )
}

function retryAfterMs(error: unknown, now: number): number {
  const value =
    error instanceof ApiError
      ? error.retryAfter
      : APICallError.isInstance(error)
        ? Object.entries(error.responseHeaders ?? {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1]
        : undefined
  if (!value?.trim()) return 0
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000
  // HTTP dates include a weekday; do not interpret malformed numeric values as dates.
  if (!/^[A-Za-z]/.test(trimmed)) return 0
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(0, date - now) : 0
}

/** Keeps request retries and their waiting/requesting status on the same schedule. */
export function createRetryableChatModel(
  baseModel: LanguageModelV3,
  onStatus: (status: ModelStatus) => void
): LanguageModelV3 {
  const model = wrapLanguageModel({
    model: baseModel,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ doStream }) => {
        // Hosts provide Web Streams; keep the shared entrypoint independent of DOM ambient types.
        const ModelReadableStream = (globalThis as typeof globalThis & { ReadableStream: ModelStreamConstructor })
          .ReadableStream
        const result = await doStream()
        const reader = result.stream.getReader()
        let canceled = false
        // ai-retry applies its partial-output guard to error parts. Normalize hard
        // transport failures so they follow the same guard and release the failed reader.
        return {
          ...result,
          stream: new ModelReadableStream({
            async pull(controller) {
              try {
                const next = await reader.read()
                if (canceled) return
                if (next.done) {
                  reader.releaseLock()
                  controller.close()
                } else {
                  controller.enqueue(next.value)
                }
              } catch (error) {
                if (canceled) return
                reader.releaseLock()
                controller.enqueue({ type: 'error', error })
                controller.close()
              }
            },
            async cancel(reason) {
              canceled = true
              try {
                await reader.cancel(reason)
              } finally {
                reader.releaseLock()
              }
            },
          }),
        }
      },
    },
  })
  return createRetryable({
    model,
    retries: [
      (context) => {
        if (!isErrorAttempt(context.current) || context.current.options.abortSignal?.aborted) return undefined
        if (!isRetryableStatusError(context.current.error) && !isRetryableNetworkError(context.current.error))
          return undefined
        if (context.attempts.length >= MAX_ATTEMPTS) return undefined
        const now = Date.now()
        const delay = Math.max(1000 * 2 ** context.attempts.length, retryAfterMs(context.current.error, now))
        // setTimeout overflows beyond this limit and would retry immediately.
        if (!Number.isFinite(delay) || delay > 2_147_483_647) return undefined
        onStatus({
          type: 'retrying',
          attempt: context.attempts.length + 1,
          maxAttempts: MAX_ATTEMPTS,
          retryAt: now + delay,
          statusCode: getStatusCode(context.current.error),
        })
        return { model, maxAttempts: MAX_ATTEMPTS, delay, backoffFactor: 1 }
      },
    ],
    onRetry: (context) => {
      onStatus({
        type: 'retrying',
        attempt: context.attempts.length + 1,
        maxAttempts: MAX_ATTEMPTS,
        statusCode: isErrorAttempt(context.current) ? getStatusCode(context.current.error) : undefined,
      })
    },
  })
}
