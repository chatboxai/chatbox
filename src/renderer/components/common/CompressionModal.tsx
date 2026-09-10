import { Button, Group, Stack, Text, Textarea } from '@mantine/core'
import { getDefaultCompactionPrompt } from '@shared/prompts'
import type { Session } from '@shared/types/session'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { languageNameMap } from '@/i18n/locales'
import { runCompactionWithUIState } from '@/packages/context-management/compaction'
import { useSettingsStore } from '@/stores/settingsStore'
import { AdaptiveModal } from './AdaptiveModal'

interface CompressionModalProps {
  opened: boolean
  onClose: () => void
  session: Session
}

export function CompressionModal({ opened, onClose, session }: CompressionModalProps) {
  const { t } = useTranslation()

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title={t('Compress Conversation')} centered size="lg">
      {opened && <CompressionForm key={session.id} session={session} onClose={onClose} />}
    </AdaptiveModal>
  )
}

function CompressionForm({ session, onClose }: Pick<CompressionModalProps, 'session' | 'onClose'>) {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)
  const configuredPrompt = useSettingsStore((state) => state.compactionPrompt)
  const defaultPrompt = configuredPrompt?.trim() || getDefaultCompactionPrompt(languageNameMap[language])
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [additionalInstructions, setAdditionalInstructions] = useState('')

  const handleConfirm = () => {
    if (!prompt.trim()) return
    const combinedPrompt = [prompt.trim(), additionalInstructions.trim()].filter(Boolean).join('\n\n')
    onClose()
    void runCompactionWithUIState(session.id, { force: true, prompt: combinedPrompt })
  }

  return (
    <Stack gap="md">
      <Text size="sm">
        {t('Summarize earlier messages to reduce context usage. Your conversation history will remain available.')}
      </Text>
      <Stack gap="xs">
        <Textarea
          label={t('Compaction Prompt')}
          description={t('Changes here apply only to this compression.')}
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          autosize
          minRows={6}
          maxRows={12}
        />
        <Group justify="flex-end">
          <Button variant="subtle" size="xs" onClick={() => setPrompt(defaultPrompt)}>
            {t('Reset')}
          </Button>
        </Group>
      </Stack>
      <Textarea
        label={t('Additional Instructions')}
        placeholder={t('For example, preserve all file paths and unfinished tasks.') || ''}
        value={additionalInstructions}
        onChange={(event) => setAdditionalInstructions(event.currentTarget.value)}
        autosize
        minRows={2}
        maxRows={4}
      />
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button onClick={handleConfirm} disabled={!prompt.trim()}>
          {t('Confirm')}
        </Button>
      </AdaptiveModal.Actions>
    </Stack>
  )
}
