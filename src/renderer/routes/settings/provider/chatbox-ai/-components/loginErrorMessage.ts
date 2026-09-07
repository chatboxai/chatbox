import { ApiError } from '@shared/models/errors'

type TranslateFn = (key: string) => string

export const LOGIN_SUPPORT_EMAIL = 'hi@chatboxai.com'

export interface LoginErrorPresentation {
  code?: string
  title?: string
  message: string
}

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

function getAccountUnavailablePresentation(
  payload: LoginRemoteErrorPayload | null,
  t: TranslateFn
): LoginErrorPresentation | null {
  if (payload?.error?.code !== 'account_unavailable') {
    return null
  }

  return {
    code: payload.error.code,
    title: t('Unable to Sign In') || 'Unable to Sign In',
    message:
      t("We can't sign you in to this account. If you believe this is a mistake, please contact hi@chatboxai.com.") ||
      `We can't sign you in to this account. If you believe this is a mistake, please contact ${LOGIN_SUPPORT_EMAIL}.`,
  }
}

function getDirectErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }

  const directMessage = error.message?.trim()
  if (!directMessage) {
    return undefined
  }

  return directMessage
}

export function getSendLoginCodeErrorPresentation(
  error: unknown,
  t: TranslateFn,
  fallback: string
): LoginErrorPresentation {
  const payload = parseLoginRemoteErrorPayload(error)
  const accountUnavailable = getAccountUnavailablePresentation(payload, t)
  if (accountUnavailable) {
    return accountUnavailable
  }

  return {
    code: payload?.error?.code,
    message: payload?.error?.detail || payload?.error?.title || getDirectErrorMessage(error) || fallback,
  }
}

export function getLoginCodeVerificationErrorPresentation(error: unknown, t: TranslateFn): LoginErrorPresentation {
  const payload = parseLoginRemoteErrorPayload(error)
  const accountUnavailable = getAccountUnavailablePresentation(payload, t)
  if (accountUnavailable) {
    return accountUnavailable
  }

  switch (payload?.error?.code) {
    case 'invalid_verification_code':
      return {
        code: payload.error.code,
        message:
          t(
            'The verification code you entered is incorrect or has expired. Please request a new code and try again.'
          ) ||
          'The verification code you entered is incorrect or has expired. Please request a new code and try again.',
      }
    default:
      return {
        code: payload?.error?.code,
        message:
          t('Unable to verify the code right now. Please try again.') ||
          'Unable to verify the code right now. Please try again.',
      }
  }
}
