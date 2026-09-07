import type { Message } from '@shared/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { AgentModeRewardError } from './AgentModeRewardError'
import { GenericMessageError } from './GenericMessageError'
import { resolveMessageErrorPresentation } from './message-error-presentation'
import { QuotaExhaustedError } from './QuotaExhaustedError'

export default function MessageErrTips(props: {
  msg: Message
  sessionId?: string
  onRetry?: () => void | Promise<void>
  isBubbleLayout?: boolean
}) {
  const { msg, sessionId, onRetry, isBubbleLayout } = props
  const licensePlan = useSettingsStore((state) => state.licenseDetail?.plan)
  const presentation = resolveMessageErrorPresentation(msg, { licensePlan })

  if (!msg.error) return null
  if (presentation.kind === 'quota') {
    return <QuotaExhaustedError msg={msg} sessionId={sessionId} licensePlan={licensePlan} presentation={presentation} />
  }
  if (presentation.kind === 'agent-mode-reward') {
    return <AgentModeRewardError msg={msg} sessionId={sessionId} onRetry={onRetry} />
  }
  return <GenericMessageError msg={msg} presentation={presentation} onRetry={onRetry} isBubbleLayout={isBubbleLayout} />
}
