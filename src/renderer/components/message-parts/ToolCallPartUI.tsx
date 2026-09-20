import { isApprovalPauseReason } from '@chatbox/core/message-approval'
import NiceModal from '@ebay/nice-modal-react'
import { Alert, Box, Button, Code, Collapse, Group, Paper, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { workExecutionFeedback } from '@shared/mobile-work/execution-feedback'
import { ChatboxAIAPIError } from '@shared/models/errors'
import { SANDBOX_EXEC_ERROR_CODES } from '@shared/sandbox-provider'
import { getToolResultImageReference } from '@shared/tool-result-image'
import type { MessageToolCallPart } from '@shared/types'
import { getWorkArtifacts } from '@shared/work-artifacts'
import { stepNeedsUserAction } from '@shared/work-timeline'
import {
  IconCheck,
  IconChevronDown,
  IconCircleXFilled,
  IconCode,
  IconDatabase,
  IconDeviceFloppy,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFile,
  IconFileMinus,
  IconFileSearch,
  IconFolderSearch,
  IconInfoCircle,
  IconLoader,
  IconPackage,
  IconPhoto,
  IconPlayerPlay,
  IconSparkles,
  IconTerminal,
  IconWorld,
  IconWriting,
  IconX,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageGenerationResultGallery } from '@/components/chat/ImageGenerationResultGallery'
import { ImageInStorage } from '@/components/Image'
import { useBlob } from '@/hooks/useBlob'
import { formatElapsedTime, MIN_STEP_DURATION_MS, useThinkingTimer } from '@/hooks/useThinkingTimer'
import { getLogger } from '@/lib/utils'
import { getAcceptedImageBackgroundTaskResult } from '@/packages/chatbox-cli/background-task-result'
import { resumeImageGenerationWithFollowUp } from '@/packages/chatbox-cli/image-task-follow-up'
import { getFileMutationDisplayStats } from '@/packages/model-calls/toolsets/file-mutation-stats'
import { getToolName } from '@/packages/tools'
import type { SearchResultItem } from '@/packages/web-search'
import platform from '@/platform'
import {
  registerPausedStepElement,
  unregisterPausedStepElement,
  useApprovalCardHighlighted,
} from '@/stores/approvalAttentionStore'
import {
  useCurrentGeneratingId,
  useImageGenerationRecord,
  useImageGenerationRecords,
} from '@/stores/imageGenerationStore'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import { inlineSandboxHtmlAssets } from './html-artifact-assets'
import { getLocalFileName, localFilePathToUrl } from './local-file-url'
import { MobileWorkArtifactsUI } from './MobileWorkArtifactsUI'
import { ToolUnavailableCard } from './ToolUnavailableCard'
import {
  InlineToolIcon,
  TIMELINE_APPROVAL_BORDER,
  TIMELINE_DETAIL_INDENT,
  TIMELINE_DISCLOSURE_CLASS,
  TIMELINE_GROUP_BORDER,
  TIMELINE_GROUP_INDENT,
  TIMELINE_ICON_GAP,
  TIMELINE_LABEL_FONT_SIZE,
  TIMELINE_ROW_HEIGHT,
  TimelineStepIcon,
  ToolCallRunningDots,
} from './timeline-primitives'

// ─── Tool Error Result ──────────────────────────────────────────────

const log = getLogger('tool-call-part-ui')

const TOOL_ERROR_PREVIEW_LENGTH = 1_200
const TOOL_PAYLOAD_PREVIEW_LENGTH = 8_000
const APPROVAL_PAYLOAD_MAX_HEIGHT = 'min(240px, 35vh)'
const WRAPPABLE_TEXT_STYLE = { overflowWrap: 'anywhere' } as const
const PREFORMATTED_OVERFLOW_STYLE = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const
const PRELINE_OVERFLOW_STYLE = { whiteSpace: 'pre-line', lineHeight: 1.5, overflowWrap: 'anywhere' } as const
const GIT_BASH_DOWNLOAD_URL = 'https://git-scm.com/downloads/win'
const WSL_INSTALL_URL = 'https://learn.microsoft.com/windows/wsl/install'

function truncatePreview(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n\n...`
}

function stringifyToolPayload(payload: unknown, maxLength = TOOL_PAYLOAD_PREVIEW_LENGTH): string {
  let text: string
  try {
    text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  } catch {
    text = String(payload)
  }
  return truncatePreview(text, maxLength)
}

function isBashNotAvailableResult(part: MessageToolCallPart): boolean {
  if (part.state !== 'result') return false
  const result = part.result as { errorCode?: unknown } | undefined
  return result?.errorCode === SANDBOX_EXEC_ERROR_CODES.BASH_NOT_AVAILABLE
}

const BashNotAvailableNotice: FC = () => {
  const { t } = useTranslation()
  return (
    <Alert
      color="yellow"
      variant="light"
      icon={<IconInfoCircle size={17} />}
      title={t('Bash is not available on this Windows device.')}
    >
      <Stack gap="xs">
        <Text size="sm">
          {t(
            'Install Git Bash or enable WSL to run Bash code. You can continue using Node.js code execution without either.'
          )}
        </Text>
        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="light"
            rightSection={<IconExternalLink size={12} />}
            onClick={() => platform.openLink(GIT_BASH_DOWNLOAD_URL)}
          >
            {t('Download Git Bash')}
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            rightSection={<IconExternalLink size={12} />}
            onClick={() => platform.openLink(WSL_INSTALL_URL)}
          >
            {t('How to install WSL2')}
          </Button>
        </Group>
      </Stack>
    </Alert>
  )
}

function extractToolError(part: MessageToolCallPart): { errorCode?: number; errorText?: string } {
  if (part.state !== 'error') return {}
  const result = part.result as { error?: unknown; errorCode?: unknown } | undefined
  const errorCode = typeof result?.errorCode === 'number' ? result.errorCode : undefined
  const errorText =
    result?.error === undefined ? undefined : stringifyToolPayload(result.error, TOOL_ERROR_PREVIEW_LENGTH)
  return { errorCode, errorText }
}

const ToolCallErrorDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const { errorCode, errorText } = extractToolError(part)
  // Only render the rich i18n message if the code is one we know about — unknown
  // codes (e.g. NetworkError, generic ApiError) would render as null and silently
  // hide the underlying error text.
  if (errorCode && ChatboxAIAPIError.getDetail(errorCode)) {
    return (
      <ToolUnavailableCard
        toolLabel={getToolName(part.toolName, part.args)}
        toolName={part.toolName}
        errorCode={errorCode}
      />
    )
  }
  return (
    <Text size="sm" c="chatbox-error" style={WRAPPABLE_TEXT_STYLE}>
      {workExecutionFeedback(part.result, t) || errorText || t('Tool call failed')}
    </Text>
  )
}

// Auto-expand a step when it needs attention (e.g. Bash unavailable) and
// auto-collapse once that resolves. Only the transition edges drive expansion;
// a stable signal leaves the user's manual toggle untouched.
function useAutoExpandOnSignal(signal: boolean): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [expanded, setExpanded] = useState(signal)
  const prevSignal = useRef(signal)
  useEffect(() => {
    if (signal && !prevSignal.current) {
      setExpanded(true) // became active → reveal the action buttons
    } else if (!signal && prevSignal.current) {
      setExpanded(false) // resolved → collapse the tool call
    }
    prevSignal.current = signal
  }, [signal])
  return [expanded, setExpanded]
}

// Register the paused step's element so the pending-action bar's "View" action can
// scroll back to it. Unmounted steps (virtualized list) simply aren't registered.
// Keyed per component instance because the same step can be mounted twice
// (message list + search dialog). The message identity prevents a reused tool
// call id in an older thread from becoming the current bar's reveal target.
function usePausedStepElementRegistration(
  sessionId: string | undefined,
  messageId: string | undefined,
  toolCallId: string,
  enabled: boolean
) {
  const instanceId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!enabled || !sessionId || !messageId) return
    const element = ref.current
    if (!element) return
    registerPausedStepElement(sessionId, messageId, toolCallId, instanceId, element)
    return () => unregisterPausedStepElement(sessionId, messageId, toolCallId, instanceId)
  }, [sessionId, messageId, toolCallId, instanceId, enabled])
  return ref
}

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
  write_file: IconWriting,
  search_files: IconFileSearch,
  list_files: IconFileSearch,
  get_files_meta: IconFileSearch,
  read_file_chunks: IconFile,
  read_file: IconFile,
  code_execution: IconPlayerPlay,
  parse_file: IconFile,
  create_download: IconDownload,
  search_file_content: IconFileSearch,
  sandbox_bash: IconTerminal,
  sandbox_read: IconFile,
  sandbox_write: IconWriting,
  sandbox_edit: IconEdit,
  sandbox_grep: IconFileSearch,
  sandbox_ls: IconFolderSearch,
  sandbox_find: IconFolderSearch,
  load_skill: IconSparkles,
  chatbox_cli: IconSparkles,
  user_exec: IconTerminal,
  run_command: IconTerminal,
  view_image: IconPhoto,
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
  const isError = part.state === 'error' || isBashNotAvailableResult(part)

  const bgColor = isError
    ? 'color-mix(in srgb, var(--chatbox-tint-error) 8%, transparent)'
    : 'var(--chatbox-background-gray-secondary)'

  const iconColor = isLoading
    ? 'var(--chatbox-tint-brand)'
    : isError
      ? 'var(--chatbox-tint-error)'
      : 'var(--chatbox-tint-success)'

  return (
    <UnstyledButton onClick={onClick} style={{ display: 'inline-flex', maxWidth: '100%', verticalAlign: 'middle' }}>
      <Group
        gap={6}
        px={10}
        py={2}
        align="center"
        wrap="nowrap"
        style={{
          borderRadius: 'var(--mantine-radius-xl)',
          backgroundColor: bgColor,
          display: 'inline-flex',
          maxWidth: '100%',
        }}
      >
        <InlineToolIcon icon={Icon} size={13} color={iconColor} />
        <Text size="xs" fw={500} c={isError ? 'chatbox-error' : undefined} lh="13px" truncate="end">
          {getToolName(part.toolName, part.args)}
        </Text>
        {isLoading ? (
          <InlineToolIcon icon={IconLoader} size={11} color="var(--chatbox-tint-brand)" className="animate-spin" />
        ) : isError ? (
          <InlineToolIcon icon={IconCircleXFilled} size={11} color="var(--chatbox-tint-error)" />
        ) : (
          <>
            <InlineToolIcon icon={IconCheck} size={11} color="var(--chatbox-tint-success)" />
            {summary && (
              <Text size="xs" c="chatbox-tertiary" lh="13px" truncate="end" style={{ minWidth: 0 }}>
                · {summary}
              </Text>
            )}
          </>
        )}
        {!isLoading && (
          <InlineToolIcon
            icon={IconChevronDown}
            size={11}
            color="var(--chatbox-tertiary)"
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

const SEARCH_RESULT_CARD_WIDTH = 164

const SearchResultCard: FC<{ index: number; result: SearchResultItem }> = ({ index, result }) => {
  const href = getSafeExternalHref(result.link)

  const content = (
    <Paper
      radius="md"
      p={8}
      bg="var(--chatbox-background-gray-secondary)"
      w={SEARCH_RESULT_CARD_WIDTH}
      maw={SEARCH_RESULT_CARD_WIDTH}
      className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
      title={result.title}
      style={{ minWidth: 0, overflow: 'hidden' }}
    >
      <Group gap={4} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
        <Text size="xs" fw={600} className="shrink-0" m={0} lh={1.35}>
          {index + 1}.
        </Text>
        <Text size="xs" truncate="end" m={0} lh={1.35} style={{ minWidth: 0 }}>
          {result.title}
        </Text>
      </Group>
      <Text
        size="10px"
        truncate="end"
        c="chatbox-tertiary"
        m={0}
        mt={4}
        lh={1.25}
        title={result.link}
        style={{ minWidth: 0 }}
      >
        {result.link}
      </Text>
    </Paper>
  )

  if (!href) {
    return content
  }

  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline"
      maw={SEARCH_RESULT_CARD_WIDTH}
      style={{ minWidth: 0, flexShrink: 0 }}
    >
      {content}
    </Box>
  )
}

const SearchResultList: FC<{ results: SearchResultItem[] }> = ({ results }) => (
  <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
    {results.map((result, index) => (
      <SearchResultCard key={`${index}-${result.link}`} index={index} result={result} />
    ))}
  </div>
)

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
  const errorPart = hasError ? parts.find((p) => p.state === 'error') : undefined
  const [expanded, setExpanded] = useAutoExpandOnSignal(Boolean(errorPart && stepNeedsUserAction(errorPart)))
  const bgColor = isFailState
    ? 'var(--chatbox-background-gray-secondary)'
    : expanded
      ? 'var(--chatbox-background-brand-secondary)'
      : 'var(--chatbox-background-gray-secondary)'
  const border = isFailState ? 'none' : expanded ? '1px solid var(--chatbox-border-brand)' : 'none'

  return (
    <Stack gap={4} mb={4} style={{ minWidth: 0, maxWidth: '100%' }}>
      <UnstyledButton
        onClick={resultCount > 0 || queries.length > 0 || hasError ? () => setExpanded((prev) => !prev) : undefined}
      >
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
        <Group gap={4} ml={4} wrap="wrap" style={{ minWidth: 0 }}>
          {queries.map((query, index) => (
            <Text
              key={`${index}-${query}`}
              size="xs"
              c="chatbox-tertiary"
              fs="italic"
              lh={1.4}
              style={{ overflowWrap: 'anywhere' }}
            >
              "{query}"{index < queries.length - 1 && ','}
            </Text>
          ))}
        </Group>
      )}
      {expanded && allResults.length > 0 && <SearchResultList results={allResults} />}
      {expanded && errorPart && (
        <Box ml={4} pl="sm" style={{ borderLeft: '1px solid var(--chatbox-tint-error)' }}>
          <ToolCallErrorDetails part={errorPart} />
        </Box>
      )}
    </Stack>
  )
}

// ─── Parse Link ─────────────────────────────────────────────────────

const ParseLinkUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const isLoading = part.state === 'call'
  const isError = part.state === 'error'
  const [expanded, setExpanded] = useAutoExpandOnSignal(stepNeedsUserAction(part))
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
            {getToolName(part.toolName, part.args)}
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
      {expanded && (isError || content) && (
        <Box
          mt={4}
          pl="sm"
          style={{
            borderLeft: `1px solid ${isError ? 'var(--chatbox-tint-error)' : 'var(--chatbox-tint-placeholder)'}`,
            maxHeight: 400,
            overflowY: 'auto',
            overflowX: 'hidden',
            marginLeft: 7,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {url && (
            <Text size="xs" c="chatbox-tertiary" mb={4} style={WRAPPABLE_TEXT_STYLE}>
              {url}
            </Text>
          )}
          {isError ? (
            <ToolCallErrorDetails part={part} />
          ) : (
            <Text size="sm" c="chatbox-tertiary" style={PRELINE_OVERFLOW_STYLE}>
              {content}
            </Text>
          )}
        </Box>
      )}
    </Stack>
  )
}

const ParseLinkDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const isError = part.state === 'error'
  const result = part.result as Record<string, unknown> | undefined
  const content = (result?.content as string) || ''
  const url = (result?.url as string) || ((part.args as Record<string, unknown>)?.url as string) || ''

  return (
    <Stack gap={6}>
      {url && (
        <Text size="xs" c="chatbox-tertiary" style={WRAPPABLE_TEXT_STYLE}>
          {url}
        </Text>
      )}
      {isError ? (
        <ToolCallErrorDetails part={part} />
      ) : (
        content && (
          <Text size="sm" c="chatbox-tertiary" style={PRELINE_OVERFLOW_STYLE}>
            {content}
          </Text>
        )
      )}
    </Stack>
  )
}

// ─── General Tool Call ──────────────────────────────────────────────

const GeneralToolCallUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const isBashNotAvailable = isBashNotAvailableResult(part)
  const isError = part.state === 'error' || isBashNotAvailable
  const [expanded, setExpanded] = useAutoExpandOnSignal(stepNeedsUserAction(part))

  return (
    <Stack gap={6} mb="xs">
      <ToolCallPill part={part} onClick={() => setExpanded((prev) => !prev)} expanded={expanded} />
      <Collapse in={expanded}>
        <Box
          ml={4}
          pl="sm"
          style={{
            borderLeft: `2px solid ${isError ? 'var(--chatbox-tint-error)' : 'var(--chatbox-tint-success)'}`,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <GeneralToolCallDetails part={part} />
        </Box>
      </Collapse>
    </Stack>
  )
}

const GeneralToolCallDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const isError = part.state === 'error'
  const isBashNotAvailable = isBashNotAvailableResult(part)

  return (
    <Stack gap="xs" style={{ minWidth: 0, maxWidth: '100%' }}>
      <Box>
        <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
          {t('Arguments')}
        </Text>
        <Code block style={PREFORMATTED_OVERFLOW_STYLE}>
          {stringifyToolPayload(part.args)}
        </Code>
      </Box>
      {isError ? (
        <Box>
          <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
            {t('Error')}
          </Text>
          <ToolCallErrorDetails part={part} />
        </Box>
      ) : isBashNotAvailable ? (
        <BashNotAvailableNotice />
      ) : (
        !!part.result && (
          <Box>
            <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
              {t('Result')}
            </Text>
            <Code block style={PREFORMATTED_OVERFLOW_STYLE}>
              {stringifyToolPayload(part.result)}
            </Code>
          </Box>
        )
      )}
    </Stack>
  )
}

// ─── Create Download ─────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.tsv',
  '.log',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
])

// Cap text preview reads so a large generated artifact cannot exhaust the renderer.
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

function getFileExtension(filePath: string): string {
  const name = getLocalFileName(filePath)
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : ''
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(filePath))
}

function isHtmlFile(filePath: string): boolean {
  return HTML_EXTENSIONS.has(getFileExtension(filePath))
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(getFileExtension(filePath))
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const DesktopCreateDownloadUI: FC<{ part: MessageToolCallPart } & ToolCallActionContext> = ({
  part,
  sessionId,
  messageId,
}) => {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const setPictureShow = useUIStore((s) => s.setPictureShow)
  const isLoading = part.state === 'call'
  const isError = part.state === 'error'
  const result = part.result as Record<string, unknown> | undefined
  const filePath = (result?.file_path as string) || ((part.args as Record<string, unknown>)?.file_path as string) || ''
  const fileName = filePath ? getLocalFileName(filePath) : 'File'
  const isDownloadable = result?.downloadable === true
  const isSandboxPath = filePath.includes('/chatbox-sandbox/') || filePath.includes('\\chatbox-sandbox\\')
  const canPreview = isDownloadable && !!filePath && isImageFile(filePath) && isSandboxPath
  const canPreviewHtml = isDownloadable && !!filePath && isHtmlFile(filePath) && isSandboxPath
  const canPreviewText = isDownloadable && !!filePath && isTextFile(filePath) && isSandboxPath
  const imageUrl = canPreview ? localFilePathToUrl(filePath) : null

  const handleSave = useCallback(async () => {
    if (!filePath) return
    setSaving(true)
    setSaveError(null)
    try {
      const platform = (await import('@/platform')).default
      if (platform.sandboxExportFile) {
        const res = await platform.sandboxExportFile({ sandboxPath: filePath })
        if (!res.success && res.error && res.error !== 'Save dialog cancelled') {
          setSaveError(res.error)
        }
      }
    } catch (err) {
      console.error('Failed to export file:', err)
      setSaveError(t('File no longer available'))
    } finally {
      setSaving(false)
    }
  }, [filePath, t])

  const handlePreviewHtml = useCallback(async () => {
    if (!filePath) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      const platform = (await import('@/platform')).default
      if (!platform.sandboxReadFileBase64) {
        setPreviewError(t('Preview not available'))
        return
      }
      if (platform.sandboxCreateHtmlPreview) {
        const preview = await platform.sandboxCreateHtmlPreview({ filePath })
        if (preview.success && preview.url) {
          await NiceModal.show('artifact-preview', {
            htmlCode: '',
            previewUrl: preview.url,
            sandboxPath: filePath,
            sessionId,
            uniqueId: messageId ? `${messageId}-tool-${part.toolCallId}` : undefined,
          })
          return
        }
      }
      const res = await platform.sandboxReadFileBase64({ filePath })
      if (!res.success || res.base64 === undefined) {
        setPreviewError(res.error || t('Preview not available'))
        return
      }
      const htmlCode = await inlineSandboxHtmlAssets(decodeBase64Utf8(res.base64), filePath, (assetPath) => {
        if (!platform.sandboxReadFileBase64) {
          return Promise.resolve({ success: false })
        }
        return platform.sandboxReadFileBase64({ filePath: assetPath })
      })
      await NiceModal.show('artifact-preview', {
        htmlCode,
        sessionId,
        uniqueId: messageId ? `${messageId}-tool-${part.toolCallId}` : undefined,
      })
    } catch (err) {
      console.error('Failed to preview HTML artifact:', err)
      setPreviewError(t('Preview not available'))
    } finally {
      setPreviewing(false)
    }
  }, [filePath, messageId, part.toolCallId, sessionId, t])

  const handlePreviewText = useCallback(async () => {
    if (!filePath) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      const platform = (await import('@/platform')).default
      if (!platform.sandboxReadFileBase64) {
        setPreviewError(t('Preview not available'))
        return
      }
      const res = await platform.sandboxReadFileBase64({ filePath, maxBytes: TEXT_PREVIEW_MAX_BYTES })
      if (!res.success || res.base64 === undefined) {
        setPreviewError(res.error || t('Preview not available'))
        return
      }
      await NiceModal.show('content-viewer', {
        title: fileName,
        content: decodeBase64Utf8(res.base64),
      })
    } catch (err) {
      console.error('Failed to preview text file:', err)
      setPreviewError(t('Preview not available'))
    } finally {
      setPreviewing(false)
    }
  }, [filePath, fileName, t])

  if (isLoading) {
    return (
      <Group gap={6} mb="xs">
        <IconLoader size={14} className="animate-spin" color="var(--chatbox-tint-brand)" />
        <Text size="sm" c="chatbox-tertiary">
          {t('Preparing file...')}
        </Text>
      </Group>
    )
  }

  if (isError || !isDownloadable) {
    return <GeneralToolCallUI part={part} />
  }

  return (
    <Stack gap={6} mb="xs">
      {imageUrl && !previewFailed && (
        <Box
          style={{
            maxWidth: 400,
            borderRadius: 'var(--mantine-radius-md)',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
          onClick={() => setPictureShow({ picture: { url: imageUrl } })}
        >
          <img
            src={imageUrl}
            alt={fileName}
            style={{ display: 'block', width: '100%', height: 'auto' }}
            onError={() => setPreviewFailed(true)}
          />
        </Box>
      )}
      {previewFailed && canPreview && (
        <Text size="xs" c="dimmed">
          {t('Preview not available')}
        </Text>
      )}
      <Paper
        radius="md"
        p="xs"
        bg="var(--chatbox-background-gray-secondary)"
        style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}
      >
        <IconFile size={18} color="var(--chatbox-tint-brand)" style={{ flexShrink: 0 }} />
        <Text size="sm" fw={500} truncate title={filePath} style={{ flex: '1 1 0', minWidth: 0 }}>
          {fileName}
        </Text>
        <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
          {(canPreviewHtml || canPreviewText) && (
            <Button
              variant="light"
              size="compact-xs"
              leftSection={<IconEye size={14} />}
              loading={previewing}
              onClick={canPreviewText ? handlePreviewText : handlePreviewHtml}
            >
              {t('Preview')}
            </Button>
          )}
          <Button
            variant="light"
            size="compact-xs"
            leftSection={<IconDeviceFloppy size={14} />}
            loading={saving}
            onClick={handleSave}
          >
            {t('Save')}
          </Button>
        </Group>
      </Paper>
      {saveError && (
        <Text size="xs" c="red">
          {saveError}
        </Text>
      )}
      {previewError && (
        <Text size="xs" c="red">
          {previewError}
        </Text>
      )}
    </Stack>
  )
}

const CreateDownloadUI: FC<{ part: MessageToolCallPart } & ToolCallActionContext> = (props) => {
  const localArtifacts = getWorkArtifacts(props.part)
  return localArtifacts.length > 0 ? (
    <MobileWorkArtifactsUI artifacts={localArtifacts} sessionId={props.sessionId} />
  ) : (
    <DesktopCreateDownloadUI {...props} />
  )
}

function isDownloadArtifact(part: MessageToolCallPart): boolean {
  if (part.toolName !== 'create_download' || part.state !== 'result') return false
  const result = part.result as Record<string, unknown> | undefined
  return result?.downloadable === true || getWorkArtifacts(part).length > 0
}

export const MessageArtifactsUI: FC<
  { imageParts: MessageToolCallPart[]; downloadParts: MessageToolCallPart[] } & ToolCallActionContext
> = ({ imageParts, downloadParts, sessionId, messageId }) => {
  const { t } = useTranslation()
  const artifacts = downloadParts.filter(isDownloadArtifact)
  const imageRecordIds = useMemo(
    () =>
      imageParts
        .map((part) => getAcceptedImageBackgroundTaskResult(part.result)?.recordId)
        .filter((recordId): recordId is string => Boolean(recordId)),
    [imageParts]
  )
  const imageRecords = useImageGenerationRecords(imageRecordIds)
  const generatedImages = useMemo(() => imageRecords.flatMap((record) => record?.generatedImages ?? []), [imageRecords])

  // A run that is still generating has no artifact to show yet — stay invisible
  // instead of leaving an empty section behind.
  if (artifacts.length === 0 && generatedImages.length === 0) return null

  return (
    <Stack
      gap={6}
      mt={10}
      pt={8}
      mb={2}
      style={{ borderTop: '1px solid color-mix(in srgb, var(--chatbox-border-primary) 70%, transparent)' }}
    >
      <Group gap={6}>
        <IconPackage size={14} color="var(--chatbox-tint-brand)" />
        <Text size="xs" fw={600} c="chatbox-secondary">
          {t('Artifacts')}
        </Text>
      </Group>
      <Stack gap={6}>
        <ImageGenerationResultGallery images={generatedImages} />
        {artifacts.map((part) => (
          <CreateDownloadUI key={part.toolCallId} part={part} sessionId={sessionId} messageId={messageId} />
        ))}
      </Stack>
    </Stack>
  )
}

// ─── User Exec ──────────────────────────────────────────────────────

function isCommandExecutionPart(part: MessageToolCallPart): boolean {
  return part.toolName === 'user_exec' || part.toolName === 'code_execution'
}

function getCommandExecutionCode(part: MessageToolCallPart): string | undefined {
  return getFirstStringValue(part.args, part.toolName === 'user_exec' ? ['command'] : ['code'])
}

function parseCommandExecutionResult(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function useCommandExecutionResult(part: MessageToolCallPart): Record<string, unknown> | undefined {
  const { data: storedResult } = useBlob(isCommandExecutionPart(part) ? part.resultStorageKey : undefined)
  return parseCommandExecutionResult(storedResult) ?? parseCommandExecutionResult(part.result)
}

const CommandExecutionDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const command = getCommandExecutionCode(part)
  const result = useCommandExecutionResult(part)
  const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
  const stderr =
    typeof result?.stderr === 'string' ? result.stderr : typeof result?.error === 'string' ? result.error : ''
  const hasFinished = part.state === 'result' || part.state === 'error'

  return (
    <Stack gap="xs" style={{ minWidth: 0, maxWidth: '100%' }}>
      {command && (
        <Box>
          <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
            {t('Command')}
          </Text>
          <Code block style={PREFORMATTED_OVERFLOW_STYLE}>
            {command}
          </Code>
        </Box>
      )}
      {hasFinished && (
        <Box>
          <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
            stdout
          </Text>
          <Code block style={PREFORMATTED_OVERFLOW_STYLE}>
            {stdout || '—'}
          </Code>
        </Box>
      )}
      {hasFinished && stderr && (
        <Box>
          <Text size="xs" c="chatbox-tertiary" fw={500} mb={2}>
            stderr
          </Text>
          <Code block style={PREFORMATTED_OVERFLOW_STYLE}>
            {stderr}
          </Code>
        </Box>
      )}
    </Stack>
  )
}

const UserExecUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const isExecuting = part.state === 'call'
  const isError = part.state === 'error'
  const isDenied =
    part.state === 'result' && (part.result as Record<string, unknown>)?.stderr === 'Command denied by user.'

  const bgColor =
    isError || isDenied
      ? 'color-mix(in srgb, var(--chatbox-tint-error) 8%, transparent)'
      : 'var(--chatbox-background-gray-secondary)'

  return (
    <Stack gap={6} mb="xs">
      <UnstyledButton onClick={() => setExpanded((prev) => !prev)}>
        <Group
          gap={6}
          px={10}
          py={4}
          style={{
            borderRadius: 'var(--mantine-radius-md)',
            backgroundColor: bgColor,
            border: '1px solid transparent',
            display: 'inline-flex',
          }}
        >
          <IconTerminal
            size={13}
            color={
              isExecuting
                ? 'var(--chatbox-tint-brand)'
                : isError || isDenied
                  ? 'var(--chatbox-tint-error)'
                  : 'var(--chatbox-tint-success)'
            }
            style={{ flexShrink: 0 }}
          />
          <Text size="xs" fw={500} lh={1}>
            {getToolName(part.toolName, part.args)}
          </Text>
          {isExecuting && (
            <IconLoader
              size={11}
              className="animate-spin"
              color="var(--chatbox-tint-brand)"
              style={{ flexShrink: 0 }}
            />
          )}
          {isDenied && (
            <Text size="xs" c="chatbox-error" lh={1}>
              {t('Denied')}
            </Text>
          )}
          {part.state === 'result' && !isDenied && (
            <IconCheck size={11} color="var(--chatbox-tint-success)" style={{ flexShrink: 0 }} />
          )}
          {isError && <IconCircleXFilled size={11} color="var(--chatbox-tint-error)" style={{ flexShrink: 0 }} />}
        </Group>
      </UnstyledButton>

      <Collapse in={expanded}>
        <Box
          ml={4}
          pl="sm"
          style={{
            borderLeft: `2px solid ${isError || isDenied ? 'var(--chatbox-tint-error)' : 'var(--chatbox-tint-success)'}`,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          <CommandExecutionDetails part={part} />
        </Box>
      </Collapse>
    </Stack>
  )
}

// ─── Entry Point ────────────────────────────────────────────────────

export type ToolCallActionContext = {
  sessionId?: string
  messageId?: string
}

export const ToolCallPartUI: FC<{ part: MessageToolCallPart } & ToolCallActionContext> = ({
  part,
  sessionId,
  messageId,
}) => {
  if (part.state === 'paused') {
    return (
      <Box my={8} mb={12}>
        <TimelineToolCallStep part={part} sessionId={sessionId} messageId={messageId} />
      </Box>
    )
  }
  if (part.toolName === 'web_search') {
    return <WebSearchGroupUI parts={[part]} />
  }
  if (part.toolName === 'parse_link') {
    return <ParseLinkUI part={part} />
  }
  if (part.toolName === 'create_download') {
    return <CreateDownloadUI part={part} sessionId={sessionId} messageId={messageId} />
  }
  if (part.toolName === 'user_exec') {
    return <UserExecUI part={part} />
  }
  return <GeneralToolCallUI part={part} />
}

// ─── Tool Call Timeline (consecutive tool calls) ─────────────────

function getFirstStringValue(source: unknown, keys: string[]): string | undefined {
  if (!source || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function truncateSummary(value: string, maxLength = 56): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

// Read-only pause details: what the agent is waiting on. All decision actions
// (Approve/Deny/Continue/Stop) live in the pending-action bar at the bottom of
// the conversation, which takes over the input box slot while input is locked.
const PausedToolCallDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  const pauseReason = part.pauseReason
  const title =
    pauseReason?.type === 'tool_call_limit'
      ? t('Paused after {{count}} steps. Check whether the task is on track, then continue or stop to adjust.', {
          count: pauseReason.maxToolCalls,
        })
      : pauseReason?.type === 'user_exec_approval'
        ? t('Approval required before executing this command.')
        : pauseReason?.type === 'command_escalation_approval'
          ? t('Approval required before retrying this command with full access.')
          : pauseReason?.type === 'file_mutation_approval'
            ? t('Approval required before modifying files.')
            : pauseReason?.type === 'app_action_approval'
              ? pauseReason.title
              : t('Tool execution is paused.')
  // Legacy pauses recover the counts by diffing the persisted preview — memoized
  // so highlight/expand re-renders don't redo that work.
  const fileMutationSummary = useMemo(() => {
    if (pauseReason?.type !== 'file_mutation_approval') return undefined
    const stats = getFileMutationDisplayStats(pauseReason)
    const approximation = stats?.approximate ? '~' : ''
    const magnitude =
      stats?.mode === 'write'
        ? `${stats.approximate ? '~ ' : ''}${t('Writing {{count}} lines', { count: stats.addedLines })}`
        : stats?.mode === 'edit'
          ? `${approximation}+${stats.addedLines} ${approximation}-${stats.removedLines}`
          : undefined
    return magnitude ? `${pauseReason.title}\n\n${magnitude}` : pauseReason.title
  }, [pauseReason, t])
  const payload =
    pauseReason?.type === 'user_exec_approval'
      ? `${pauseReason.command}${pauseReason.workdir ? `\n\nWorking directory: ${pauseReason.workdir}` : ''}`
      : pauseReason?.type === 'command_escalation_approval'
        ? `${pauseReason.command}\n\n${pauseReason.justification}\n\nWorking directory: ${pauseReason.workdir}`
        : pauseReason?.type === 'file_mutation_approval'
          ? fileMutationSummary
          : pauseReason?.type === 'app_action_approval'
            ? pauseReason.preview
            : stringifyToolPayload(part.args)
  return (
    <Stack data-tool-call-id={part.toolCallId} gap="xs">
      <Text size="xs" c="chatbox-secondary">
        {title}
      </Text>
      <Text size="xs" c="chatbox-tertiary">
        {t('Respond in the action bar at the bottom.')}
      </Text>
      {payload && (
        <Box style={{ maxHeight: APPROVAL_PAYLOAD_MAX_HEIGHT, overflow: 'auto' }}>
          <Code block style={PREFORMATTED_OVERFLOW_STYLE}>
            {payload}
          </Code>
        </Box>
      )}
      {pauseReason?.type === 'user_exec_approval' && pauseReason.explanation && (
        <Text size="xs" c="chatbox-secondary" style={PREFORMATTED_OVERFLOW_STYLE}>
          {pauseReason.explanation}
        </Text>
      )}
      {pauseReason?.type === 'user_exec_approval' && pauseReason.explanationError && (
        <Text size="xs" c="chatbox-tertiary">
          {t('Explanation failed')}
        </Text>
      )}
    </Stack>
  )
}

// Web search detail shown when a web_search timeline step is expanded: the
// queries plus the result cards (the same cards the old grouped card UI used).
const WebSearchDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const { t } = useTranslation()
  if (part.state === 'error') {
    return <ToolCallErrorDetails part={part} />
  }
  const results = extractSearchResults(part)
  const queries = extractSearchQueries([part])
  return (
    <Stack gap={6} style={{ minWidth: 0, maxWidth: '100%' }}>
      {queries.length > 0 && (
        <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
          {queries.map((query, index) => (
            <Text
              key={`${index}-${query}`}
              size="xs"
              c="chatbox-tertiary"
              fs="italic"
              lh={1.4}
              style={{ overflowWrap: 'anywhere' }}
            >
              "{query}"
            </Text>
          ))}
        </Group>
      )}
      {results.length > 0 ? (
        <SearchResultList results={results} />
      ) : (
        <Text size="sm" c="chatbox-tertiary">
          {t('Search unsuccessful')}
        </Text>
      )}
    </Stack>
  )
}

const TimelineToolCallDetail: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.state === 'paused') {
    return <PausedToolCallDetails part={part} />
  }
  if (part.toolName === 'web_search') {
    return <WebSearchDetails part={part} />
  }
  if (part.toolName === 'parse_link') {
    return <ParseLinkDetails part={part} />
  }
  if (isCommandExecutionPart(part)) {
    return <CommandExecutionDetails part={part} />
  }
  if (getToolResultImageReference(part)) {
    return <ViewImageDetails part={part} />
  }
  return <GeneralToolCallDetails part={part} />
}

// ─── View Image ─────────────────────────────────────────────────────

const ViewImageDetails: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  const setPictureShow = useUIStore((s) => s.setPictureShow)
  const result = part.result as Record<string, unknown> | undefined
  const storageKey = getToolResultImageReference(part)?.storageKey ?? ''
  const filePath =
    getFirstStringValue(part.args, ['file_path']) || (typeof result?.file_path === 'string' ? result.file_path : '')
  if (part.state !== 'result' || !storageKey) {
    return <GeneralToolCallDetails part={part} />
  }
  return (
    <Stack gap={6}>
      {filePath && (
        <Text size="xs" c="chatbox-tertiary" style={{ wordBreak: 'break-all' }}>
          {filePath}
        </Text>
      )}
      <Box
        style={{
          maxWidth: 320,
          borderRadius: 'var(--mantine-radius-md)',
          overflow: 'hidden',
          cursor: 'zoom-in',
          width: 'fit-content',
        }}
        onClick={() => setPictureShow({ picture: { storageKey } })}
      >
        <ImageInStorage storageKey={storageKey} />
      </Box>
    </Stack>
  )
}

type TimelineToolCallStepProps = {
  part: MessageToolCallPart
  /** Renders as a child of a folded run instead of a top-level step. */
  nested?: boolean
} & ToolCallActionContext

const TimelineToolCallStepContent: FC<TimelineToolCallStepProps & { commandResult?: Record<string, unknown> }> = ({
  part,
  nested,
  sessionId,
  messageId,
  commandResult,
}) => {
  const { t } = useTranslation()
  const acceptedImageTask = getAcceptedImageBackgroundTaskResult(part.result)
  const { data: imageRecord, isFetched: isImageRecordFetched } = useImageGenerationRecord(
    acceptedImageTask?.recordId ?? null
  )
  const referenceImages =
    imageRecord?.referenceImages ??
    (part.pauseReason?.type === 'app_action_approval' && part.pauseReason.details?.type === 'image_generation'
      ? part.pauseReason.details.referenceImages
      : undefined)
  const currentGeneratingId = useCurrentGeneratingId()
  const imageStatus = imageRecord?.status ?? acceptedImageTask?.status
  const isBackgroundWaiting =
    imageStatus === 'pending' ||
    imageStatus === 'generating' ||
    imageRecord?.errorCode === 'image_task_persistence_failed'
  const isBackgroundActive =
    Boolean(acceptedImageTask) && isBackgroundWaiting && currentGeneratingId === acceptedImageTask?.recordId
  const isBackgroundInterrupted = Boolean(acceptedImageTask) && isBackgroundWaiting && !isBackgroundActive
  const canResumeBackground = isBackgroundInterrupted && Boolean(imageRecord?.taskId)
  const isImageRecordLoading = Boolean(acceptedImageTask) && !isImageRecordFetched
  const isImageRecordMissing = Boolean(acceptedImageTask) && isImageRecordFetched && imageRecord == null
  const isBackgroundUnrecoverable =
    isBackgroundInterrupted && (isImageRecordMissing || (imageRecord != null && !imageRecord.taskId))
  const [isResumingBackground, setIsResumingBackground] = useState(false)
  const backgroundElapsed = useThinkingTimer(imageRecord?.createdAt ?? acceptedImageTask?.startedAt, isBackgroundActive)
  const isPaused = part.state === 'paused'
  const isLoading = part.state === 'call' || isBackgroundActive || isImageRecordLoading || isResumingBackground
  const commandExitCode = typeof commandResult?.exitCode === 'number' ? commandResult.exitCode : undefined
  // Stop marks every tool in the batch with `cancelled: true`, but the shape differs:
  // command tools settle as state 'result' (exit 130, possibly blob-offloaded), other
  // tools become state 'error' with a small inline result. Render both as "Stopped".
  const isCancelled = (commandResult ?? parseCommandExecutionResult(part.result))?.cancelled === true
  const isCommandFailure =
    isCommandExecutionPart(part) &&
    part.state === 'result' &&
    (commandResult?.success === false || (commandExitCode !== undefined && commandExitCode !== 0))
  const isBashNotAvailable = isBashNotAvailableResult(part)
  const isError =
    (part.state === 'error' && !isCancelled) ||
    isBashNotAvailable ||
    imageStatus === 'error' ||
    isBackgroundUnrecoverable ||
    (isCommandFailure && !isCancelled)
  // Paused steps stay collapsed — the decision lives in the pending-action bar
  // above the input box, so several pending steps don't unfold at once.
  const [expanded, setExpanded] = useAutoExpandOnSignal(stepNeedsUserAction(part))
  const isApprovalPaused = isPaused && isApprovalPauseReason(part.pauseReason)
  const stepRef = usePausedStepElementRegistration(sessionId, messageId, part.toolCallId, isPaused)
  const approvalHighlighted = useApprovalCardHighlighted(sessionId, messageId, part.toolCallId) && isPaused
  // The bar's "View" action reveals the details even if the user collapsed the step.
  useEffect(() => {
    if (approvalHighlighted) setExpanded(true)
  }, [approvalHighlighted, setExpanded])
  const Icon = getToolIcon(part.toolName)
  const handleResumeBackground = useCallback(async () => {
    if (!acceptedImageTask || !sessionId || !canResumeBackground || isResumingBackground) return
    setIsResumingBackground(true)
    try {
      await resumeImageGenerationWithFollowUp(acceptedImageTask.recordId, {
        sessionId,
        toolCallId: part.toolCallId,
      })
    } catch (error) {
      // `resumeGeneration` rejects with untranslated developer strings ("Record not found", "No task ID
      // found for this record"), so show a localized message here and keep the raw cause in the log.
      log.error('Failed to resume CLI image generation:', error)
      toastActions.add(t('Unable to resume image generation.'))
    } finally {
      setIsResumingBackground(false)
    }
  }, [acceptedImageTask, canResumeBackground, isResumingBackground, part.toolCallId, sessionId, t])

  // Another record occupying the generator is the only reason a resumable task cannot be resumed right now.
  const isBlockedByOtherGeneration = currentGeneratingId !== null && currentGeneratingId !== acceptedImageTask?.recordId
  const resumeDisabledReason = !sessionId
    ? t('This chat is no longer available.')
    : isBlockedByOtherGeneration
      ? t('Another image is being generated. Please wait.')
      : undefined

  // Per-step elapsed time: prefer the persisted duration, fall back to a live
  // timer while the call is still running. Hidden below the 2s threshold.
  const liveElapsed = useThinkingTimer(part.startTime, isLoading)
  const stepDuration = acceptedImageTask
    ? isBackgroundActive
      ? backgroundElapsed
      : 0
    : part.duration && part.duration > 0
      ? part.duration
      : isLoading
        ? liveElapsed
        : 0
  const showTime = stepDuration >= MIN_STEP_DURATION_MS

  // A settled step stays grey, failed ones included — the agent reads a failure and
  // carries on, and the summary names it. Color on this row means the step is running
  // or waiting on the user, so those are the only states that stand out.
  const stateColor =
    isPaused || canResumeBackground || isCancelled
      ? 'var(--chatbox-tint-warning)'
      : isLoading
        ? 'var(--chatbox-tint-brand)'
        : 'var(--chatbox-tint-tertiary)'
  const needsAttention = isPaused || canResumeBackground || isCancelled || isLoading

  const argSummary =
    part.toolName === 'user_exec'
      ? getFirstStringValue(part.args, ['command'])
      : part.toolName === 'code_execution'
        ? getFirstStringValue(part.args, ['code'])
        : part.toolName === 'create_download'
          ? getFirstStringValue(part.result, ['file_path']) || getFirstStringValue(part.args, ['file_path'])
          : part.toolName === 'parse_link'
            ? getFirstStringValue(part.args, ['url']) || getFirstStringValue(part.result, ['title', 'url'])
            : getFirstStringValue(part.args, ['path', 'file_path', 'query', 'pattern', 'command', 'skillName', 'name'])

  const resultSummary =
    !argSummary && part.state === 'result'
      ? getFirstStringValue(part.result, ['summary', 'title', 'content', 'stdout', 'stderr'])
      : undefined

  const summary = acceptedImageTask
    ? isBackgroundActive || isImageRecordLoading
      ? acceptedImageTask.wait.pollIntervalMs
        ? `${t('Generating image')} · ${t('Checking every {{time}}', {
            time: formatElapsedTime(acceptedImageTask.wait.pollIntervalMs),
          })}`
        : t('Generating image')
      : canResumeBackground
        ? t('Waiting to resume image generation')
        : isBackgroundUnrecoverable
          ? t('Image generation interrupted')
          : imageStatus === 'error'
            ? t('Image generation failed')
            : t('Image generated')
    : isCancelled
      ? t('Stopped')
      : isPaused
        ? t('Paused')
        : isLoading
          ? t('Running')
          : isBashNotAvailable
            ? t('Bash is not available on this Windows device.')
            : isError
              ? commandExitCode === undefined
                ? t('Failed')
                : `${t('Failed')} · exit ${commandExitCode}`
              : isCommandExecutionPart(part) && commandExitCode !== undefined
                ? `${truncateSummary(argSummary || t('Completed'))} · exit ${commandExitCode}`
                : truncateSummary(argSummary || resultSummary || t('Completed'))

  const hasDetail = isPaused || part.state !== 'call' || isCommandExecutionPart(part)
  // A step unfolded under the summary row of its run: no rail marker of its own,
  // a smaller label and the argument it ran against.
  const isStepChild = nested === true

  return (
    <Box ref={stepRef} pos="relative" style={{ minHeight: isStepChild ? 20 : TIMELINE_ROW_HEIGHT }}>
      <UnstyledButton
        onClick={hasDetail ? () => setExpanded((prev) => !prev) : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        className="group"
        style={{ cursor: hasDetail ? 'pointer' : 'default', maxWidth: '100%', display: 'block', width: '100%' }}
      >
        <Group
          gap={isStepChild ? 8 : TIMELINE_ICON_GAP}
          wrap="nowrap"
          align="center"
          style={{ minHeight: isStepChild ? 20 : TIMELINE_ROW_HEIGHT, maxWidth: '100%' }}
        >
          {!isStepChild && <TimelineStepIcon icon={Icon} stateColor={stateColor} />}
          <Text
            size="xs"
            fw={isStepChild || !needsAttention ? undefined : 500}
            c={isStepChild ? 'chatbox-secondary' : needsAttention ? 'chatbox-primary' : 'chatbox-tertiary'}
            lh="20px"
            className="shrink-0"
            style={{ fontSize: TIMELINE_LABEL_FONT_SIZE }}
          >
            {getToolName(part.toolName, part.args)}
          </Text>
          {summary && (
            <Text
              size="xs"
              c="chatbox-tertiary"
              lh="20px"
              truncate="end"
              style={{
                minWidth: 0,
                fontFamily: isStepChild ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : undefined,
              }}
            >
              {summary}
            </Text>
          )}
          {isLoading && <ToolCallRunningDots />}
          {showTime && (
            <Text size="xs" c="chatbox-tertiary" lh="20px" className="shrink-0 tabular-nums">
              {formatElapsedTime(stepDuration)}
            </Text>
          )}
          {hasDetail && (
            <InlineToolIcon
              icon={IconChevronDown}
              size={13}
              color="var(--chatbox-tertiary)"
              className={clsx('transition-transform', expanded ? 'rotate-180' : TIMELINE_DISCLOSURE_CLASS)}
            />
          )}
        </Group>
      </UnstyledButton>
      {canResumeBackground && (
        <Tooltip label={resumeDisabledReason} disabled={!resumeDisabledReason} withArrow>
          {/* A disabled Mantine Button drops pointer events, so the tooltip needs a wrapper to hover. */}
          <Box mt={2} w="fit-content">
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconPlayerPlay size={12} />}
              loading={isResumingBackground}
              disabled={Boolean(resumeDisabledReason)}
              onClick={() => void handleResumeBackground()}
            >
              {t('Resume Generation')}
            </Button>
          </Box>
        </Tooltip>
      )}
      {isBackgroundUnrecoverable && (
        <Text size="xs" c="chatbox-tertiary" mt={2}>
          {t('The original task cannot be resumed. Please send a new image generation request.')}
        </Text>
      )}
      {!!referenceImages?.length && (
        <Box mt={6}>
          <Text size="xs" c="chatbox-tertiary">
            {t('Reference images')}
          </Text>
          <ImageGenerationResultGallery images={referenceImages} compact />
        </Box>
      )}
      <Collapse in={expanded && hasDetail}>
        <Box
          // The rotating locate ring plays only after the pill's "View" action, as
          // the "here it is" feedback — not as a permanent attention grabber.
          className={approvalHighlighted ? 'chatbox-approval-ring' : undefined}
          style={{
            marginTop: 8,
            marginBottom: 2,
            // Details hang under the row's text column; a step unfolded inside a run
            // already sits in that column, so it only adds the group's own indent.
            marginLeft: isStepChild ? 0 : TIMELINE_DETAIL_INDENT,
            paddingLeft: TIMELINE_GROUP_INDENT,
            // Amber accent marks "decision needed" apart from routine tool details.
            borderLeft: isApprovalPaused ? TIMELINE_APPROVAL_BORDER : TIMELINE_GROUP_BORDER,
            color: 'var(--chatbox-tint-secondary)',
            minWidth: 0,
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <TimelineToolCallDetail part={part} />
        </Box>
      </Collapse>
    </Box>
  )
}

const CommandTimelineToolCallStep: FC<TimelineToolCallStepProps> = (props) => {
  const commandResult = useCommandExecutionResult(props.part)
  return <TimelineToolCallStepContent {...props} commandResult={commandResult} />
}

export const TimelineToolCallStep: FC<TimelineToolCallStepProps> = (props) =>
  isCommandExecutionPart(props.part) ? (
    <CommandTimelineToolCallStep {...props} />
  ) : (
    <TimelineToolCallStepContent {...props} />
  )
