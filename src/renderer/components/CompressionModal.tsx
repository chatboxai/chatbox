import { Button, Flex, Stack, Text } from '@mantine/core'
import { IconCircleCheck } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getModel } from 'src/shared/models'
import type { OnResultChangeWithCancel } from 'src/shared/models/types'
import type { Session } from 'src/shared/types/session'
import { createModelDependencies } from '@/adapters'
import { languageNameMap } from '@/i18n/locales'
import { streamText } from '@/packages/model-calls'
import * as promptFormat from '@/packages/prompts'
import { useSessionSettings } from '@/stores/chatStore'
import { compressAndCreateThread } from '@/stores/sessionActions'
import { settingsStore } from '@/stores/settingsStore'
import { Modal } from './Overlay'
import { ScalableIcon } from './ScalableIcon'

interface CompressionModalProps {
  opened: boolean
  onClose: () => void
  session: Session
}

export function CompressionModal({ opened, onClose, session }: CompressionModalProps) {
  const { t } = useTranslation()
  const [isCompressing, setIsCompressing] = useState(false)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCompleted, setIsCompleted] = useState(false)
  const { sessionSettings: settings } = useSessionSettings(session.id)

  const lastThreeLines = useMemo(() => {
    const lines = summary.split('\n').filter((line) => line.trim() !== '')
    return lines.slice(-3).join('\n')
  }, [summary])

  const abortControllerRef = useRef<AbortController | null>(null)

  const handleConfirm = async () => {
    setIsCompressing(true)
    setError(null)
    setSummary('')

    try {
      if (!settings) {
        return null
      }

      const globalSettings = settingsStore.getState().getSettings()
      if (!session) {
        return null
      }

      const dependencies = await createModelDependencies()
      const model = getModel(settings, globalSettings, { uuid: '' }, dependencies)

      // Create summary prompt
      const messages = session.messages.slice(-(settings.maxContextMessageCount || 0))
      const promptMsgs = promptFormat.summarizeConversation(messages, languageNameMap[globalSettings.language])

      // Stream the summary
      let fullSummary = ''
      const onResultChange: OnResultChangeWithCancel = (result) => {
        const text =
          result.contentParts
            ?.filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('') || ''
        fullSummary = text
        setSummary(text)
      }
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      await streamText(
        model,
        {
          sessionId: session.id,
          messages: promptMsgs,
          onResultChangeWithCancel: onResultChange,
          providerOptions: settings.providerOptions,
        },
        abortController.signal
      )

      if (abortController.signal.aborted) {
        return
      }

      // After summary is complete, create new thread with compressed context
      await compressAndCreateThread(session.id, fullSummary)

      // Show completion message and delay closing
      setIsCompleted(true)
      setIsCompressing(false)

      // Delay closing the modal to show completion message
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err) {
      console.error('Compression failed:', err)
      setError(err instanceof Error ? err.message : 'Compression failed')
    } finally {
      setIsCompressing(false)
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }

  useEffect(() => {
    if (!opened) {
      // Reset state when modal closes
      setIsCompressing(false)
      setSummary('')
      setError(null)
      setIsCompleted(false)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [opened])

  return (
    <Modal
      opened={opened}
      onClose={
        !isCompressing && !isCompleted
          ? onClose
          : () => {
              abortControllerRef.current?.abort()
              abortControllerRef.current = null
              onClose()
            }
      }
      title={t('Compress Conversation')}
      centered
      size="md"
    >
      <Stack gap="md">
        {!isCompressing && !isCompleted && !error && (
          <>
            <Text>
              {t(
                'This will summarize the current conversation and start a new thread with the compressed context. Continue?'
              )}
            </Text>
            <Flex gap="sm" justify="flex-end">
              <Button variant="subtle" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button onClick={handleConfirm}>{t('Confirm')}</Button>
            </Flex>
          </>
        )}

        {isCompressing && (
          <Text
            size="sm"
            style={{
              whiteSpace: 'pre-wrap',
              height: '60px',
              overflow: 'hidden',
              lineHeight: '20px',
            }}
          >
            {lastThreeLines || t('Generating summary...')}
          </Text>
        )}

        {isCompleted && (
          <>
            <Flex align="center" gap="xs" mb="sm">
              <ScalableIcon icon={IconCircleCheck} size={20} color="var(--chatbox-tint-success)" />
              <Text size="sm" c="green" fw={500}>
                {t('Compression completed successfully!')}
              </Text>
            </Flex>
            <Text size="xs" c="dimmed" mt="xs">
              {t('Starting new thread...')}
            </Text>
          </>
        )}

        {error && (
          <>
            <Text c="red">{error}</Text>
            <Flex gap="sm" justify="flex-end">
              <Button onClick={onClose}>{t('Close')}</Button>
            </Flex>
          </>
        )}
      </Stack>
    </Modal>
  )
}
