import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loginOrSignupWithEmailCode, sendEmailLoginCode } from '@/packages/remote'
import { EMAIL_CODE_RESEND_SECONDS } from './constants'
import { getLoginCodeVerificationErrorMessage } from './loginErrorMessage'
import type { LoginState } from './types'

interface UseLoginParams {
  language: string
  onLoginSuccess: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>
}

function getReadableErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback
  }

  const directMessage = error.message?.trim()
  if (!directMessage) {
    return fallback
  }

  const jsonMatch = directMessage.match(/\{[\s\S]*\}$/)
  if (!jsonMatch) {
    return directMessage
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      error?: {
        detail?: string
        title?: string
      }
    }

    return parsed.error?.detail || parsed.error?.title || directMessage
  } catch {
    return directMessage
  }
}

const getLanguagePath = (language: string) => {
  return language === 'zh-Hans' || language === 'zh-Hant' ? 'zh' : language.toLowerCase()
}

export function useLogin({ language, onLoginSuccess }: UseLoginParams) {
  const { t } = useTranslation()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loginState, setLoginState] = useState<LoginState>('idle')
  const [loginError, setLoginError] = useState<string>('')
  const [countdown, setCountdown] = useState(0)
  const [hasEnteredCodeStep, setHasEnteredCodeStep] = useState(false)
  const requestEpochRef = useRef(0)

  const invalidatePendingRequests = useCallback(() => {
    requestEpochRef.current += 1
  }, [])

  const updateEmail = useCallback(
    (nextEmail: string) => {
      setEmail(nextEmail)

      if (hasEnteredCodeStep && countdown <= 0) {
        setCode('')
        setLoginError('')
        setLoginState('idle')
        setHasEnteredCodeStep(false)
      }
    },
    [countdown, hasEnteredCodeStep]
  )

  useEffect(() => {
    if (countdown <= 0) return

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [countdown])

  const sendCode = useCallback(async () => {
    const requestEpoch = requestEpochRef.current
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setLoginError(t('Please enter your email address') || 'Please enter your email address')
      setLoginState('error')
      return false
    }

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    if (!isValidEmail) {
      setLoginError(t('Please enter a valid email address') || 'Please enter a valid email address')
      setLoginState('error')
      return false
    }

    try {
      setLoginState('sending_code')
      setLoginError('')
      setCode('')

      const result = await sendEmailLoginCode({
        email: trimmedEmail,
        lang: getLanguagePath(language),
      })

      if (requestEpoch !== requestEpochRef.current) {
        return false
      }

      if (result !== 'sent') {
        throw new Error('Failed to send login code')
      }

      setLoginState('code_sent')
      setHasEnteredCodeStep(true)
      setCountdown(EMAIL_CODE_RESEND_SECONDS)
      return true
    } catch (error: unknown) {
      if (requestEpoch !== requestEpochRef.current) {
        return false
      }

      console.error('Failed to send login code:', error)
      const errorMsg = getReadableErrorMessage(error, t('Failed to send login code'))
      setLoginError(errorMsg)
      setLoginState('error')
      return false
    }
  }, [email, language, t])

  const verifyCode = useCallback(async () => {
    const requestEpoch = requestEpochRef.current
    const trimmedEmail = email.trim()
    const trimmedCode = code.trim()

    if (!trimmedEmail) {
      setLoginError(t('Please enter your email address') || 'Please enter your email address')
      setLoginState('error')
      return false
    }

    if (trimmedCode.length !== 6) {
      setLoginError(t('Please enter the 6-digit verification code') || 'Please enter the 6-digit verification code')
      setLoginState('error')
      return false
    }

    try {
      setLoginState('verifying_code')
      setLoginError('')

      const tokens = await loginOrSignupWithEmailCode({
        email: trimmedEmail,
        code: trimmedCode,
      })

      if (requestEpoch !== requestEpochRef.current) {
        return false
      }

      await onLoginSuccess(tokens)

      if (requestEpoch !== requestEpochRef.current) {
        return false
      }

      setLoginState('success')
      return true
    } catch (error: unknown) {
      if (requestEpoch !== requestEpochRef.current) {
        return false
      }

      console.error('Failed to verify login code:', error)
      const errorMsg = getLoginCodeVerificationErrorMessage(error, t)
      setLoginError(errorMsg)
      setLoginState('error')
      return false
    }
  }, [code, email, onLoginSuccess, t])

  const reset = useCallback(() => {
    invalidatePendingRequests()
    setCode('')
    setLoginError('')
    setLoginState('idle')
    setCountdown(0)
    setHasEnteredCodeStep(false)
  }, [invalidatePendingRequests])

  const canSendCode = useMemo(() => {
    return Boolean(email.trim()) && countdown === 0 && loginState !== 'sending_code' && loginState !== 'verifying_code'
  }, [countdown, email, loginState])

  const canVerifyCode = useMemo(() => {
    return (
      Boolean(email.trim()) &&
      code.trim().length === 6 &&
      loginState !== 'sending_code' &&
      loginState !== 'verifying_code'
    )
  }, [code, email, loginState])

  return {
    email,
    setEmail: updateEmail,
    code,
    setCode,
    loginError,
    loginState,
    countdown,
    hasEnteredCodeStep,
    canSendCode,
    canVerifyCode,
    sendCode,
    verifyCode,
    reset,
  }
}
