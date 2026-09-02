import { ChatboxAIAPIError, MESSAGE_ERROR_CODES } from '@shared/models/errors'
import type { ChatboxAIPlanType, Message } from '@shared/types'

export type QuotaCardKind =
  | 'quota-exhausted'
  | 'free-quota-exhausted'
  | 'ocr-quota-exhausted'
  | 'free-ocr-quota-exhausted'

export type QuotaCardAction = 'upgrade-plan' | 'buy-expansion-pack'

type MessageErrorDetails = {
  errorMessage: string
  requestId?: string
}

export type MessageErrorPresentation = MessageErrorDetails &
  (
    | {
        kind: 'quota'
        cardKind: QuotaCardKind
        action: QuotaCardAction
      }
    | { kind: 'agent-mode-reward' }
    | { kind: 'context-limit' }
    | { kind: 'ocr-failed'; provider: string }
    | { kind: 'api'; providerId?: string; httpStatusCode?: number }
    | { kind: 'network'; host: string }
    | { kind: 'paint-not-supported'; providerId?: string }
    | { kind: 'known-chatbox-api'; errorCode: number }
    | { kind: 'unknown' }
  )

const LEGACY_OCR_QUOTA_ERROR_CODE = MESSAGE_ERROR_CODES.FILE_PREPROCESS_FAILED
const LEGACY_FREE_OCR_QUOTA_ERROR_CODE = MESSAGE_ERROR_CODES.FILE_STORAGE_QUOTA_EXCEEDED

function isHtmlContent(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase()
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
}

function resolveErrorMessage(msg: Message): string {
  if (!msg.errorExtra?.responseBody) return msg.error || ''

  const body = String(msg.errorExtra.responseBody)
  if (isHtmlContent(body)) {
    return msg.error || 'The server returned an error page. Please try again later.'
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function resolveRequestId(msg: Message): string | undefined {
  const requestId = msg.errorExtra?.requestId
  if (typeof requestId !== 'string' || requestId.length === 0) return undefined

  const uniqueRequestIds = [
    ...new Set(
      requestId
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ]
  return uniqueRequestIds.length > 0 ? uniqueRequestIds.join(', ') : undefined
}

function resolveHttpStatusCode(msg: Message): number | undefined {
  const extraCode = msg.errorExtra?.httpStatusCode
  if (typeof extraCode === 'number' && extraCode >= 400) return extraCode

  const match = msg.error?.match(/Status Code (\d{3})/)
  return match ? Number.parseInt(match[1], 10) : undefined
}

function isContextLengthError(errorText: string | null | undefined): boolean {
  if (!errorText) return false
  const text = errorText.toLowerCase()
  return (
    text.includes('context_length_exceeded') ||
    text.includes('prompt is too long') ||
    text.includes('maximum context length') ||
    text.includes('input token limit') ||
    (text.includes('token') && text.includes('exceed') && text.includes('limit')) ||
    (text.includes('exceed') && text.includes('max_prompt_tokens'))
  )
}

function resolveQuotaCardKind(msg: Message): QuotaCardKind | undefined {
  switch (msg.errorCode) {
    case MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED:
      return 'quota-exhausted'
    case MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED:
      return 'free-quota-exhausted'
    case MESSAGE_ERROR_CODES.CHATBOX_AI_OCR_QUOTA_EXHAUSTED:
      return 'ocr-quota-exhausted'
    case MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_OCR_QUOTA_EXHAUSTED:
      return 'free-ocr-quota-exhausted'
    // Older builds may have persisted OCR quota errors with codes already owned
    // by file preprocessing. The cause code is the stable discriminator; file
    // errors do not carry it and continue through the generic Chatbox error path.
    case LEGACY_OCR_QUOTA_ERROR_CODE:
      return msg.errorExtra?.causeErrorCode === MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED
        ? 'ocr-quota-exhausted'
        : undefined
    case LEGACY_FREE_OCR_QUOTA_ERROR_CODE:
      return msg.errorExtra?.causeErrorCode === MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED
        ? 'free-ocr-quota-exhausted'
        : undefined
  }
  return undefined
}

export function resolveMessageErrorPresentation(
  msg: Message,
  options: { licensePlan?: ChatboxAIPlanType } = {}
): MessageErrorPresentation {
  const details = {
    errorMessage: resolveErrorMessage(msg),
    requestId: resolveRequestId(msg),
  }
  const cardKind = resolveQuotaCardKind(msg)
  if (cardKind) {
    const freeQuota = cardKind === 'free-quota-exhausted' || cardKind === 'free-ocr-quota-exhausted'
    const action = options.licensePlan === 'pro_plus' && !freeQuota ? 'buy-expansion-pack' : 'upgrade-plan'
    return {
      ...details,
      kind: 'quota',
      cardKind,
      action,
    }
  }

  if (msg.errorCode === MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_AGENT_MODE_QUOTA_EXHAUSTED) {
    return { ...details, kind: 'agent-mode-reward' }
  }
  if (isContextLengthError(msg.error) || isContextLengthError(details.errorMessage)) {
    return { ...details, kind: 'context-limit' }
  }
  if (msg.errorCode === MESSAGE_ERROR_CODES.OCR_FAILED || msg.error?.startsWith('OCR Error')) {
    const provider = msg.errorExtra?.aiProvider
    return { ...details, kind: 'ocr-failed', provider: typeof provider === 'string' ? provider : 'AI Provider' }
  }
  if (msg.errorCode === 10001 || msg.error?.startsWith('API Error')) {
    return {
      ...details,
      kind: 'api',
      providerId: msg.aiProvider,
      httpStatusCode: resolveHttpStatusCode(msg),
    }
  }
  if (msg.errorCode === 10002 || msg.error?.startsWith('Network Error')) {
    const host = msg.errorExtra?.host
    return { ...details, kind: 'network', host: typeof host === 'string' ? host : 'AI Provider' }
  }
  if (msg.errorCode === 10003) {
    return { ...details, kind: 'paint-not-supported', providerId: msg.aiProvider }
  }
  if (msg.errorCode && ChatboxAIAPIError.getDetail(msg.errorCode)) {
    return { ...details, kind: 'known-chatbox-api', errorCode: msg.errorCode }
  }
  return { ...details, kind: 'unknown' }
}

export function isMessageReminderPresentation(presentation: MessageErrorPresentation): boolean {
  return presentation.kind === 'quota' || presentation.kind === 'agent-mode-reward'
}
