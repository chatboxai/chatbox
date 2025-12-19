import { Button, Flex, Select, Stack, Text, TextInput } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelProviderType } from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { Modal } from '@/components/Overlay'
import { useSettingsStore } from '@/stores/settingsStore'

interface AddProviderModalProps {
  opened: boolean
  onClose: () => void
}

export function AddProviderModal({ opened, onClose }: AddProviderModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setSettings = useSettingsStore((s) => s.setSettings)
  const customProviders = useSettingsStore((s) => s.customProviders)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderMode, setNewProviderMode] = useState<ModelProviderType>(ModelProviderType.OpenAI)

  const handleAddProvider = () => {
    const pid = `custom-provider-${uuidv4()}`
    setSettings({
      customProviders: [
        ...(customProviders || []),
        {
          id: pid,
          name: newProviderName,
          type: newProviderMode,
          isCustom: true,
        },
      ],
    })
    onClose()
    navigate({
      to: '/settings/provider/$providerId',
      params: {
        providerId: pid,
      },
    })
  }

  return (
    <Modal size="sm" opened={opened} onClose={onClose} centered title={t('Add provider')}>
      <Stack gap="xs">
        <Text>{t('Name')}</Text>
        <TextInput
          value={newProviderName}
          onChange={(e) => setNewProviderName(e.currentTarget.value)}
          required
          error={!newProviderName.trim() ? t('Name is required') : ''}
        />
        <Text>{t('API Mode')}</Text>
        <Select
          value={newProviderMode}
          onChange={(value) => setNewProviderMode(value as ModelProviderType)}
          data={[
            {
              value: ModelProviderType.OpenAI,
              label: t('OpenAI API Compatible'),
            },
            {
              value: ModelProviderType.OpenAIResponses,
              label: t('OpenAI Responses API Compatible'),
            },
            {
              value: ModelProviderType.Claude,
              label: t('Claude API Compatible'),
            },
            {
              value: ModelProviderType.Gemini,
              label: t('Google Gemini API Compatible'),
            },
          ]}
        />
        <Flex justify="flex-end" gap="sm" mt="sm">
          <Button variant="light" color="chatbox-gray" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleAddProvider} disabled={!newProviderName.trim()}>
            {t('Add')}
          </Button>
        </Flex>
      </Stack>
    </Modal>
  )
}
