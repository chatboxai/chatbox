import { Button } from '@mantine/core'
import { ModelProviderEnum } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SettingRow } from '@/components/settings/SettingsLayout'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Shows where the Kimi (Moonshot) search provider gets its key. Kimi search authenticates with the
 * Moonshot model provider key, so this row never edits it; it explains the state and links there.
 */
export function KimiProviderKeyRow() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const configured = useSettingsStore((state) => {
    const providers = state.providers as Record<string, { apiKey?: string } | undefined> | undefined
    const international = providers?.[ModelProviderEnum.Moonshot]?.apiKey?.trim()
    const china = providers?.[ModelProviderEnum.MoonshotCN]?.apiKey?.trim()
    return Boolean(international || china)
  })

  return (
    <SettingRow
      id="kimi-api-key"
      label={t('Kimi API Key')}
      description={
        configured
          ? t('Uses the API key configured for the Moonshot model provider.')
          : t('Add your Moonshot API key in the Moonshot model provider settings to use it here.')
      }
      control={
        <Button
          variant="default"
          size="compact-sm"
          onClick={() =>
            navigate({ to: '/settings/provider/$providerId', params: { providerId: ModelProviderEnum.Moonshot } })
          }
        >
          {t('Moonshot provider settings')}
        </Button>
      }
    />
  )
}
