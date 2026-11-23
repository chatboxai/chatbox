import dayjs from 'dayjs'
import { type ChatboxAIModelList, recordAdvancedModelListClick } from '@/packages/remote'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { isChatboxAIProTrialActive } from './chatboxCatalog'

export function useChatboxAIProTrial(license: ChatboxAIModelList['license'] | undefined) {
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  // Claiming authenticates the account that owns the license, so signed-out users keep the upgrade entry.
  const isLoggedIn = useAuthInfoStore((state) => Boolean(state.accessToken && state.refreshToken))

  return {
    canClaim: isLoggedIn && !!license?.proTrial?.canClaim,
    activeUntil: isChatboxAIProTrialActive(license)
      ? dayjs(license?.proTrial?.expiresAt).format('YYYY-MM-DD HH:mm')
      : undefined,
    reportUpgradeClick: (modelId?: string) => {
      // Trial eligibility counts upgrade clicks made on a Lite license.
      if (license?.plan !== 'lite' || !licenseKey) return
      recordAdvancedModelListClick({ licenseKey, modelId }).catch((error) => {
        console.error('Failed to record advanced model list click:', error)
      })
    },
  }
}
