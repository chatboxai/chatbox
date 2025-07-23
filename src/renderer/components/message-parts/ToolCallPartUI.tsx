import { ActionIcon, alpha, Box, Code, Group, Paper, SimpleGrid, Space, Stack, Text, Transition } from '@mantine/core'
import {
  IconArrowRight,
  IconBulb,
  IconChevronRight,
  IconChevronUp,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconCode,
  IconCopy,
  IconLoader,
  IconTool,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type FC, type ReactNode, useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import type { Message, MessageReasoningPart, MessageToolCallPart } from 'src/shared/types'
import { cn } from '@/lib/utils'
import { getToolName } from '@/packages/tools'
import type { SearchResultItem } from '@/packages/web-search'
import { autoCollapseThinkingBlocksAtom } from '@/stores/atoms'

const ToolCallHeader: FC<{ part: MessageToolCallPart; action: ReactNode; onClick: () => void }> = (props) => {
  return (
    <Paper withBorder radius="md" px="xs" onClick={props.onClick} className="cursor-pointer group">
      <Group justify="space-between" className="w-full">
        <Group gap="xs">
          <Text fw={600}>{getToolName(props.part.toolName)}</Text>
          <IconTool size={16} color="var(--mantine-color-chatbox-success-text)" />
          {props.part.state === 'call' ? (
            <IconLoader size={16} className="animate-spin" color="var(--mantine-color-chatbox-brand-text)" />
          ) : props.part.state === 'error' ? (
            <IconCircleXFilled size={16} color="var(--mantine-color-chatbox-error-text)" />
          ) : (
            <IconCircleCheckFilled size={16} color="var(--mantine-color-chatbox-success-text)" />
          )}
        </Group>
        <Space miw="xl" />
        {props.action}
      </Group>
    </Paper>
  )
}

type WebBrowsingToolCallPart = MessageToolCallPart<
  { query: string },
  { query: string; searchResults: SearchResultItem[] }
>

const SearchResultCard: FC<{ index: number; result: SearchResultItem }> = ({ index, result }) => {
  return (
    <Link to={result.link} target="_blank" className="no-underline">
      <Paper radius="md" p={8} bg={alpha('var(--mantine-color-gray-6)', 0.1)} maw={200} title={result.title}>
        <Text size="sm" truncate="end" m={0}>
          <b>{index + 1}.</b> {result.title}
        </Text>
        <Text size="xs" truncate="end" c="chatbox-tertiary" m={0} mt={4}>
          {result.link}
        </Text>
      </Paper>
    </Link>
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
        action={expaned ? <IconChevronUp size={16} /> : <IconChevronRight size={16} />}
      />
      <Transition transition="fade-down" duration={100} mounted={expaned}>
        {(transitionStyle) => (
          <Stack gap="xs" style={{ ...transitionStyle, zIndex: 1 }}>
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
        )}
      </Transition>
      {!expaned && part.result && (
        <Group gap="xs" wrap="nowrap" className="overflow-x-auto" pb="xs">
          {part.result.searchResults.map((result, index) => (
            <SearchResultCard key={result.link} index={index} result={result} />
          ))}
        </Group>
      )}
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
        action={expaned ? <IconChevronUp size={16} /> : <IconChevronRight size={16} />}
      />

      <Transition transition="fade-down" duration={100} mounted={expaned}>
        {(transitionStyle) => (
          <Paper withBorder radius="md" p="sm" style={{ ...transitionStyle, zIndex: 1 }}>
            <Stack gap="xs">
              <Group gap="xs" c="chatbox-tertiary">
                <IconCode size={16} />
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
                  <IconArrowRight size={16} />
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
        )}
      </Transition>
    </Stack>
  )
}

export const ToolCallPartUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.toolName === 'web_search') {
    return <WebSearchToolCallUI part={part as WebBrowsingToolCallPart} />
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
  const autoCollapseThinkingBlocks = useAtomValue(autoCollapseThinkingBlocksAtom)
  const isThinking =
    (message.generating &&
      part &&
      message.contentParts &&
      message.contentParts.length > 0 &&
      message.contentParts[message.contentParts.length - 1] === part) ||
    false

  const [isExpanded, setIsExpanded] = useState<boolean>(!autoCollapseThinkingBlocks)
  const [userHasManuallyToggled, setUserHasManuallyToggled] = useState<boolean>(false)

  // Update expanded state when settings change, but only if user hasn't manually toggled
  useEffect(() => {
    if (!userHasManuallyToggled) {
      setIsExpanded(!autoCollapseThinkingBlocks)
    }
  }, [autoCollapseThinkingBlocks, userHasManuallyToggled])

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
    setUserHasManuallyToggled(true)
  }, [])

  return (
    <Paper withBorder radius="md" mb="xs">
      <Box onClick={toggleExpanded} className="cursor-pointer group">
        <Group px="xs" justify="space-between" className="w-full">
          <Group gap="xs" className={cn(isThinking ? 'animate-pulse' : '')}>
            <Text fw={600} size="sm">
              {isThinking ? t('Thinking') : t('Deeply thought')}
            </Text>
            <IconBulb size={16} color="var(--mantine-color-chatbox-warning-text)" />
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
              <IconCopy size={16} />
            </ActionIcon>

            {isExpanded ? <IconChevronUp size={16} /> : <IconChevronRight size={16} />}
          </Group>
        </Group>
      </Box>

      <Transition transition="fade-down" duration={100} mounted={isExpanded}>
        {(transitionStyle) => (
          <Box
            style={{
              ...transitionStyle,
              borderTop: '1px solid var(--paper-border-color)',
            }}
          >
            <Text size="sm" px={'sm'} style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
              {reasoningContent}
            </Text>
          </Box>
        )}
      </Transition>
    </Paper>
  )
}
