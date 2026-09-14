import type { Message } from '@shared/types'
import { Loader } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function RetryingIndicator(props: {
  status: Extract<NonNullable<Message['status']>[number], { type: 'retrying' }>
}) {
  const { status } = props
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!status.retryAt) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [status.retryAt])
  const values = {
    attempt: Math.max(1, status.attempt - 1),
    maxAttempts: Math.max(1, status.maxAttempts - 1),
    seconds: Math.max(1, Math.ceil(((status.retryAt ?? now) - now) / 1000)),
  }
  const label = status.retryAt
    ? status.statusCode === 429
      ? t('Rate limited. Retrying in {{seconds}}s ({{attempt}}/{{maxAttempts}})', values)
      : !status.statusCode
        ? t('Network error. Retrying in {{seconds}}s ({{attempt}}/{{maxAttempts}})', values)
        : t('Service unavailable. Retrying in {{seconds}}s ({{attempt}}/{{maxAttempts}})', values)
    : t('Retrying request ({{attempt}}/{{maxAttempts}})', values)
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1" role="status">
      <Loader className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
