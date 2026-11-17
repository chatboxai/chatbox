import { ActionIcon, Box, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import type { Message, MessageReasoningPart, MessageTextPart } from '@shared/types'
import { dominantWorkActivity, summarizeWorkActivity, type WorkActivityAction } from '@shared/work-activity'
import {
  buildWorkTimelineEntries,
  getActiveWorkPart,
  getLastWorkStep,
  getTimelinePartKey,
  measureToolCallCluster,
  type StepTimelineEntry,
  type StepTimelinePart,
} from '@shared/work-timeline'
import {
  IconBulb,
  IconChevronDown,
  IconCode,
  IconCopy,
  IconEdit,
  IconExternalLink,
  IconFile,
  IconFileSearch,
  IconPhoto,
  IconTerminal,
  IconWorld,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, type ReactNode, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { formatElapsedTime, MIN_STEP_DURATION_MS, useThinkingTimer } from '@/hooks/useThinkingTimer'
import { ReasoningInlineSummary } from './ReasoningInlineSummary'
import { TimelineToolCallStep, type ToolCallActionContext } from './ToolCallPartUI'
import {
  InlineToolIcon,
  TIMELINE_DETAIL_INDENT,
  TIMELINE_DISCLOSURE_CLASS,
  TIMELINE_GROUP_BORDER,
  TIMELINE_GROUP_INDENT,
  TIMELINE_ICON_GAP,
  TIMELINE_LABEL_FONT_SIZE,
  TIMELINE_ROW_GAP,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_TEXT_GAP,
  TimelineStepIcon,
  ToolCallRunningDots,
} from './timeline-primitives'

export type { StepTimelinePart } from '@shared/work-timeline'

const PRELINE_OVERFLOW_STYLE = { whiteSpace: 'pre-line', lineHeight: 1.5, overflowWrap: 'anywhere' } as const
const workActivityIconMap: Record<WorkActivityAction, React.ElementType> = {
  commands: IconTerminal,
  edits: IconEdit,
  fileSearch: IconFileSearch,
  files: IconFile,
  images: IconPhoto,
  pages: IconExternalLink,
  tools: IconCode,
  webSearch: IconWorld,
}
type CopyReasoningHandler = (content: string) => (e: React.MouseEvent<HTMLButtonElement>) => void

// Renders an intermediate assistant text block as a timeline node. Markdown
// rendering is delegated to the caller (Message owns the settings/uniqueId).
type RenderStepText = (part: MessageTextPart, index: number) => ReactNode

// What the assistant said between steps. It is the narration the activity rows sit
// between, so it reads as body text rather than as another step in a list.
const TimelineTextStep: FC<{ children: ReactNode }> = ({ children }) => (
  <Box
    className="text-sm break-words [overflow-wrap:anywhere] [&_p]:!my-0 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0"
    style={{ minWidth: 0, lineHeight: 1.65, color: 'var(--chatbox-tint-primary)' }}
  >
    {children}
  </Box>
)

// Shared reasoning display state, kept in sync with how a reasoning block is
// rendered both standalone (ReasoningContentUI) and inside the step timeline.
function useReasoningState(message: Message | undefined, part: MessageReasoningPart | undefined) {
  const reasoningContent = part?.text ?? message?.reasoningContent ?? ''
  const hasActiveStatus = (message?.status?.length ?? 0) > 0
  const rawIsThinking =
    (message?.generating && !!part && !hasActiveStatus && getActiveWorkPart(message) === part) || false

  // Once thinking transitions to done, lock it as done to prevent flicker
  // when new content parts are appended during streaming.
  const wasEverDoneRef = useRef(false)
  if (!rawIsThinking && (reasoningContent.length > 0 || (part?.duration && part.duration > 0))) {
    wasEverDoneRef.current = true
  }
  const isThinking = rawIsThinking && !wasEverDoneRef.current

  const elapsedTime = useThinkingTimer(part?.startTime, isThinking)
  const displayTime =
    part?.duration && part.duration > 0 ? part.duration : isThinking && elapsedTime > 0 ? elapsedTime : 0

  return { reasoningContent, isThinking, displayTime }
}

const TimelineReasoningStep: FC<{
  part?: MessageReasoningPart
  message?: Message
  nested?: boolean
  onCopyReasoningContent?: CopyReasoningHandler
}> = ({ part, message, nested, onCopyReasoningContent }) => {
  const { t } = useTranslation()
  const { reasoningContent, isThinking, displayTime } = useReasoningState(message, part)
  const [expanded, setExpanded] = useState(false)
  const shouldShowTimer = message?.isStreamingMode === true
  const showTime = shouldShowTimer && displayTime >= MIN_STEP_DURATION_MS
  const hasDetail = reasoningContent.length > 0

  // Thinking is a settled step once it ends; only the live one carries color.
  const stateColor = isThinking ? 'var(--chatbox-tint-brand)' : 'var(--chatbox-tint-tertiary)'

  const label = isThinking ? t('Thinking') : t('Deeply thought')

  const isStepChild = nested === true

  return (
    <Box pos="relative" style={{ minHeight: isStepChild ? 20 : TIMELINE_ROW_HEIGHT }}>
      <UnstyledButton
        onClick={hasDetail ? () => setExpanded((prev) => !prev) : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        className="group"
        style={{ cursor: hasDetail ? 'pointer' : 'default', width: '100%', maxWidth: '100%', display: 'block' }}
      >
        <Group
          gap={isStepChild ? 8 : TIMELINE_ICON_GAP}
          wrap="nowrap"
          align="center"
          style={{ minHeight: isStepChild ? 20 : TIMELINE_ROW_HEIGHT, maxWidth: '100%' }}
        >
          {!isStepChild && <TimelineStepIcon icon={IconBulb} stateColor={stateColor} />}
          <Text
            size="xs"
            c={isStepChild || isThinking ? 'chatbox-secondary' : 'chatbox-tertiary'}
            lh="20px"
            className="shrink-0"
            style={{ fontSize: TIMELINE_LABEL_FONT_SIZE }}
          >
            {label}
          </Text>
          {isThinking && <ToolCallRunningDots />}
          {showTime && (
            <Text size="xs" c="chatbox-tertiary" lh="20px" className="shrink-0 tabular-nums">
              {formatElapsedTime(displayTime)}
            </Text>
          )}
          {!expanded && isThinking && <ReasoningInlineSummary content={reasoningContent} isThinking />}
          {expanded && hasDetail && onCopyReasoningContent && (
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
      <Collapse in={expanded && hasDetail}>
        <Box
          style={{
            marginTop: 8,
            marginBottom: 2,
            marginLeft: isStepChild ? 0 : TIMELINE_DETAIL_INDENT,
            paddingLeft: TIMELINE_GROUP_INDENT,
            borderLeft: TIMELINE_GROUP_BORDER,
            maxHeight: 400,
            overflowY: 'auto',
          }}
        >
          <Text size="sm" c="chatbox-tertiary" style={PRELINE_OVERFLOW_STYLE}>
            {reasoningContent}
          </Text>
        </Box>
      </Collapse>
    </Box>
  )
}

// The folded form of a run: one quiet line naming what ran, unfolding into the list
// of steps it stands for. It keeps the same leading icon column as a step, but stays
// grey — the steps that need a decision are the ones allowed to carry color.
const ToolCallClusterRow: FC<{
  icon: React.ElementType
  summary: string
  durationMs: number
  expanded: boolean
  marginTop: number
  onToggle: () => void
  children?: ReactNode
}> = ({ icon, summary, durationMs, expanded, marginTop, onToggle, children }) => {
  const showTime = durationMs >= MIN_STEP_DURATION_MS

  return (
    <Box pos="relative" style={{ minHeight: TIMELINE_ROW_HEIGHT, marginTop }}>
      <UnstyledButton
        onClick={onToggle}
        aria-expanded={expanded}
        className="group"
        style={{ maxWidth: '100%', display: 'block', cursor: 'pointer', width: '100%' }}
      >
        <Group
          gap={TIMELINE_ICON_GAP}
          wrap="nowrap"
          align="center"
          style={{ minHeight: TIMELINE_ROW_HEIGHT, maxWidth: '100%' }}
        >
          <TimelineStepIcon icon={icon} stateColor="var(--chatbox-tint-tertiary)" />
          <Text
            size="xs"
            c={expanded ? 'chatbox-secondary' : 'chatbox-tertiary'}
            lh="20px"
            truncate="end"
            title={summary}
            style={{ minWidth: 0, fontSize: TIMELINE_LABEL_FONT_SIZE }}
          >
            {summary}
          </Text>
          <InlineToolIcon
            icon={IconChevronDown}
            size={13}
            color="var(--chatbox-tertiary)"
            className={clsx('transition-transform', expanded ? 'rotate-180' : TIMELINE_DISCLOSURE_CLASS)}
          />
          {showTime && (
            <Text size="xs" c="chatbox-tertiary" lh="20px" className="shrink-0 tabular-nums">
              {formatElapsedTime(durationMs)}
            </Text>
          )}
        </Group>
      </UnstyledButton>
      {children}
    </Box>
  )
}

function isTextRow(row: StepTimelineEntry | undefined): boolean {
  return row?.type === 'part' && row.part.type === 'text'
}

// The work an assistant message did, read as narration with quiet activity rows
// between it: settled tool calls fold into one row naming what they did, while the
// step that is running or needs user action keeps a row of its own.
export const StepTimelineUI: FC<
  {
    parts: StepTimelinePart[]
    message?: Message
    onCopyReasoningContent?: CopyReasoningHandler
    renderText?: RenderStepText
  } & ToolCallActionContext
> = ({ parts, message, sessionId, messageId, onCopyReasoningContent, renderText }) => {
  const { t, i18n } = useTranslation()
  const activePart = message ? getActiveWorkPart(message) : null
  // A group is a slice of the message, so the step to single out comes from the
  // message: an image or an answer can split a run, leaving a group that ends on a
  // step the run actually carried on past.
  const lastStep = message ? getLastWorkStep(message.contentParts) : null
  const canceled = message?.finishReason === 'canceled'
  const entries = useMemo(
    () => buildWorkTimelineEntries(parts, { activePart, lastStep, canceled }),
    [parts, activePart, lastStep, canceled]
  )
  const [unfoldedClusters, setUnfoldedClusters] = useState<ReadonlySet<string>>(() => new Set())

  const renderStep = (part: StepTimelinePart, index: number, nested: boolean): ReactNode => {
    if (part.type === 'reasoning') {
      return (
        <TimelineReasoningStep
          key={`reasoning-${index}`}
          part={part}
          message={message}
          nested={nested}
          onCopyReasoningContent={onCopyReasoningContent}
        />
      )
    }
    if (part.type === 'text') {
      return (
        <TimelineTextStep key={`text-${index}`}>
          {renderText ? (
            renderText(part, index)
          ) : (
            <Text size="sm" style={PRELINE_OVERFLOW_STYLE}>
              {part.text}
            </Text>
          )}
        </TimelineTextStep>
      )
    }
    // A tool call carries its own identity, so folding and unfolding a run around it
    // never hands its expanded detail to a different call.
    return (
      <TimelineToolCallStep
        key={part.toolCallId}
        part={part}
        nested={nested}
        sessionId={sessionId}
        messageId={messageId}
      />
    )
  }

  return (
    <Box pos="relative" my={8} mb={12} style={{ minWidth: 0, maxWidth: '100%' }}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        {entries.map((row, rowIndex) => {
          const previous = entries[rowIndex - 1]
          const marginTop =
            rowIndex === 0 ? 0 : isTextRow(row) || isTextRow(previous) ? TIMELINE_TEXT_GAP : TIMELINE_ROW_GAP
          if (row.type === 'cluster') {
            const clusterKey = `${message?.id ?? messageId ?? ''}:${getTimelinePartKey(row.steps[0].part, row.steps[0].index)}`
            const expanded = unfoldedClusters.has(clusterKey)
            const activity = row.steps.map(({ part }) => part)
            // A folded run shows the icon of the action it is mostly made of.
            return (
              <ToolCallClusterRow
                key={`cluster-${clusterKey}`}
                icon={workActivityIconMap[dominantWorkActivity(activity)]}
                marginTop={marginTop}
                summary={summarizeWorkActivity(activity, t, i18n.language)}
                durationMs={measureToolCallCluster(row.steps)}
                expanded={expanded}
                onToggle={() =>
                  setUnfoldedClusters((current) => {
                    const next = new Set(current)
                    if (!next.delete(clusterKey)) next.add(clusterKey)
                    return next
                  })
                }
              >
                {expanded && (
                  // Unfolded steps are the summary row's list, not steps beside it: they
                  // drop their own icon and sit together behind one hairline.
                  <Box
                    data-timeline-group="fold"
                    style={{
                      marginTop: 8,
                      marginBottom: 2,
                      marginLeft: TIMELINE_DETAIL_INDENT,
                      paddingLeft: TIMELINE_GROUP_INDENT,
                      borderLeft: TIMELINE_GROUP_BORDER,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    {row.steps.map(({ part, index }) => renderStep(part, index, true))}
                  </Box>
                )}
              </ToolCallClusterRow>
            )
          }
          return (
            <Box key={getTimelinePartKey(row.part, row.index)} style={{ marginTop, minWidth: 0 }}>
              {renderStep(row.part, row.index, false)}
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}

// ─── Reasoning / Thinking (Minimal Inline) ──────────────────────────

export const ReasoningContentUI: FC<{
  message: Message
  part?: MessageReasoningPart
  onCopyReasoningContent: (content: string) => (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ message, part, onCopyReasoningContent }) => (
  <Box my={8} mb={12}>
    <TimelineReasoningStep part={part} message={message} onCopyReasoningContent={onCopyReasoningContent} />
  </Box>
)
