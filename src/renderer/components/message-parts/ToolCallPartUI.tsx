import { ActionIcon, alpha, Box, Code, Collapse, Group, Paper, SimpleGrid, Space, Stack, Text } from '@mantine/core'
import {
  IconArrowRight,
  IconBulb,
  IconChevronRight,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconCode,
  IconCopy,
  IconLoader,
  IconTool,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, type ReactNode, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type Message,
  type MessageReasoningPart,
  type MessageToolCallPart,
  MessageToolCallPartSchema,
} from 'src/shared/types'
import z from 'zod'
import { formatElapsedTime, useThinkingTimer } from '@/hooks/useThinkingTimer'
import { cn } from '@/lib/utils'
import { getToolName } from '@/packages/tools'
import type { SearchResultItem } from '@/packages/web-search'
import { ScalableIcon } from '../ScalableIcon'

const ToolCallHeader: FC<{ part: MessageToolCallPart; action: ReactNode; onClick: () => void }> = (props) => {
  return (
    <Paper withBorder radius="md" px="xs" onClick={props.onClick} className="cursor-pointer group">
      <Group justify="space-between" className="w-full">
        <Group gap="xs">
          <Text fw={600}>{getToolName(props.part.toolName)}</Text>
          <ScalableIcon icon={IconTool} color="var(--chatbox-tint-success)" />
          {props.part.state === 'call' ? (
            <ScalableIcon icon={IconLoader} className="animate-spin" color="var(--chatbox-tint-brand)" />
          ) : props.part.state === 'error' ? (
            <ScalableIcon icon={IconCircleXFilled} color="var(--chatbox-tint-error)" />
          ) : (
            <ScalableIcon icon={IconCircleCheckFilled} color="var(--chatbox-tint-success)" />
          )}
        </Group>
        <Space miw="xl" />
        {props.action}
      </Group>
    </Paper>
  )
}

const WebBrowsingToolCallPartSchema = MessageToolCallPartSchema.extend({
  toolName: z.literal('web_search'),
  args: z.object({
    query: z.string(),
  }),
  result: z
    .object({
      query: z.string(),
      searchResults: z.array(
        z.object({
          title: z.string(),
          snippet: z.string(),
          link: z.string(),
        })
      ),
    })
    .optional(),
})

type WebBrowsingToolCallPart = MessageToolCallPart<
  { query: string },
  { query: string; searchResults: SearchResultItem[] }
>

const getSafeExternalHref = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (!/^https?:\/\//i.test(trimmed)) {
    return null
  }

  try {
    return new URL(trimmed).toString()
  } catch (_error) {
    const encoded = trimmed.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    try {
      return new URL(encoded).toString()
    } catch (_innerError) {
      return null
    }
  }
}

const SearchResultCard: FC<{ index: number; result: SearchResultItem }> = ({ index, result }) => {
  const href = getSafeExternalHref(result.link)

  const content = (
    <Paper radius="md" p={8} bg={'var(--chatbox-background-gray-secondary)'} maw={200} title={result.title}>
      <Text size="sm" truncate="end" m={0}>
        <b>{index + 1}.</b> {result.title}
      </Text>
      <Text size="xs" truncate="end" c="chatbox-tertiary" m={0} mt={4}>
        {result.link}
      </Text>
    </Paper>
  )

  if (!href) {
    return content
  }

  return (
    <Box component="a" href={href} target="_blank" rel="noopener noreferrer" className="no-underline">
      {content}
    </Box>
  )
}

const WebSearchToolCallUI: FC<{ part: WebBrowsingToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const [expaned, setExpand] = useState(false)
  return (
    <Stack gap="xs" mb="xs">
      <ToolCallHeader
        part={part}
        onClick={() => setExpand((prev) => !prev)}
        action={
          <ScalableIcon icon={IconChevronRight} className={clsx('transition-transform', expaned ? 'rotate-90' : '')} />
        }
      />
      <Collapse in={expaned}>
        <Stack gap="xs">
          <Group gap="xs" my={2}>
            <Text c="chatbox-tertiary" m={0}>
              {t('Search query')}:
            </Text>
            <Text fw={600} size="sm" m={0} fs="italic">
              {part.args.query}
            </Text>
          </Group>
          {part.result && (
            <SimpleGrid cols={{ sm: 3, md: 4 }} spacing="xs">
              {part.result.searchResults.map((result, index) => (
                <SearchResultCard key={result.link} index={index} result={result} />
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </Collapse>
      <Collapse in={!expaned}>
        {part.result && (
          <Group gap="xs" wrap="nowrap" className="overflow-x-auto" pb="xs">
            {part.result.searchResults.map((result, index) => (
              <SearchResultCard key={result.link} index={index} result={result} />
            ))}
          </Group>
        )}
      </Collapse>
    </Stack>
  )
}

const GeneralToolCallUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const [expaned, setExpand] = useState(false)
  return (
    <Stack gap="xs" mb="xs">
      <ToolCallHeader
        part={part}
        onClick={() => setExpand((prev) => !prev)}
        action={
          <ScalableIcon icon={IconChevronRight} className={clsx('transition-transform', expaned ? 'rotate-90' : '')} />
        }
      />

      <Collapse in={expaned}>
        <Paper withBorder radius="md" p="sm">
          <Stack gap="xs">
            <Group gap="xs" c="chatbox-tertiary">
              <ScalableIcon icon={IconCode} />
              <Text fw={600} size="xs" c="chatbox-tertiary" m="0">
                {t('Arguments')}
              </Text>
            </Group>
            <Box>
              <Code block>{JSON.stringify(part.args, null, 2)}</Code>
            </Box>
          </Stack>
          {!!part.result && (
            <Stack gap="xs" className="mt-2">
              <Group gap="xs" c="chatbox-tertiary">
                <ScalableIcon icon={IconArrowRight} />
                <Text fw={600} size="xs" c="chatbox-tertiary" m="0">
                  {t('Result')}
                </Text>
              </Group>
              <Box>
                <Code block>{JSON.stringify(part.result, null, 2)}</Code>
              </Box>
            </Stack>
          )}
        </Paper>
      </Collapse>
    </Stack>
  )
}

export const ToolCallPartUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.toolName === 'web_search') {
    const parsedPart = WebBrowsingToolCallPartSchema.safeParse(part)
    if (parsedPart.success) {
      return <WebSearchToolCallUI part={parsedPart.data as WebBrowsingToolCallPart} />
    }
  }
  return <GeneralToolCallUI part={part} />
}

export const ReasoningContentUI: FC<{
  message: Message
  part?: MessageReasoningPart
  onCopyReasoningContent: (content: string) => (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ message, part, onCopyReasoningContent }) => {
  const reasoningContent = part?.text || message.reasoningContent || ''
  const { t } = useTranslation()
  const isThinking =
    (message.generating &&
      part &&
      message.contentParts &&
      message.contentParts.length > 0 &&
      message.contentParts[message.contentParts.length - 1] === part) ||
    false
  const [isExpanded, setIsExpanded] = useState<boolean>(false)

  // Timer state management:
  // - elapsedTime: Real-time updates while thinking is active (updates every 100ms)
  // - isThinking: True when message is generating AND this reasoning part is the last content part
  // - shouldShowTimer: Only show timer for streaming responses, hide for non-streaming
  const elapsedTime = useThinkingTimer(part?.startTime, isThinking)
  const shouldShowTimer = message.isStreamingMode === true // Show timer only when explicitly marked as streaming

  // Timer display logic with clear priority order:
  // 1. If we have a final duration (thinking completed), always show it (persistent display)
  // 2. If actively thinking and we have elapsed time, show real-time updates
  // 3. Otherwise show 0 (fallback for edge cases)
  // This ensures the timer stops immediately when thinking ends and persists the final duration
  const displayTime =
    part?.duration && part.duration > 0 ? part.duration : isThinking && elapsedTime > 0 ? elapsedTime : 0

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  return (
    <Paper withBorder radius="md" mb="xs">
      <Box onClick={toggleExpanded} className="cursor-pointer group">
        <Group px="xs" justify="space-between" className="w-full">
          <Group gap="xs" className={cn(isThinking ? 'animate-pulse' : '')}>
            <ScalableIcon icon={IconBulb} color="var(--chatbox-tint-warning)" />
            <Text fw={600} size="sm">
              {isThinking ? t('Thinking') : t('Deeply thought')}
            </Text>
            {reasoningContent.length > 0 && shouldShowTimer && (
              <Text size="xs" c="chatbox-tertiary">
                ({formatElapsedTime(displayTime)})
              </Text>
            )}
          </Group>
          <Space miw="xl" />
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              c="chatbox-gray"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onCopyReasoningContent(reasoningContent)(e)
              }}
              aria-label={t('Copy reasoning content')}
            >
              <ScalableIcon icon={IconCopy} />
            </ActionIcon>

            <ScalableIcon
              icon={IconChevronRight}
              className={clsx('transition-transform', isExpanded ? 'rotate-90' : '')}
            />
          </Group>
        </Group>
      </Box>

      <Collapse in={isExpanded}>
        <Box
          style={{
            borderTop: '1px solid var(--paper-border-color)',
          }}
        >
          <Text size="sm" px={'sm'} style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
            {reasoningContent}
          </Text>
        </Box>
      </Collapse>
    </Paper>
  )
}
