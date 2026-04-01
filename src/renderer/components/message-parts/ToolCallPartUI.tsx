import { ActionIcon, Box, Code, Collapse, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core'
import { type Message, type MessageReasoningPart, type MessageToolCallPart } from '@shared/types'
import {
  IconBulb,
  IconCheck,
  IconChevronDown,
  IconCircleXFilled,
  IconCode,
  IconCopy,
  IconDatabase,
  IconEdit,
  IconExternalLink,
  IconFile,
  IconFileMinus,
  IconFileSearch,
  IconLoader,
  IconTerminal,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatElapsedTime, useThinkingTimer } from '@/hooks/useThinkingTimer'
import { getToolName } from '@/packages/tools'
import type { SearchResultItem } from '@/packages/web-search'
import { ScalableIcon } from '../common/ScalableIcon'

// ─── Tool Icon Mapping ──────────────────────────────────────────────

const toolIconMap: Record<string, React.ElementType> = {
  web_search: IconWorld,
  terminal: IconTerminal,
  code_search: IconFileSearch,
  file_search: IconFileSearch,
  query_knowledge_base: IconDatabase,
  parse_link: IconExternalLink,
  create_file: IconFile,
  edit_file: IconEdit,
  delete_file: IconFileMinus,
  list_files: IconFileSearch,
  get_files_meta: IconFileSearch,
  read_file_chunks: IconFile,
  read_file: IconFile,
}

const getToolIcon = (toolName: string) => toolIconMap[toolName] || IconCode

// ─── Pill Header (shared) ───────────────────────────────────────────

const ToolCallPill: FC<{
  part: MessageToolCallPart
  summary?: string
  onClick: () => void
  expanded: boolean
}> = ({ part, summary, onClick, expanded }) => {
  const Icon = getToolIcon(part.toolName)
  const isLoading = part.state === 'call'
  const isError = part.state === 'error'

  const bgColor = isError
    ? 'color-mix(in srgb, var(--chatbox-tint-error) 8%, transparent)'
    : 'var(--chatbox-background-gray-secondary)'

  const iconColor = isLoading
    ? 'var(--chatbox-tint-brand)'
    : isError
      ? 'var(--chatbox-tint-error)'
      : 'var(--chatbox-tint-success)'

  return (
    <UnstyledButton onClick={onClick}>
      <Group
        gap={6}
        px={10}
        py={2}
        style={{
          borderRadius: 'var(--mantine-radius-xl)',
          backgroundColor: bgColor,
          display: 'inline-flex',
        }}
      >
        <Icon size={13} color={iconColor} style={{ flexShrink: 0 }} />
        <Text size="xs" fw={500} c={isError ? 'chatbox-error' : undefined} lh={1}>
          {getToolName(part.toolName)}
        </Text>
        {isLoading ? (
          <IconLoader size={11} className="animate-spin" color="var(--chatbox-tint-brand)" style={{ flexShrink: 0 }} />
        ) : isError ? (
          <IconCircleXFilled size={11} color="var(--chatbox-tint-error)" style={{ flexShrink: 0 }} />
        ) : (
          <>
            <IconCheck size={11} color="var(--chatbox-tint-success)" style={{ flexShrink: 0 }} />
            {summary && (
              <Text size="xs" c="chatbox-tertiary" lh={1}>
                · {summary}
              </Text>
            )}
          </>
        )}
        {!isLoading && (
          <IconChevronDown
            size={11}
            color="var(--chatbox-tertiary)"
            style={{ flexShrink: 0 }}
            className={clsx('transition-transform', expanded ? 'rotate-180' : '')}
          />
        )}
      </Group>
    </UnstyledButton>
  )
}

// ─── Web Search ─────────────────────────────────────────────────────

function extractSearchResults(part: MessageToolCallPart): SearchResultItem[] {
  const result = part.result as Record<string, unknown> | undefined
  if (!result || typeof result !== 'object') return []
  const items = result.searchResults
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is SearchResultItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.title === 'string' &&
      typeof item.link === 'string' &&
      typeof item.snippet === 'string'
  )
}

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
    <Paper
      radius="md"
      p={8}
      bg="var(--chatbox-background-gray-secondary)"
      w={164}
      className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
      title={result.title}
    >
      <Group gap={4} wrap="nowrap" align="flex-start">
        <Text size="xs" fw={600} className="shrink-0" m={0} lh={1.35}>
          {index + 1}.
        </Text>
        <Text size="xs" truncate="end" m={0} lh={1.35}>
          {result.title}
        </Text>
      </Group>
      <Text size="10px" truncate="end" c="chatbox-tertiary" m={0} mt={4} lh={1.25}>
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

function extractSearchQueries(parts: MessageToolCallPart[]): string[] {
  const queries: string[] = []
  for (const part of parts) {
    const args = part.args as Record<string, unknown> | undefined
    const query = args?.query
    if (typeof query === 'string' && query.trim()) {
      queries.push(query.trim())
    }
  }
  return queries
}

export const WebSearchGroupUI: FC<{ parts: MessageToolCallPart[] }> = ({ parts }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const allResults = parts.flatMap((part) => extractSearchResults(part))
  const queries = extractSearchQueries(parts)
  const hasLoading = parts.some((p) => p.state === 'call')
  const hasError = parts.some((p) => p.state === 'error') && !hasLoading
  const allDone = parts.every((p) => p.state === 'result' || p.state === 'error')
  const resultCount = allResults.length
  const noResults = allDone && !hasError && resultCount === 0
  const summary =
    resultCount > 0 ? t('{{count}} results', { count: resultCount }) : noResults ? t('Search unsuccessful') : undefined

  const isFailState = hasError || noResults
  const bgColor = isFailState
    ? 'var(--chatbox-background-gray-secondary)'
    : expanded
      ? 'var(--chatbox-background-brand-secondary)'
      : 'var(--chatbox-background-gray-secondary)'
  const border = isFailState ? 'none' : expanded ? '1px solid var(--chatbox-border-brand)' : 'none'

  return (
    <Stack gap={4} mb={4}>
      <UnstyledButton onClick={resultCount > 0 || queries.length > 0 ? () => setExpanded((prev) => !prev) : undefined}>
        <Group
          gap={4}
          px={8}
          py={8}
          style={{
            borderRadius: 'var(--mantine-radius-md)',
            backgroundColor: bgColor,
            border,
            display: 'inline-flex',
          }}
        >
          <IconWorld size={16} color="var(--chatbox-tint-success)" style={{ flexShrink: 0 }} />
          <Text size="sm" fw={600} c="chatbox-secondary" lh={1}>
            {getToolName('web_search')}
          </Text>
          {hasLoading ? (
            <IconLoader
              size={16}
              className="animate-spin"
              color="var(--chatbox-tint-brand)"
              style={{ flexShrink: 0 }}
            />
          ) : isFailState ? (
            <>
              {summary && (
                <Text size="xs" c="chatbox-tertiary" lh={1}>
                  {summary}
                </Text>
              )}
              <IconX size={16} color="var(--chatbox-tint-error)" style={{ flexShrink: 0 }} />
            </>
          ) : (
            <>
              {summary && (
                <Text size="xs" c="chatbox-tertiary" lh={1}>
                  {summary}
                </Text>
              )}
              {allDone && <IconCheck size={16} color="var(--chatbox-tint-success)" style={{ flexShrink: 0 }} />}
            </>
          )}
        </Group>
      </UnstyledButton>
      {expanded && queries.length > 0 && (
        <Group gap={4} ml={4}>
          {queries.map((query, index) => (
            <Text key={`${index}-${query}`} size="xs" c="chatbox-tertiary" fs="italic" lh={1.4}>
              "{query}"{index < queries.length - 1 && ','}
            </Text>
          ))}
        </Group>
      )}
      {expanded && allResults.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          {allResults.map((result, index) => (
            <SearchResultCard key={`${index}-${result.link}`} index={index} result={result} />
          ))}
        </div>
      )}
    </Stack>
  )
}

// ─── Parse Link ─────────────────────────────────────────────────────

const ParseLinkUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false)
  const isLoading = part.state === 'call'
  const isError = part.state === 'error'
  const result = part.result as Record<string, unknown> | undefined
  const title = (result?.title as string) || ''
  const content = (result?.content as string) || ''
  const url = (result?.url as string) || ((part.args as Record<string, unknown>)?.url as string) || ''

  const bgColor = isError
    ? 'color-mix(in srgb, var(--chatbox-tint-error) 8%, transparent)'
    : expanded
      ? 'var(--chatbox-background-brand-secondary)'
      : 'var(--chatbox-background-gray-secondary)'
  const border = isError
    ? '1px solid var(--chatbox-border-error)'
    : expanded
      ? '1px solid var(--chatbox-border-brand)'
      : 'none'

  return (
    <Stack gap={4} mb={4}>
      <UnstyledButton onClick={() => setExpanded((prev) => !prev)}>
        <Group
          gap={4}
          px={8}
          py={8}
          style={{
            borderRadius: 'var(--mantine-radius-md)',
            backgroundColor: bgColor,
            border,
            display: 'inline-flex',
          }}
        >
          <IconExternalLink size={16} color="var(--chatbox-tint-success)" style={{ flexShrink: 0 }} />
          <Text size="sm" fw={600} c={isError ? 'chatbox-error' : 'chatbox-secondary'} lh={1}>
            {getToolName(part.toolName)}
          </Text>
          {isLoading ? (
            <IconLoader
              size={16}
              className="animate-spin"
              color="var(--chatbox-tint-brand)"
              style={{ flexShrink: 0 }}
            />
          ) : isError ? (
            <IconCircleXFilled size={16} color="var(--chatbox-tint-error)" style={{ flexShrink: 0 }} />
          ) : (
            <>
              {title && (
                <Text size="xs" c="chatbox-tertiary" lh={1} truncate="end" maw={300}>
                  {title}
                </Text>
              )}
              <IconCheck size={16} color="var(--chatbox-tint-success)" style={{ flexShrink: 0 }} />
            </>
          )}
        </Group>
      </UnstyledButton>
      {expanded && content && (
        <Box
          mt={4}
          pl="sm"
          style={{
            borderLeft: '1px solid var(--chatbox-tint-placeholder)',
            maxHeight: 400,
            overflowY: 'auto',
            marginLeft: 7,
          }}
        >
          {url && (
            <Text size="xs" c="chatbox-tertiary" mb={4}>
              {url}
            </Text>
          )}
          <Text size="sm" c="chatbox-tertiary" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
            {content}
          </Text>
        </Box>
      )}
    </Stack>
  )
}

// ─── General Tool Call ──────────────────────────────────────────────

const GeneralToolCallUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <Stack gap={6} mb="xs">
      <ToolCallPill part={part} onClick={() => setExpanded((prev) => !prev)} expanded={expanded} />
      <Collapse in={expanded}>
        <Box
          ml={4}
          pl="sm"
          style={{
            borderLeft: `2px solid ${part.state === 'error' ? 'var(--chatbox-tint-error)' : 'var(--chatbox-tint-success)'}`,
          }}
        >
          <Stack gap="xs">
            <Box>
              <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
                {t('Arguments')}
              </Text>
              <Code block>{JSON.stringify(part.args, null, 2)}</Code>
            </Box>
            {!!part.result && (
              <Box>
                <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
                  {t('Result')}
                </Text>
                <Code block>{JSON.stringify(part.result, null, 2)}</Code>
              </Box>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Stack>
  )
}

// ─── Entry Point ────────────────────────────────────────────────────

export const ToolCallPartUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.toolName === 'web_search') {
    return <WebSearchGroupUI parts={[part]} />
  }
  if (part.toolName === 'parse_link') {
    return <ParseLinkUI part={part} />
  }
  return <GeneralToolCallUI part={part} />
}

// ─── Reasoning / Thinking (Minimal Inline) ──────────────────────────

export const ReasoningContentUI: FC<{
  message: Message
  part?: MessageReasoningPart
  onCopyReasoningContent: (content: string) => (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ message, part, onCopyReasoningContent }) => {
  const reasoningContent = part?.text ?? message.reasoningContent ?? ''
  const { t } = useTranslation()
  const rawIsThinking =
    (message.generating &&
      part &&
      message.contentParts &&
      message.contentParts.length > 0 &&
      message.contentParts[message.contentParts.length - 1] === part) ||
    false

  // Once thinking transitions to done, lock it as done to prevent flicker
  // when new content parts are appended during streaming.
  const wasEverDoneRef = useRef(false)
  if (!rawIsThinking && (reasoningContent.length > 0 || (part?.duration && part.duration > 0))) {
    wasEverDoneRef.current = true
  }
  const isThinking = rawIsThinking && !wasEverDoneRef.current

  const [isExpanded, setIsExpanded] = useState<boolean>(false)

  const elapsedTime = useThinkingTimer(part?.startTime, isThinking)
  const shouldShowTimer = message.isStreamingMode === true

  const displayTime =
    part?.duration && part.duration > 0 ? part.duration : isThinking && elapsedTime > 0 ? elapsedTime : 0

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const showCopy = isExpanded && reasoningContent.length > 0
  const copyButton = showCopy ? (
    <ActionIcon
      variant="subtle"
      size="xs"
      c="chatbox-gray"
      onClick={(e) => {
        e.stopPropagation()
        onCopyReasoningContent(reasoningContent)(e)
      }}
      aria-label={t('Copy reasoning content')}
    >
      <ScalableIcon icon={IconCopy} size={12} />
    </ActionIcon>
  ) : null

  const reasoningCollapse = reasoningContent.length > 0 && (
    <Collapse in={isExpanded}>
      <Box
        mt={4}
        pl="sm"
        style={{
          borderLeft: '1px solid var(--chatbox-tint-placeholder)',
          maxHeight: 400,
          overflowY: 'auto',
          marginLeft: 7,
        }}
      >
        <Text size="sm" c="chatbox-tertiary" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
          {reasoningContent}
        </Text>
      </Box>
    </Collapse>
  )

  if (isThinking) {
    return (
      <Box mb={4}>
        <UnstyledButton onClick={toggleExpanded}>
          <Group gap={6}>
            <Box
              w={6}
              h={6}
              style={{
                borderRadius: '50%',
                backgroundColor: 'var(--chatbox-tint-brand)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <Text size="sm" c="chatbox-tertiary" fs="italic">
              {t('Thinking')}
              {shouldShowTimer && displayTime > 0 ? ` · ${formatElapsedTime(displayTime)}` : '...'}
            </Text>
            {copyButton}
          </Group>
        </UnstyledButton>
        {reasoningCollapse}
      </Box>
    )
  }

  return (
    <Box mb="xs">
      <Box role="button" onClick={toggleExpanded}>
        <Group gap={6}>
          <ScalableIcon icon={IconBulb} size={14} color="var(--chatbox-tint-warning)" />
          <Text size="sm" fw={600} c="chatbox-secondary" td="underline">
            {shouldShowTimer && displayTime > 0
              ? t('Thought for {{time}}', { time: formatElapsedTime(displayTime) })
              : t('Deeply thought')}
          </Text>
          {copyButton}
        </Group>
      </Box>
      <Collapse in={isExpanded}>
        <Box
          ml={4}
          mt={4}
          pl="sm"
          style={{ borderLeft: '2px solid var(--chatbox-tint-warning)', maxHeight: 400, overflowY: 'auto' }}
        >
          <Text size="sm" c="chatbox-tertiary" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
            {reasoningContent}
          </Text>
        </Box>
      </Collapse>
    </Box>
  )
}
