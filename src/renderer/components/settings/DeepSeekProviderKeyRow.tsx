import { Button } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SettingRow } from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Shows where a DeepSeek-backed feature gets its key. The key lives only in the DeepSeek model provider
 * settings, so this row never edits it; it explains the state and links to the provider page.
 */
export function DeepSeekProviderKeyRow() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const configured = useSettingsStore((state) => Boolean(state.providers?.[ModelProviderEnum.DeepSeek]?.apiKey?.trim()))

  return (
    <SettingRow
      id="deepseek-api-key"
      label={t('DeepSeek API Key')}
      description={
        configured
          ? t('Uses the API key configured for the DeepSeek model provider.')
          : t('Add your DeepSeek API key in the DeepSeek model provider settings to use it here.')
      }
      control={
        <Button
          variant="default"
          size="compact-sm"
          onClick={() =>
            navigate({ to: '/settings/provider/$providerId', params: { providerId: ModelProviderEnum.DeepSeek } })
          }
        >
          {t('DeepSeek provider settings')}
        </Button>
      }
    />
  )
}
