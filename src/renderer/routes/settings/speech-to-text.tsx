import { PasswordInput, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/speech-to-text')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const extension = useSettingsStore((state) => state.extension)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const speechToText = extension.speechToText ?? {
    enabled: false,
    baseUrl: '',
    model: 'FunAudioLLM/SenseVoiceSmall',
    apiKey: '',
  }
  const update = (updates: Partial<typeof speechToText>) =>
    setSettings({
      extension: {
        ...extension,
        speechToText: { ...speechToText, ...updates },
      },
    })

  return (
    <Stack p="md" gap="xl" maw={560}>
      <Title order={5}>{t('Speech to Text')}</Title>
      <Switch
        checked={speechToText.enabled}
        label={t('Enable audio transcription')}
        onChange={(event) => update({ enabled: event.currentTarget.checked })}
      />
      <TextInput
        value={speechToText.baseUrl}
        label={t('OpenAI-compatible Base URL')}
        placeholder="http://127.0.0.1:8000/v1"
        onChange={(event) => update({ baseUrl: event.currentTarget.value })}
      />
      <TextInput
        value={speechToText.model}
        label={t('Model')}
        placeholder="FunAudioLLM/SenseVoiceSmall"
        onChange={(event) => update({ model: event.currentTarget.value })}
      />
      <PasswordInput
        value={speechToText.apiKey}
        label={t('API Key')}
        onChange={(event) => update({ apiKey: event.currentTarget.value })}
      />
      <Text size="xs" c="chatbox-gray">
        {t(
          'Audio is sent directly to this service. The service must allow browser CORS requests. Audio transcription is currently available on desktop and web only.'
        )}
      </Text>
    </Stack>
  )
}
