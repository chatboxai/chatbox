import { ActionIcon, Box, Button, Collapse, Flex, Text, Tooltip } from '@mantine/core'
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconLoader2,
  IconX,
} from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopied } from '@/hooks/useCopied'
import { runCompactionWithUIState } from '@/packages/context-management'
import { compactionUIStateMapAtom, setCompactionUIState } from '@/stores/atoms'
import { ScalableIcon } from '../common/ScalableIcon'

const MAX_CHARS = 200
const MAX_LINES = 3

function shouldTruncate(text: string): boolean {
  if (text.length > MAX_CHARS) return true
  const lineCount = text.split('\n').length
  return lineCount > MAX_LINES
}

function getTruncatedText(text: string): string {
  if (text.length > MAX_CHARS) {
    return `${text.slice(0, MAX_CHARS)}...`
  }
  const lines = text.split('\n')
  if (lines.length > MAX_LINES) {
    return `${lines.slice(0, MAX_LINES).join('\n')}...`
  }
  return text
}

interface CompactionStatusProps {
  sessionId: string
}

export const CompactionStatus = memo(function CompactionStatus({ sessionId }: CompactionStatusProps) {
  const { t } = useTranslation()
  const compactionStateMap = useAtomValue(compactionUIStateMapAtom)
  const [expanded, setExpanded] = useState(false)

  const compactionState = useMemo(() => {
    return compactionStateMap[sessionId] ?? { status: 'idle', error: null, streamingText: '' }
  }, [compactionStateMap, sessionId])

  const lastLine = useMemo(() => {
    const lines = compactionState.streamingText.split('\n').filter((line) => line.trim() !== '')
    return lines[lines.length - 1] || ''
  }, [compactionState.streamingText])

  const errorText = (compactionState.error ?? t('Compaction failed')) as string
  const { copied, copy } = useCopied(errorText)
  const isTruncated = shouldTruncate(errorText)

  const handleRetry = useCallback(() => {
    void runCompactionWithUIState(sessionId)
  }, [sessionId])

  const handleDismiss = useCallback(() => {
    setCompactionUIState(sessionId, { status: 'idle', error: null, streamingText: '' })
  }, [sessionId])

  if (compactionState.status === 'idle') {
    return null
  }

  if (compactionState.status === 'failed') {
    return (
      <Box className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 shadow-sm p-3">
        <Flex align="flex-start" justify="space-between" gap="xs">
          <Flex
            align="flex-start"
            gap="xs"
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => isTruncated && setExpanded(!expanded)}
          >
            <ScalableIcon icon={IconAlertCircle} size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            {isTruncated ? (
              <ActionIcon variant="transparent" size="xs" c="red" p={0} className="mt-0.5">
                {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              </ActionIcon>
            ) : null}
            <Text
              size="sm"
              c="red"
              className={`min-w-0 ${isTruncated && !expanded ? 'truncate' : 'whitespace-pre-wrap break-all'}`}
            >
              {isTruncated && !expanded ? getTruncatedText(errorText) : errorText}
            </Text>
          </Flex>
          <Flex align="flex-start" gap="xs" className="flex-shrink-0">
            <Button size="xs" variant="light" color="red" onClick={handleRetry}>
              {t('Retry')}
            </Button>
            <Tooltip label={t('Dismiss')}>
              <ActionIcon size="xs" variant="subtle" color="red" onClick={handleDismiss}>
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>
        {(expanded || !isTruncated) && (
          <Collapse in={expanded || !isTruncated}>
            <Flex justify="flex-end" mt="xs">
              <Tooltip label={t('Copy')} withArrow openDelay={1000}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="red"
                  onClick={(e) => {
                    e.stopPropagation()
                    copy()
                  }}
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </ActionIcon>
              </Tooltip>
            </Flex>
          </Collapse>
        )}
      </Box>
    )
  }

  return (
    <Box className="rounded-xl bg-chatbox-background-tertiary border border-chatbox-border-primary shadow-sm p-3">
      <Flex align="center" gap="xs" justify="center">
        <ScalableIcon icon={IconLoader2} size={16} className="animate-spin text-chatbox-tertiary" />
        <Text size="sm" c="chatbox-tertiary">
          {t('Compacting conversation...')}
        </Text>
      </Flex>
      {lastLine && (
        <Text size="xs" c="dimmed" className="text-center mt-1 truncate">
          {lastLine}
        </Text>
      )}
    </Box>
  )
})
