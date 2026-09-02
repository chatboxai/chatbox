import NiceModal from '@ebay/nice-modal-react'
import type { Message } from '@shared/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  trackAgentModeFreePointsCard,
  trackAgentModeFreePointsCardClick,
  trackAgentModeFreePointsClaimSuccess,
} from '@/analytics/agent-mode'
import { AgentModeRewardResumeError, claimAgentModeRewardAndResume } from '@/packages/agent-mode-reward'
import { claimFreeAgentModeReward } from '@/packages/remote'
import { useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { AgentModeRewardQuotaCard } from './AgentModeRewardQuotaCard'

export function AgentModeRewardError(props: {
  msg: Message
  sessionId?: string
  onRetry?: () => void | Promise<void>
}) {
  const { msg, sessionId, onRetry } = props
  const { t } = useTranslation()
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const [isHandling, setIsHandling] = useState(false)
  const [claimFailed, setClaimFailed] = useState(false)
  const [rewardClaimed, setRewardClaimed] = useState(false)
  const [resumeFailed, setResumeFailed] = useState(false)
  const trackingContext = useMemo(
    () =>
      sessionId
        ? {
            sessionId,
            mode: 'work_mode' as const,
            provider: msg.aiProvider,
            model: msg.model,
          }
        : null,
    [msg.aiProvider, msg.model, sessionId]
  )

  useEffect(() => {
    if (trackingContext) trackAgentModeFreePointsCard(trackingContext)
  }, [trackingContext])

  const handleAction = useCallback(async () => {
    if (isHandling || !onRetry || !licenseKey) return
    if (!rewardClaimed && trackingContext) trackAgentModeFreePointsCardClick(trackingContext)
    setIsHandling(true)
    setClaimFailed(false)
    setResumeFailed(false)

    if (rewardClaimed) {
      try {
        await onRetry()
      } catch (error) {
        console.error('Failed to resume Agent Mode after claiming the reward:', error)
        setResumeFailed(true)
        toastActions.add(t('Reward claimed, but the task could not resume automatically. Please retry.'))
      } finally {
        setIsHandling(false)
      }
      return
    }

    try {
      await claimAgentModeRewardAndResume({
        claim: () => claimFreeAgentModeReward(licenseKey),
        showSuccess: (reward) => {
          setRewardClaimed(true)
          if (trackingContext) trackAgentModeFreePointsClaimSuccess(trackingContext)
          void NiceModal.show('agent-mode-reward-claim-success', reward).catch(() => undefined)
        },
        resume: async () => {
          await onRetry()
        },
      })
    } catch (error) {
      if (error instanceof AgentModeRewardResumeError) {
        console.error('Failed to resume Agent Mode after claiming the reward:', error.resumeCause)
        setRewardClaimed(true)
        setResumeFailed(true)
        toastActions.add(t('Reward claimed, but the task could not resume automatically. Please retry.'))
        return
      }
      console.error('Failed to claim Agent Mode reward:', error)
      setClaimFailed(true)
    } finally {
      setIsHandling(false)
    }
  }, [isHandling, licenseKey, onRetry, rewardClaimed, t, trackingContext])

  return (
    <AgentModeRewardQuotaCard
      loading={isHandling}
      claimFailed={claimFailed}
      rewardClaimed={rewardClaimed}
      resumeFailed={resumeFailed}
      onAction={handleAction}
    />
  )
}
