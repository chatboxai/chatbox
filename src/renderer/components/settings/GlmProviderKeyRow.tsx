import { Button } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SettingRow } from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Shows where the GLM (Zhipu) search provider gets its key. GLM search authenticates with the
 * GLM model provider key, so this row never edits it; it explains the state and links there.
 */
export function GlmProviderKeyRow() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const configured = useSettingsStore((state) => {
    const providers = state.providers as Record<string, { apiKey?: string } | undefined> | undefined
    const direct = providers?.[ModelProviderEnum.GLM]?.apiKey?.trim()
    const codingPlan = providers?.[ModelProviderEnum.ZhipuGLMCodingPlan]?.apiKey?.trim()
    return Boolean(direct || codingPlan)
  })

  return (
    <SettingRow
      id="glm-api-key"
      label={t('GLM API Key')}
      description={
        configured
          ? t('Uses the API key configured for the GLM model provider.')
          : t('Add your GLM API key in the GLM model provider settings to use it here.')
      }
      control={
        <Button
          variant="default"
          size="compact-sm"
          onClick={() =>
            navigate({ to: '/settings/provider/$providerId', params: { providerId: ModelProviderEnum.GLM } })
          }
        >
          {t('GLM provider settings')}
        </Button>
      }
    />
  )
}
