import type { Message } from '@shared/types'
import { Loader } from 'lucide-react'
import { useRetryCountdown } from '@chatbox/react/retry'
import { useTranslation } from 'react-i18next'

export function RetryingIndicator(props: {
  status: Extract<NonNullable<Message['status']>[number], { type: 'retrying' }>
}) {
  const { status } = props
  const { t } = useTranslation()
  const values = useRetryCountdown(status)
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
