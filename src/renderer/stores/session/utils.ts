import { AIProviderNoImplementedPaintError, ApiError, BaseError, NetworkError, OCRError } from '@shared/models/errors'
import * as Sentry from '@shared/sentry-shim'
import type { Message, Session, SessionSettings, SessionType, Settings } from '@shared/types'
import { identity, pickBy } from 'lodash'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { uiStore } from '../uiStore'

/**
 * Get session-level web browsing setting
 * Returns user's explicit setting if set, otherwise returns the local-only default.
 */
export function getSessionWebBrowsing(sessionId: string, provider: string | undefined): boolean {
  const sessionValue = uiStore.getState().sessionWebBrowsingMap[sessionId]
  if (sessionValue !== undefined) {
    return sessionValue
  }
  return false
}

/**
 * Find target message index in session messages or threads
 * @returns Object with messages array and index, or null if not found
 */
export function findTargetMessageIndex(
  session: Session,
  targetMsgId: string
): { messages: Message[]; index: number } | null {
  let messages = session.messages
  let targetMsgIx = messages.findIndex((m) => m.id === targetMsgId)

  if (targetMsgIx <= 0) {
    if (!session.threads) {
      return null
    }
    for (const t of session.threads) {
      messages = t.messages
      targetMsgIx = messages.findIndex((m) => m.id === targetMsgId)
      if (targetMsgIx > 0) {
        break
      }
    }
    if (targetMsgIx <= 0) {
      return null
    }
  }

  return { messages, index: targetMsgIx }
}

/**
 * Initialize target message with generating state
 */
export async function initializeTargetMessage(
  targetMsg: Message,
  settings: SessionSettings,
  globalSettings: Settings,
  sessionType: SessionType | undefined
): Promise<Message> {
  return {
    ...targetMsg,
    cancel: undefined,
    aiProvider: settings.provider,
    model: await getModelDisplayName(settings, globalSettings, sessionType || 'chat'),
    generating: true,
    errorCode: undefined,
    error: undefined,
    errorExtra: undefined,
    status: [],
    firstTokenLatency: undefined,
    isStreamingMode: settings.stream !== false,
  }
}

/**
 * Handle generation error and return updated message with error info
 */
export function handleGenerationError(err: unknown, targetMsg: Message, settings: SessionSettings): Message {
  const error = !(err instanceof Error) ? new Error(`${err}`) : err
  const isExpectedOCRError = error instanceof OCRError && error.cause instanceof BaseError

  if (
    !(
      error instanceof ApiError ||
      error instanceof NetworkError ||
      error instanceof AIProviderNoImplementedPaintError ||
      isExpectedOCRError
    )
  ) {
    Sentry.captureException(error)
  }

  let errorCode: number | undefined
  if (err instanceof BaseError) {
    errorCode = err.code
  }

  const ocrError = error instanceof OCRError ? error : undefined
  const causeError = ocrError?.cause

  return {
    ...targetMsg,
    generating: false,
    cancel: undefined,
    errorCode: ocrError ? (causeError instanceof BaseError ? causeError.code : errorCode) : errorCode,
    error: `${error.message}`,
    errorExtra: pickBy(
      {
        aiProvider: ocrError ? ocrError.ocrProvider : settings.provider,
        host:
          error instanceof NetworkError ? error.host : causeError instanceof NetworkError ? causeError.host : undefined,
        responseBody:
          error instanceof ApiError
            ? error.responseBody
            : causeError instanceof ApiError
              ? causeError.responseBody
              : undefined,
        httpStatusCode:
          error instanceof ApiError
            ? error.statusCode
            : causeError instanceof ApiError
              ? causeError.statusCode
              : undefined,
        requestId:
          error instanceof BaseError
            ? error.requestId
            : causeError instanceof BaseError
              ? causeError.requestId
              : undefined,
      },
      identity
    ),
    status: [],
  }
}
