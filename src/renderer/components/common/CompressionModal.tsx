import { Button, Group, Stack, Text, Textarea } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import { getDefaultCompactionPrompt } from '@shared/prompts'
import type { SessionHeader } from '@shared/types/session'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { languageNameMap } from '@/i18n/locales'
import { requestManualCompaction, requestTargetedCompaction } from '@/packages/context-management/compaction'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { AdaptiveModal } from './AdaptiveModal'

interface CompressionModalProps {
  opened: boolean
  onClose: () => void
  session: Pick<SessionHeader, 'id'>
  /** Compress through this message and place the summary right after it, instead of after the latest message. */
  targetMessageId?: string
  /** One-line preview of the target message. */
  targetPreview?: string
}

export function CompressionModal({ opened, onClose, session, targetMessageId, targetPreview }: CompressionModalProps) {
  const { t } = useTranslation()

  return (
    <AdaptiveModal
      opened={opened}
      onClose={onClose}
      title={targetMessageId ? t('Compact up to here') : t('Compress Conversation')}
      centered
      size="lg"
    >
      {opened && (
        <CompressionForm
          key={session.id}
          session={session}
          targetMessageId={targetMessageId}
          targetPreview={targetPreview}
          onClose={onClose}
        />
      )}
    </AdaptiveModal>
  )
}

function CompressionForm({
  session,
  targetMessageId,
  targetPreview,
  onClose,
}: Pick<CompressionModalProps, 'session' | 'targetMessageId' | 'targetPreview' | 'onClose'>) {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)
  const configuredPrompt = useSettingsStore((state) => state.compactionPrompt)
  const defaultPrompt = configuredPrompt?.trim() || getDefaultCompactionPrompt(languageNameMap[language])
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const handleConfirm = () => {
    if (!prompt.trim() || submitting) return
    const combinedPrompt = [prompt.trim(), additionalInstructions.trim()].filter(Boolean).join('\n\n')
    // The modal stays open until the request is accepted, so a queue that cannot
    // take it leaves the prompts the user just wrote on screen.
    setSubmitting(true)
    setFailure(null)
    if (targetMessageId) {
      void requestTargetedCompaction(session.id, targetMessageId, { prompt: combinedPrompt })
        .then((outcome) => {
          if (outcome === 'busy') {
            setFailure(t('Compression could not start'))
            return
          }
          onClose()
        })
        .catch(() => setFailure(t('Compression could not start')))
        .finally(() => setSubmitting(false))
      return
    }
    void requestManualCompaction(session.id, { force: true, prompt: combinedPrompt })
      .then((outcome) => {
        if (outcome === 'queue-full') {
          setFailure(t('Message queue is full'))
          return
        }
        if (outcome === 'queue-failed') {
          setFailure(t('Failed to queue the compression'))
          return
        }
        onClose()
        if (outcome === 'queued') {
          addToast(t('Compression queued, it runs when the session is idle'))
        }
      })
      .catch((error: unknown) => {
        // A rejected request (another window holds the session work lock, or the
        // conversation read failed) must not leave the dialog looking accepted.
        setFailure(t('Compression could not start'))
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <Stack gap="md">
      <Text size="sm">
        {targetMessageId
          ? t(
              'This message (included) and everything before it will be summarized. Later messages stay as they are, and your conversation history remains available.'
            )
          : t('Summarize earlier messages to reduce context usage. Your conversation history will remain available.')}
      </Text>
      {targetMessageId && targetPreview && (
        <Text size="sm" c="chatbox-tertiary" truncate>
          {targetPreview}
        </Text>
      )}
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
      {failure && (
        <Text size="sm" c="red">
          {failure}
        </Text>
      )}
      <AdaptiveModal.Actions>
        <AdaptiveModal.CloseButton onClick={onClose} />
        <Button
          data-testid={TestId.chat.compressConfirm}
          onClick={handleConfirm}
          disabled={!prompt.trim()}
          loading={submitting}
        >
          {t('Confirm')}
        </Button>
      </AdaptiveModal.Actions>
    </Stack>
  )
}
