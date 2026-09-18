import { APICallError } from 'ai'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  ModelProviderNotFoundError,
  NetworkError,
  OCRError,
} from './errors'
import { unwrapProviderErrorPayload } from './utils/stream-error-message'

const PROVIDER_ERROR_PAYLOAD_KEYS = ['type', 'code', 'status', 'statusCode']

/**
 * Providers surface mid-stream failures (rate limits, overload, upstream outages) as
 * plain `{ message, type | code | status }` objects, optionally nested under `error`.
 */
export function isProviderErrorPayload(error: unknown): boolean {
  if (error instanceof Error) {
    return false
  }
  const payload = unwrapProviderErrorPayload(error)
  return payload !== undefined && PROVIDER_ERROR_PAYLOAD_KEYS.some((key) => key in payload)
}

/**
 * Errors produced by providers, user configuration, cancellation, or supported
 * fallbacks are user-facing outcomes rather than product defects.
 */
export function isExpectedGenerationError(error: unknown): boolean {
  return (
    error instanceof ApiError ||
    error instanceof NetworkError ||
    error instanceof ChatboxAIAPIError ||
    error instanceof AIProviderNoImplementedPaintError ||
    error instanceof ModelProviderNotFoundError ||
    APICallError.isInstance(error) ||
    (error instanceof OCRError && error.cause instanceof BaseError) ||
    isProviderErrorPayload(error)
  )
}
