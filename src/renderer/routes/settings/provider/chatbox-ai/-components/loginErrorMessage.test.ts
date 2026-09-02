import { ApiError } from '@shared/models/errors'
import { describe, expect, it } from 'vitest'
import {
  getLoginCodeVerificationErrorPresentation,
  getSendLoginCodeErrorPresentation,
  LOGIN_SUPPORT_EMAIL,
} from './loginErrorMessage'

const accountUnavailableMessage = `We can't sign you in to this account. If you believe this is a mistake, please contact ${LOGIN_SUPPORT_EMAIL}.`

const translations: Record<string, string> = {
  'Unable to Sign In': '无法登录',
  [accountUnavailableMessage]: `无法登录此账号。如果您认为这是误判，请联系 ${LOGIN_SUPPORT_EMAIL}。`,
}

const t = (key: string) => translations[key] || key

function accountUnavailableError() {
  return new ApiError(
    'Status Code 403',
    JSON.stringify({
      error: {
        code: 'account_unavailable',
        title: 'Unable to Sign In',
        detail: accountUnavailableMessage,
      },
    }),
    403
  )
}

describe('login error presentation', () => {
  it('shows the localized account-unavailable message during verification', () => {
    expect(getLoginCodeVerificationErrorPresentation(accountUnavailableError(), t)).toEqual({
      code: 'account_unavailable',
      title: '无法登录',
      message: `无法登录此账号。如果您认为这是误判，请联系 ${LOGIN_SUPPORT_EMAIL}。`,
    })
  })

  it('shows the same account-unavailable message when sending a login code', () => {
    expect(getSendLoginCodeErrorPresentation(accountUnavailableError(), t, '发送失败')).toEqual({
      code: 'account_unavailable',
      title: '无法登录',
      message: `无法登录此账号。如果您认为这是误判，请联系 ${LOGIN_SUPPORT_EMAIL}。`,
    })
  })

  it('keeps the specific invalid-code guidance', () => {
    const message =
      'The verification code you entered is incorrect or has expired. Please request a new code and try again.'
    const error = new ApiError('Status Code 400', JSON.stringify({ error: { code: 'invalid_verification_code' } }), 400)

    expect(getLoginCodeVerificationErrorPresentation(error, t)).toEqual({
      code: 'invalid_verification_code',
      message,
    })
  })
})
