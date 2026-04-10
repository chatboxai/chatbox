import { ApiError } from '@shared/models/errors'

type TranslateFn = (key: string) => string

type LoginRemoteErrorPayload = {
  error?: {
    code?: string
    detail?: string
    title?: string
  }
}

function parseLoginRemoteErrorPayload(error: unknown): LoginRemoteErrorPayload | null {
  const responseBody = error instanceof ApiError ? error.responseBody?.trim() : undefined
  if (responseBody) {
    try {
      return JSON.parse(responseBody) as LoginRemoteErrorPayload
    } catch {
      return null
    }
  }

  if (!(error instanceof Error)) {
    return null
  }

  const directMessage = error.message?.trim()
  if (!directMessage) {
    return null
  }

  const jsonMatch = directMessage.match(/\{[\s\S]*\}$/)
  if (!jsonMatch) {
    return null
  }

  try {
    return JSON.parse(jsonMatch[0]) as LoginRemoteErrorPayload
  } catch {
    return null
  }
}

export function getLoginCodeVerificationErrorMessage(error: unknown, t: TranslateFn) {
  const payload = parseLoginRemoteErrorPayload(error)

  switch (payload?.error?.code) {
    case 'invalid_verification_code':
      return (
        t('The verification code you entered is incorrect or has expired. Please request a new code and try again.') ||
        'The verification code you entered is incorrect or has expired. Please request a new code and try again.'
      )
    default:
      return (
        t('Unable to verify the code right now. Please try again.') ||
        'Unable to verify the code right now. Please try again.'
      )
  }
}
