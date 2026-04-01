import { Box, Button, Flex, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import type { ModelProviderEnum, ProviderInfo, ProviderSettings } from '@shared/types'
import { ModelProviderType } from '@shared/types'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { ModelList } from '@/components/ModelList'
import { buildImportedProviderSettingsUpdate } from '@/components/settings/provider/importProviderState'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

interface ImportProviderModalProps {
  opened: boolean
  onClose: () => void
  importedConfig: ProviderInfo | (ProviderSettings & { id: ModelProviderEnum }) | null
  existingProvider: ProviderInfo | null
}

// Common styles for read-only inputs
const readOnlyInputStyles = {
  label: {
    fontWeight: 'normal',
  },
  input: {
    backgroundColor: 'var(--chatbox-background-secondary)',
    border: 'none',
    color: 'var(--chatbox-tint-primary)',
    cursor: 'default',
  },
}

// Reusable read-only input component
const ReadOnlyInput = ({ label, value, ...props }: { label: string; value: string; [key: string]: any }) => {
  const { t } = useTranslation()
  return <TextInput label={t(label)} value={value} readOnly styles={readOnlyInputStyles} {...props} />
}

export function ImportProviderModal({ opened, onClose, importedConfig, existingProvider }: ImportProviderModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setSettings = useSettingsStore((s) => s.setSettings)
  const providers = useSettingsStore((s) => s.providers)
  const customProviders = useSettingsStore((s) => s.customProviders)

  // Derive form values from props directly
  const providerName =
    (importedConfig && ('name' in importedConfig ? importedConfig.name : '')) ||
    (existingProvider && 'name' in existingProvider ? existingProvider.name : '') ||
    ''
  const providerId = importedConfig?.id || ''
  const apiHost = importedConfig?.apiHost || existingProvider?.apiHost || ''
  const apiPath = importedConfig?.apiPath || ''
  const apiKey = importedConfig?.apiKey || ''
  const providerType =
    (importedConfig && 'type' in importedConfig ? importedConfig.type : undefined) ||
    (existingProvider && 'type' in existingProvider ? existingProvider.type : undefined) ||
    ModelProviderType.OpenAI

  // Filter out duplicate model IDs, fallback to existing provider models
  const allModels = importedConfig?.models || existingProvider?.models || []
  const uniqueModels = allModels.filter(
    (model, index, array) => array.findIndex((m) => m.modelId === model.modelId) === index
  )

  const handleConfirmImport = useCallback(() => {
    if (!importedConfig) return

    try {
      // 如果有 existing provider， 可能是 built-in 也可能是 custom provider，如果没有，一定是 custom provider
      setSettings(
        buildImportedProviderSettingsUpdate({
          importedConfig,
          existingProvider,
          providers,
          customProviders,
        })
      )
      addToast(t(existingProvider ? 'Provider updated successfully' : 'Provider imported successfully'))
      onClose()

      navigate({
        to: '/settings/provider/$providerId',
        params: { providerId },
      })
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('Failed to import provider'))
    }
  }, [providerId, existingProvider, providers, customProviders, setSettings, navigate, t, onClose, importedConfig])

  return (
    <AdaptiveModal
      opened={opened}
      onClose={onClose}
      title={t('Import Provider Configuration')}
      centered
      size="lg"
      styles={{
        content: {
          borderRadius: '12px',
        },
        header: {
          borderBottom: 'none',
          paddingBottom: 0,
        },
        body: {
          paddingTop: 0,
        },
      }}
    >
      <Stack gap="md">
        {/* Status alerts */}
        {existingProvider ? (
          <Flex
            align="center"
            gap="xs"
            p="sm"
            style={{
              backgroundColor: 'var(--chatbox-background-error-secondary)',
              borderRadius: '8px',
            }}
          >
            <ScalableIcon icon={IconAlertTriangle} color="var(--chatbox-tint-error)" />
            <Box flex={1}>
              <Text size="sm" fw={600} c="chatbox-error">
                {t('Provider already exists')}
              </Text>
              <Text size="sm" c="chatbox-error">
                {t('A provider with this ID already exists. Continuing will overwrite the existing configuration.')}
              </Text>
            </Box>
          </Flex>
        ) : null}

        {/* Form fields */}
        <Box>
          <Flex gap="md" mb="md">
            <ReadOnlyInput label="Provider Name" value={providerName} style={{ flex: 1 }} />
            <ReadOnlyInput label="ID" value={providerId} style={{ flex: 1 }} />
          </Flex>

          {(importedConfig?.apiHost || importedConfig?.apiPath) && (
            <Flex gap="md" mb="md">
              {importedConfig?.apiHost && <ReadOnlyInput label="API Host" value={apiHost} style={{ flex: 1 }} />}
              {importedConfig?.apiPath && <ReadOnlyInput label="API Path" value={apiPath} style={{ flex: 1 }} />}
            </Flex>
          )}

          <ReadOnlyInput label="API Key" value={apiKey} mb="md" />

          {/* Model list */}
          {importedConfig?.models && importedConfig.models.length > 0 && (
            <Box>
              <Text size="sm" fw={600} mb="xs">
                {t('Model')}
              </Text>
              <ScrollArea h={200}>
                <ModelList models={uniqueModels} showActions={false} />
              </ScrollArea>
            </Box>
          )}
        </Box>

        {/* Action buttons */}
        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onClose} />
          <Button onClick={handleConfirmImport} disabled={!providerName || !providerId}>
            {t('Save')}
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
