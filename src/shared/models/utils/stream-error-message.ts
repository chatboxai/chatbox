import { TypeValidationError } from 'ai'

/**
 * Providers surface mid-stream failures as plain objects, either flat
 * (`{ message, type, code }`) or nested under `error` (Anthropic shape).
 * Returns the record carrying a non-empty `message`, if any.
 */
export function unwrapProviderErrorPayload(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (typeof record.message === 'string' && record.message) {
    return record
  }
  const nested = record.error
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as Record<string, unknown>
    if (typeof nestedRecord.message === 'string' && nestedRecord.message) {
      return nestedRecord
    }
  }
  return undefined
}

function messageFromPayload(value: unknown): string | undefined {
  const message = unwrapProviderErrorPayload(value)?.message
  return typeof message === 'string' ? message : undefined
}

/**
 * Extract a human-readable message from AI SDK stream error payloads.
 * Mid-stream provider errors are often plain objects (`{ message, type, code }`)
 * rather than Error instances; stringifying them yields "[object Object]".
 */
export function extractStreamErrorMessage(error: unknown): string {
  if (error == null) {
    return 'Unknown error'
  }
  if (typeof error === 'string') {
    return error
  }
  // Gateways may answer an upstream failure (e.g. 402) with an `{ error: { message } }`
  // frame inside a 200 stream. The SDK rejects it against the chunk schema, but the
  // rejected value still carries the readable upstream message.
  if (TypeValidationError.isInstance(error)) {
    const upstreamMessage = messageFromPayload(error.value)
    if (upstreamMessage) {
      return upstreamMessage
    }
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'object') {
    const message = messageFromPayload(error)
    if (message) {
      return message
    }
    try {
      return JSON.stringify(error)
    } catch {
      // fall through
    }
  }
  return String(error)
}

const STATUS_FIELDS = ['status', 'statusCode', 'code'] as const

function isHttpErrorStatus(code: number): boolean {
  return Number.isInteger(code) && code >= 400 && code < 600
}

/**
 * HTTP status carried by a stream error payload: a numeric `status` / `statusCode` /
 * `code` field, or a bracketed status inside the message (`"model — [402]: ..."`).
 */
export function extractStreamErrorStatusCode(error: unknown): number | undefined {
  const payload = unwrapProviderErrorPayload(TypeValidationError.isInstance(error) ? error.value : error)
  if (!payload) {
    return undefined
  }
  for (const field of STATUS_FIELDS) {
    const value = payload[field]
    if (typeof value === 'number' && isHttpErrorStatus(value)) {
      return value
    }
  }
  const match = typeof payload.message === 'string' ? payload.message.match(/\[(\d{3})\]/) : null
  const fromMessage = match ? Number(match[1]) : undefined
  return fromMessage !== undefined && isHttpErrorStatus(fromMessage) ? fromMessage : undefined
}
