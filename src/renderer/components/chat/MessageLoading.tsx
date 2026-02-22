import type { Message } from '@shared/types'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function MessageStatuses(props: { statuses: Message['status'] }) {
  const { statuses } = props
  if (!statuses || statuses.length === 0) {
    return null
  }
  return (
    <>
      {statuses.map((status, index) => (
        <MessageStatus key={index} status={status} />
      ))}
    </>
  )
}

function MessageStatus(props: { status: NonNullable<Message['status']>[number] }) {
  const { status } = props
  const { t } = useTranslation()
  if (status.type === 'sending_file') {
    return (
      <div>
        <LoadingBubble>
          <span className="flex flex-col">
            <span>{t('Reading file...')}</span>
            {status.mode && (
              <span className="text-[10px] opacity-70 font-normal">
                {status.mode === 'local' ? t('Local Mode') : t('Advanced Mode')}
              </span>
            )}
          </span>
        </LoadingBubble>
      </div>
    )
  }
  if (status.type === 'loading_webpage') {
    return (
      <div>
        <LoadingBubble>
          <span className="flex flex-col">
            <span>{t('Loading webpage...')}</span>
            {status.mode && (
              <span className="text-[10px] opacity-70 font-normal">
                {status.mode === 'local' ? t('Local Mode') : t('Advanced Mode')}
              </span>
            )}
          </span>
        </LoadingBubble>
      </div>
    )
  }
  if (status.type === 'retrying') {
    return <RetryingIndicator attempt={status.attempt} maxAttempts={status.maxAttempts} />
  }
  return null
}

function RetryingIndicator(props: { attempt: number; maxAttempts: number }) {
  const { attempt, maxAttempts } = props
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
      <Loader className="w-3 h-3 animate-spin" />
      <span>{t('Retrying {{attempt}}/{{maxAttempts}}', { attempt, maxAttempts })}</span>
    </div>
  )
}

export function LoadingBubble(props: { children: React.ReactNode }) {
  const { children } = props
  return (
    <div className="flex flex-row items-start justify-start overflow-x-auto overflow-y-hidden">
      <div
        className="flex justify-start items-center mb-1 px-1 py-2
                                                    border-solid border-blue-400/20 shadow-md rounded-lg
                                                    bg-blue-100
                                                    "
      >
        <Loader className="w-6 h-6 ml-1 mr-2 text-black animate-spin" />
        <span className="mr-4 animate-pulse font-bold text-gray-800/70">{children}</span>
      </div>
    </div>
  )
}
