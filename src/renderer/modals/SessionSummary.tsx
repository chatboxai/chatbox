import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { ActionIcon, Alert, Button, Drawer, Flex, Loader, Stack, Text } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from '@/components/Markdown'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useCopied } from '@/hooks/useCopied'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import {
  type SessionSummary as SessionSummaryData,
  generateSessionSummary,
  getSessionSummary,
} from '@/stores/sessionActions'
import { add as addToast } from '@/stores/toastActions'

interface Props {
  sessionId: string
}

type Status = 'idle' | 'loading' | 'success' | 'error'

const SessionSummary = NiceModal.create(({ sessionId }: Props) => {
  const modal = useModal()
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  const [status, setStatus] = useState<Status>('idle')
  const [summary, setSummary] = useState<SessionSummaryData | null>(null)
  const [stale, setStale] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const requestRef = useRef(0)

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  const runGenerate = useCallback(async () => {
    const reqId = ++requestRef.current
    setStatus('loading')
    setErrorMessage(null)
    try {
      const next = await generateSessionSummary(sessionId)
      if (requestRef.current !== reqId) return
      setSummary(next)
      setStale(false)
      setStatus('success')
    } catch (error) {
      if (requestRef.current !== reqId) return
      const message = error instanceof Error ? error.message : String(error)
      console.error('Failed to generate session summary:', error)
      setErrorMessage(message)
      setStatus('error')
      addToast(t('Failed to generate summary'))
    }
  }, [sessionId, t])

  useEffect(() => {
    if (!modal.visible) return
    let cancelled = false
    const reqId = ++requestRef.current
    setStatus('loading')
    setErrorMessage(null)
    void (async () => {
      try {
        const result = await getSessionSummary(sessionId)
        if (cancelled || requestRef.current !== reqId) return
        if (result.cached) {
          setSummary(result.cached)
          setStale(result.stale)
          setStatus('success')
        } else {
          setSummary(null)
          setStale(false)
          await runGenerate()
        }
      } catch (error) {
        if (cancelled || requestRef.current !== reqId) return
        const message = error instanceof Error ? error.message : String(error)
        console.error('Failed to load session summary:', error)
        setErrorMessage(message)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [modal.visible, sessionId, runGenerate])

  const { copied, copy } = useCopied(summary?.content ?? '')

  const isGenerating = status === 'loading'
  const showStaleBanner = status === 'success' && stale
  const showEmpty = status === 'success' && !summary
  const showError = status === 'error'

  return (
    <Drawer
      opened={modal.visible}
      onClose={onClose}
      position="right"
      size={isSmallScreen ? '100%' : 'md'}
      withCloseButton={false}
      padding={0}
      styles={{ body: { padding: 0, height: '100%' } }}
    >
      <Flex direction="column" className="h-full">
        <Flex
          align="center"
          gap="sm"
          px="md"
          py="sm"
          className="border-b border-solid border-chatbox-border-secondary"
        >
          <Text fw={600} flex={1}>
            {t('Session Summary')}
          </Text>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={28}
            onClick={() => void runGenerate()}
            disabled={isGenerating}
            aria-label={t('Regenerate') ?? 'Regenerate'}
          >
            <ScalableIcon icon={IconRefresh} size={16} className="text-inherit" />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={28}
            onClick={copy}
            disabled={!summary?.content}
            aria-label={t('Copy') ?? 'Copy'}
          >
            <ScalableIcon icon={copied ? IconCheck : IconCopy} size={16} className="text-inherit" />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={28}
            onClick={onClose}
            aria-label={t('Close') ?? 'Close'}
          >
            <ScalableIcon icon={IconX} size={16} className="text-inherit" />
          </ActionIcon>
        </Flex>

        <div className="flex-1 overflow-y-auto">
          <Stack gap="sm" p="md">
            {showStaleBanner && (
              <Alert
                color="yellow"
                icon={<IconAlertTriangle size={16} />}
                title={t('Summary may be outdated')}
              >
                <Button
                  size="compact-sm"
                  variant="light"
                  color="yellow"
                  onClick={() => void runGenerate()}
                  disabled={isGenerating}
                  leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
                >
                  {t('Regenerate')}
                </Button>
              </Alert>
            )}

            {summary && (
              <Stack gap={2}>
                <Flex gap="xs" wrap="wrap">
                  <Text size="xs" c="chatbox-tertiary">
                    {t('Generated at')}: {dayjs(summary.generatedAt).format('YYYY-MM-DD HH:mm')}
                  </Text>
                  {summary.modelId && (
                    <Text size="xs" c="chatbox-tertiary">
                      · {t('Model')}: {summary.modelId}
                    </Text>
                  )}
                </Flex>
              </Stack>
            )}

            {isGenerating && !summary && (
              <Flex direction="column" align="center" justify="center" gap="sm" py="xl">
                <Loader size="sm" />
                <Text size="sm" c="chatbox-tertiary">
                  {t('Generating summary…')}
                </Text>
              </Flex>
            )}

            {showError && !summary && (
              <Stack gap="xs">
                <Text c="chatbox-error">{t('Failed to generate summary')}</Text>
                {errorMessage && (
                  <Text size="xs" c="chatbox-tertiary" style={{ whiteSpace: 'pre-wrap' }}>
                    {errorMessage}
                  </Text>
                )}
                <Button
                  variant="light"
                  size="compact-sm"
                  onClick={() => void runGenerate()}
                  leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
                  disabled={isGenerating}
                >
                  {t('Regenerate')}
                </Button>
              </Stack>
            )}

            {showEmpty && (
              <Text size="sm" c="chatbox-tertiary">
                {t('No summary yet')}
              </Text>
            )}

            {summary && (
              <div className="break-words">
                <Markdown enableLaTeXRendering={false} enableMermaidRendering={false} hiddenCodeCopyButton>
                  {summary.content}
                </Markdown>
              </div>
            )}
          </Stack>
        </div>
      </Flex>
    </Drawer>
  )
})

export default SessionSummary
