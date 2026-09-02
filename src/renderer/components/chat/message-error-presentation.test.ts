import { ChatboxAIAPIError, MESSAGE_ERROR_CODES } from '@shared/models/errors'
import type { Message } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { isMessageReminderPresentation, resolveMessageErrorPresentation } from './message-error-presentation'

function message(overrides: Partial<Message>): Message {
  return {
    id: 'assistant-error',
    role: 'assistant',
    contentParts: [],
    error: 'request failed',
    ...overrides,
  } as Message
}

describe('resolveMessageErrorPresentation', () => {
  it.each([
    [MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED, 'quota-exhausted'],
    [MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED, 'free-quota-exhausted'],
    [MESSAGE_ERROR_CODES.CHATBOX_AI_OCR_QUOTA_EXHAUSTED, 'ocr-quota-exhausted'],
    [MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_OCR_QUOTA_EXHAUSTED, 'free-ocr-quota-exhausted'],
  ] as const)('maps quota code %s to %s', (errorCode, cardKind) => {
    expect(resolveMessageErrorPresentation(message({ errorCode }))).toMatchObject({ kind: 'quota', cardKind })
  })

  it('distinguishes upgrade and expansion-pack actions from the stable plan code', () => {
    const msg = message({ errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED })

    expect(resolveMessageErrorPresentation(msg, { licensePlan: 'pro' })).toMatchObject({
      kind: 'quota',
      action: 'upgrade-plan',
    })
    expect(resolveMessageErrorPresentation(msg, { licensePlan: 'pro_plus' })).toMatchObject({
      kind: 'quota',
      action: 'buy-expansion-pack',
    })
  })

  it('keeps Free quota tracking stable when no license detail is available', () => {
    expect(
      resolveMessageErrorPresentation(message({ errorCode: MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED }))
    ).toMatchObject({
      kind: 'quota',
      action: 'upgrade-plan',
    })
  })

  it.each([
    [MESSAGE_ERROR_CODES.FILE_PREPROCESS_FAILED, MESSAGE_ERROR_CODES.CHATBOX_AI_QUOTA_EXHAUSTED, 'ocr-quota-exhausted'],
    [
      MESSAGE_ERROR_CODES.FILE_STORAGE_QUOTA_EXCEEDED,
      MESSAGE_ERROR_CODES.CHATBOX_AI_FREE_QUOTA_EXHAUSTED,
      'free-ocr-quota-exhausted',
    ],
  ] as const)('recognizes legacy OCR code %s only with cause %s', (errorCode, causeErrorCode, cardKind) => {
    expect(resolveMessageErrorPresentation(message({ errorCode, errorExtra: { causeErrorCode } }))).toMatchObject({
      kind: 'quota',
      cardKind,
    })
  })

  it.each(['file_preprocess_failed', 'file_storage_quota_exceeded'] as const)(
    'does not render the %s backend error as an OCR quota card',
    (codeName) => {
      const error = ChatboxAIAPIError.fromCodeName('failed', codeName)
      expect(error).not.toBeNull()

      const presentation = resolveMessageErrorPresentation(message({ error: error?.message, errorCode: error?.code }))

      expect(presentation).toMatchObject({ kind: 'known-chatbox-api', errorCode: error?.code })
      expect(isMessageReminderPresentation(presentation)).toBe(false)
    }
  )

  it('resolves normalized generic error variants before rendering', () => {
    expect(
      resolveMessageErrorPresentation(
        message({ error: 'provider failed', errorCode: 10001, errorExtra: { httpStatusCode: 429 } })
      )
    ).toMatchObject({ kind: 'api', httpStatusCode: 429 })
    expect(
      resolveMessageErrorPresentation(message({ error: 'offline', errorCode: 10002, errorExtra: { host: 'api.test' } }))
    ).toMatchObject({ kind: 'network', host: 'api.test' })
    expect(resolveMessageErrorPresentation(message({ error: 'OCR failed', errorCode: 10006 }))).toMatchObject({
      kind: 'ocr-failed',
    })
  })

  it('keeps unrelated failures in the unknown presentation', () => {
    const presentation = resolveMessageErrorPresentation(message({ errorCode: 99999 }))

    expect(presentation.kind).toBe('unknown')
    expect(isMessageReminderPresentation(presentation)).toBe(false)
  })
})
