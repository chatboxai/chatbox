import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Stack, Text } from '@mantine/core'
import { IconSparkles } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { CHATBOX_AI_MODELS_QUERY_KEY } from '@/hooks/useChatboxAIModels'
import { claimProTrial } from '@/packages/remote'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'

// Mirrors the backend grant; the claim response only returns the trial period.
const PRO_TRIAL_BONUS_POINTS = 800_000

const ProTrialClaim = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()
  const language = useLanguage()
  const queryClient = useQueryClient()
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [failed, setFailed] = useState(false)
  const points = new Intl.NumberFormat(language, { notation: 'compact' }).format(PRO_TRIAL_BONUS_POINTS)

  const close = () => {
    modal.resolve()
    modal.hide()
  }

  const claim = async () => {
    if (!licenseKey || claiming) return
    setClaiming(true)
    setFailed(false)
    try {
      await claimProTrial(licenseKey)
      setClaimed(true)
    } catch (error) {
      console.error('Failed to claim Pro trial:', error)
      setFailed(true)
    } finally {
      setClaiming(false)
      // Success unlocks advanced models; a rejected claim means the cached eligibility is stale.
      void queryClient.invalidateQueries({ queryKey: [CHATBOX_AI_MODELS_QUERY_KEY] })
    }
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={close}
      // Unmount after closing so the next opening, possibly for another license, starts from the offer.
      onExitTransitionEnd={modal.remove}
      centered
      title={claimed ? t('Congratulations, your trial is unlocked') : t('Try advanced models for free')}
    >
      <Stack gap="lg">
        {claimed ? (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              {t('Claimed successfully. Go try the advanced models!')}
            </Text>
            <Text size="sm" c="chatbox-secondary" lh={1.65}>
              {t('Advanced models are unlocked, and the bonus points have been added to your account.')}
            </Text>
          </Stack>
        ) : (
          <Text size="sm" c="chatbox-secondary" lh={1.65}>
            {t(
              'Unlock advanced models and get an extra {{points}} compute points to use with them. The trial lasts 7 days and ends automatically.',
              { points }
            )}
          </Text>
        )}
        {failed && (
          <Text size="sm" c="chatbox-error">
            {t('Failed to claim the trial. Please try again later.')}
          </Text>
        )}
        <AdaptiveModal.Actions>
          {claimed ? (
            <Button onClick={close}>{t('OK')}</Button>
          ) : (
            <Button loading={claiming} leftSection={<IconSparkles size={16} />} onClick={() => void claim()}>
              {t('Claim trial and bonus points')}
            </Button>
          )}
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
})

export default ProTrialClaim
