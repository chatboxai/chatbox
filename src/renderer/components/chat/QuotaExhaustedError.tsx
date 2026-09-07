import type { ChatboxAIPlanType, Message } from '@shared/types'
import { useCallback, useEffect, useMemo } from 'react'
import type { ChatTrackingContext } from '@/analytics/chat'
import { trackTokenExhaustedCard } from '@/analytics/token-exhausted-card'
import { rendererApplication } from '@/app/renderer-application'
import { navigateToSettings } from '@/modals/settings-navigation'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import { useLanguage } from '@/stores/settingsStore'
import type { MessageErrorPresentation } from './message-error-presentation'
import { QuotaExhaustedCard } from './QuotaExhaustedCard'

type QuotaPresentation = Extract<MessageErrorPresentation, { kind: 'quota' }>

const useSession = (sessionId: string | null) => rendererApplication.sessionHooks.useSession(sessionId)

export function QuotaExhaustedError(props: {
  msg: Message
  sessionId?: string
  licensePlan?: ChatboxAIPlanType
  presentation: QuotaPresentation
}) {
  const { msg, sessionId, licensePlan, presentation } = props
  const language = useLanguage()
  const sessionQuery = useSession(sessionId ?? null)
  const trackingMode = sessionQuery.isFetched
    ? sessionQuery.session?.settings?.agentMode?.value === 'on'
      ? 'work_mode'
      : 'chat_mode'
    : undefined
  const trackingContext = useMemo<ChatTrackingContext | null>(
    () =>
      sessionId && trackingMode
        ? {
            sessionId,
            mode: trackingMode,
            provider: msg.aiProvider,
            model: msg.model,
          }
        : null,
    [msg.aiProvider, msg.model, sessionId, trackingMode]
  )
  const trackingPlan =
    presentation.cardKind === 'free-quota-exhausted' || presentation.cardKind === 'free-ocr-quota-exhausted'
      ? 'free'
      : licensePlan

  useEffect(() => {
    if (!trackingContext) return
    trackTokenExhaustedCard('exposure', {
      ...trackingContext,
      action: presentation.action,
      plan: trackingPlan,
    })
  }, [presentation.action, trackingContext, trackingPlan])

  const handleAction = useCallback(() => {
    if (trackingContext) {
      trackTokenExhaustedCard('click', {
        ...trackingContext,
        action: presentation.action,
        plan: trackingPlan,
      })
    }
    platform.openLink(
      buildChatboxUrl(`/redirect_app/view_more_plans/${language}?utm_source=app&utm_content=msg_quota_exhausted`)
    )
  }, [language, presentation.action, trackingContext, trackingPlan])

  const handleConfigureOcr = useCallback(() => {
    navigateToSettings('/default-models')
  }, [])

  return (
    <QuotaExhaustedCard
      kind={presentation.cardKind}
      action={presentation.action}
      onAction={handleAction}
      onConfigureOcr={handleConfigureOcr}
    />
  )
}
