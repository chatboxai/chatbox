import {
  type ApprovalPauseReason,
  listPendingPauseInteractions,
  type PendingPauseInteraction,
} from '@chatbox/core/message-approval'
import { Box, Button, Group, Menu, Spoiler, Text, UnstyledButton } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type { ImageGenerationApprovalDetails, Session } from '@shared/types'
import {
  IconAlertCircle,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconPhoto,
  IconPlayerPause,
  IconX,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, type MouseEvent, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentGenerationService } from '@/adapters/CurrentGenerationService'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getLogger } from '@/lib/utils'
import { formatComputePointsRemainingRatio } from '@/packages/chatbox-cli/compute-points'
import { getFileMutationDisplayStats } from '@/packages/model-calls/toolsets/file-mutation-stats'
import { pulsePendingActionBar, revealPausedStep, usePendingActionBarPulseToken } from '@/stores/approvalAttentionStore'
import * as toastActions from '@/stores/toastActions'
import { INPUT_SURFACE_CLASS_NAME, INPUT_SURFACE_MIN_HEIGHT_CLASS_NAME, INPUT_SURFACE_STYLE } from './inputSurface'

// Every "the agent is waiting on a user decision" interaction renders here —
// approvals (command / escalation / file / app action) and the tool-call-limit
// pause. While an approval holds the input locked this takes over the input box
// slot itself (same frame, same height, primary action where Send sits), so the
// decision is where the user's attention and cursor already are. One decision
// shows at a time with k/N progress, so acting visibly advances to the next.

const log = getLogger('pending-action-bar')

const PAYLOAD_MAX_HEIGHT = 'min(200px, 30vh)'
/** Explanations taller than this (px) start collapsed behind "Show more". */
const EXPLANATION_SPOILER_HEIGHT = 44
/** Above this, the segment strip turns into just the k/N counter. */
const MAX_PROGRESS_SEGMENTS = 6
/**
 * A click landing right after a decision appears was likely aimed at whatever
 * occupied that spot before — the Send button this bar replaced, or the previous
 * decision that just advanced away. Swallow decision clicks until the item has
 * been visible for a beat (the input-protection pattern browser permission
 * prompts use). Exported for tests.
 */
export const PENDING_ACTION_ARMING_MS = 300

type PendingAction = 'approve' | 'deny' | 'continue' | 'stop'

function isResolveAction(action: PendingAction): boolean {
  return action === 'approve' || action === 'continue'
}

function getInteractionKey(interaction: PendingPauseInteraction): string {
  const pauseType = interaction.kind === 'approval' ? interaction.pauseReason.type : interaction.kind
  return JSON.stringify([interaction.messageId, interaction.toolCallId, pauseType])
}

function getActiveConversationKey(session: Session): string {
  const activeForkPath = session.messages.flatMap((message) => {
    const fork = session.messageForksHash?.[message.id]
    return fork ? [[message.id, fork.position] as const] : []
  })
  return JSON.stringify([session.messages[0]?.id ?? session.id, activeForkPath])
}

function getImageGenerationDetails(pauseReason: ApprovalPauseReason): ImageGenerationApprovalDetails | undefined {
  if (pauseReason.type !== 'app_action_approval' || pauseReason.action !== 'image.generate') return undefined
  return pauseReason.details?.type === 'image_generation' ? pauseReason.details : undefined
}

/** Command / file previews are the only place the bar shows a working directory. */
function getWorkdir(interaction: PendingPauseInteraction): string | undefined {
  if (interaction.kind !== 'approval') return undefined
  const { pauseReason } = interaction
  return pauseReason.type === 'user_exec_approval' || pauseReason.type === 'command_escalation_approval'
    ? pauseReason.workdir
    : undefined
}

const PayloadBlock: FC<{ children: string; mono?: boolean }> = ({ children, mono = true }) => (
  <Box
    className="rounded-md bg-chatbox-background-primary px-2.5 py-2"
    style={{
      maxHeight: PAYLOAD_MAX_HEIGHT,
      overflow: 'auto',
      fontFamily: mono ? 'var(--mantine-font-family-monospace)' : undefined,
      fontSize: 13,
      lineHeight: 1.55,
      color: 'var(--chatbox-tint-primary)',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    }}
  >
    {children}
  </Box>
)

const MutedText: FC<{ children: string }> = ({ children }) => (
  <Text size="xs" c="chatbox-tertiary" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
    {children}
  </Text>
)

/** Model-written rationale: two lines by default, expandable in place. */
const ExplanationText: FC<{ children: string }> = ({ children }) => {
  const { t } = useTranslation()
  return (
    <Spoiler
      maxHeight={EXPLANATION_SPOILER_HEIGHT}
      showLabel={t('Show more')}
      hideLabel={t('Show less')}
      styles={{ control: { fontSize: 'var(--mantine-font-size-xs)' } }}
    >
      <MutedText>{children}</MutedText>
    </Spoiler>
  )
}

const ImageGenerationApprovalBody: FC<{ details: ImageGenerationApprovalDetails }> = ({ details }) => {
  const { t, i18n } = useTranslation()
  const usesChatboxQuota = details.billing === 'chatbox_quota'
  const computePointsRemainingRatio = details.computePointsRemainingRatio ?? details.computePointsRemaining

  return (
    <>
      <PayloadBlock mono={false}>{details.prompt}</PayloadBlock>
      <Group gap="md" wrap="wrap">
        <Text size="xs" c="chatbox-tertiary">
          {t('Number of images')}: {details.count}
          {details.aspectRatio ? ` · ${details.aspectRatio}` : ''}
          {details.style ? ` · ${details.style}` : ''}
        </Text>
        <Text size="xs" c="chatbox-tertiary">
          {usesChatboxQuota
            ? t('This request will consume {{count}} image quota and compute points.', { count: details.count })
            : t('This request may incur charges from {{provider}}.', { provider: details.provider })}
        </Text>
        {usesChatboxQuota && details.imageQuota && (
          <Text size="xs" c="chatbox-tertiary">
            {t('Image quota remaining: {{remaining}} / {{total}}', {
              remaining: details.imageQuota.remaining.toLocaleString(),
              total: details.imageQuota.total.toLocaleString(),
            })}
          </Text>
        )}
        {usesChatboxQuota && computePointsRemainingRatio !== undefined && (
          <Text size="xs" c="chatbox-tertiary">
            {t('Compute points remaining: {{points}}', {
              points: formatComputePointsRemainingRatio(computePointsRemainingRatio, i18n.language),
            })}
          </Text>
        )}
      </Group>
    </>
  )
}

/** File approvals show magnitude only; the exact diff is intentionally omitted. */
const FileMutationBody: FC<{ pauseReason: Extract<ApprovalPauseReason, { type: 'file_mutation_approval' }> }> = ({
  pauseReason,
}) => {
  const { t } = useTranslation()
  // Legacy pauses recover the counts by diffing the persisted preview — memoized
  // so acting/pulse re-renders don't redo that work.
  const stats = useMemo(() => getFileMutationDisplayStats(pauseReason), [pauseReason])
  if (!stats) return null
  const approximation = stats.approximate ? '~' : ''

  return (
    <Group gap={8} wrap="nowrap">
      {stats.mode === 'write' ? (
        <Text size="xs" c="chatbox-tertiary">
          {stats.approximate && '~ '}
          {t('Writing {{count}} lines', { count: stats.addedLines })}
        </Text>
      ) : (
        <Text size="xs" className="tabular-nums">
          <span style={{ color: 'var(--chatbox-tint-success)' }}>
            {approximation}+{stats.addedLines}
          </span>{' '}
          <span style={{ color: 'var(--chatbox-tint-error)' }}>
            {approximation}-{stats.removedLines}
          </span>
        </Text>
      )}
    </Group>
  )
}

/** Body only — what the decision is about lives in the heading. */
const ApprovalBody: FC<{ pauseReason: ApprovalPauseReason }> = ({ pauseReason }) => {
  const { t } = useTranslation()
  const imageDetails = getImageGenerationDetails(pauseReason)
  if (imageDetails) return <ImageGenerationApprovalBody details={imageDetails} />

  switch (pauseReason.type) {
    case 'user_exec_approval':
      return (
        <>
          <PayloadBlock>{pauseReason.command}</PayloadBlock>
          {pauseReason.explanation && <ExplanationText>{pauseReason.explanation}</ExplanationText>}
          {pauseReason.explanationError && (
            <Text size="xs" c="chatbox-tertiary">
              {t('Explanation failed')}
            </Text>
          )}
        </>
      )
    case 'command_escalation_approval':
      return (
        <>
          <PayloadBlock>{pauseReason.command}</PayloadBlock>
          <ExplanationText>{pauseReason.justification}</ExplanationText>
        </>
      )
    case 'file_mutation_approval':
      return <FileMutationBody pauseReason={pauseReason} />
    case 'app_action_approval':
      return <PayloadBlock>{pauseReason.preview}</PayloadBlock>
  }
}

const PendingProgress: FC<{ current: number; total: number }> = ({ current, total }) => (
  <Group gap={6} wrap="nowrap" className="shrink-0">
    {total <= MAX_PROGRESS_SEGMENTS && (
      <Box className="flex" style={{ gap: 3 }} aria-hidden>
        {Array.from({ length: total }, (_, index) => ({ id: `segment-${index}`, filled: index < current })).map(
          (segment) => (
            <Box
              key={segment.id}
              style={{
                width: 14,
                height: 3,
                borderRadius: 2,
                backgroundColor: segment.filled
                  ? 'var(--chatbox-tint-brand)'
                  : 'color-mix(in srgb, var(--chatbox-tint-tertiary), transparent 65%)',
              }}
            />
          )
        )}
      </Box>
    )}
    <Text data-testid={TestId.toolCall.actionBarProgress} size="xs" c="chatbox-tertiary" className="tabular-nums">
      {current} / {total}
    </Text>
  </Group>
)

const PendingHeading: FC<{
  interaction: PendingPauseInteraction
  progress: { current: number; total: number } | null
  progressKey: number
  onView: () => void
}> = ({ interaction, progress, progressKey, onView }) => {
  const { t } = useTranslation()

  let Icon = IconAlertCircle
  let iconColor = 'var(--chatbox-tint-warning)'
  let title = t('Waiting for approval') || ''
  let subtitle = ''

  if (interaction.kind === 'tool_call_limit') {
    Icon = IconPlayerPause
    iconColor = 'var(--chatbox-tint-tertiary)'
    title = t('Paused') || ''
    subtitle = t('{{count}} steps', { count: interaction.maxToolCalls }) || ''
  } else {
    const { pauseReason } = interaction
    const imageDetails = getImageGenerationDetails(pauseReason)
    if (imageDetails) {
      Icon = IconPhoto
      iconColor = 'var(--chatbox-tint-brand)'
      subtitle = `${t('Generate images')} · ${imageDetails.provider} / ${imageDetails.modelId}`
    } else {
      switch (pauseReason.type) {
        case 'user_exec_approval':
          subtitle = t('Run Command') || ''
          break
        case 'command_escalation_approval':
          subtitle = t('Retry with full access') || ''
          break
        default:
          subtitle = pauseReason.title
          break
      }
    }
  }

  return (
    <Group gap={8} wrap="nowrap">
      <Icon size={14} color={iconColor} style={{ flexShrink: 0 }} />
      <Text size="sm" fw={600} c="chatbox-primary" className="shrink-0">
        {title}
      </Text>
      {subtitle && (
        <Text size="xs" c="chatbox-tertiary" truncate="end" title={subtitle}>
          {subtitle}
        </Text>
      )}
      <Group gap={10} wrap="nowrap" className="ml-auto shrink-0">
        {progress && (
          <Box key={progressKey} className="chatbox-action-progress-pop">
            <PendingProgress current={progress.current} total={progress.total} />
          </Box>
        )}
        <UnstyledButton
          data-testid={TestId.toolCall.actionBarView}
          className="flex items-center text-chatbox-tertiary hover:text-chatbox-brand"
          style={{ gap: 2, fontSize: 'var(--mantine-font-size-xs)' }}
          onClick={onView}
        >
          {t('View')}
          <IconArrowUp size={12} />
        </UnstyledButton>
      </Group>
    </Group>
  )
}

type PendingActionBarProps = { session: Session }

const PendingActionBarContent: FC<PendingActionBarProps> = ({ session }) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const interactions = useMemo(() => listPendingPauseInteractions(session.messages), [session.messages])
  const interactionKeys = useMemo(() => interactions.map(getInteractionKey), [interactions])
  const current: PendingPauseInteraction | undefined = interactions[0]
  const currentKey = current ? getInteractionKey(current) : undefined

  // Input protection: (re)arm whenever the displayed decision changes, including
  // first mount. Written during render so no click can land before an effect runs.
  const armingRef = useRef<{ key: string | undefined; until: number } | null>(null)
  if (!armingRef.current || armingRef.current.key !== currentKey) {
    armingRef.current = { key: currentKey, until: Date.now() + PENDING_ACTION_ARMING_MS }
  }

  // Progress across a review episode: total holds steady while items resolve, so
  // acting reads 1/3 → 2/3 → 3/3 instead of always showing "1 of what's left".
  const [episode, setEpisode] = useState<{ total: number; done: number; pendingKeys: string[] }>({
    total: 0,
    done: 0,
    pendingKeys: [],
  })
  useEffect(() => {
    setEpisode((prev) => {
      if (interactionKeys.length === 0) {
        return prev.total === 0 ? prev : { total: 0, done: 0, pendingKeys: [] }
      }
      if (prev.total === 0) return { total: interactionKeys.length, done: 0, pendingKeys: interactionKeys }

      const previous = new Set(prev.pendingKeys)
      const next = new Set(interactionKeys)
      const removed = prev.pendingKeys.filter((key) => !next.has(key)).length
      const added = interactionKeys.filter((key) => !previous.has(key)).length
      if (removed === 0 && added === 0) return prev

      return {
        total: prev.total + added,
        done: prev.done + removed,
        pendingKeys: interactionKeys,
      }
    })
  }, [interactionKeys])

  // The clicked button shows a spinner until its item leaves the pending list.
  const [acting, setActing] = useState<{ interactionKey: string; action: PendingAction } | null>(null)
  useEffect(() => {
    if (acting && !interactionKeys.includes(acting.interactionKey)) {
      setActing(null)
    }
  }, [interactionKeys, acting])

  // Transient ✓ / ✕ burst when an item resolves — the "your click worked" cue.
  const lastActionRef = useRef<PendingAction>('approve')
  const prevDoneRef = useRef(0)
  const [resolveFlash, setResolveFlash] = useState<{ key: number; resolved: boolean } | null>(null)
  useEffect(() => {
    if (episode.done > prevDoneRef.current) {
      setResolveFlash({ key: episode.done, resolved: isResolveAction(lastActionRef.current) })
    }
    prevDoneRef.current = episode.done
  }, [episode.done])

  // Attention pulse for a click that lands on the bar instead of the input it
  // replaced. Two identical classes are alternated so consecutive clicks restart
  // the CSS animation; tokens from before this bar mounted are ignored.
  const pulseToken = usePendingActionBarPulseToken()
  const initialPulseTokenRef = useRef(pulseToken)
  const showPulse = pulseToken > initialPulseTokenRef.current

  if (!current) return null

  const runAction = (interaction: PendingPauseInteraction, action: PendingAction) => {
    if (acting) return
    if (Date.now() < (armingRef.current?.until ?? 0)) return
    const interactionKey = getInteractionKey(interaction)
    lastActionRef.current = action
    setActing({ interactionKey, action })
    const request = isResolveAction(action)
      ? currentGenerationService.continuePausedToolCall(session.id, interaction.messageId, interaction.toolCallId)
      : currentGenerationService.stopPausedToolCall(session.id, interaction.messageId, interaction.toolCallId)
    request
      .catch((error) => {
        log.error(`Failed to ${action} paused tool call:`, error)
        toastActions.add(t('Failed to apply the action. Please try again.'))
      })
      .finally(() => {
        setActing((currentAction) => (currentAction?.interactionKey === interactionKey ? null : currentAction))
      })
  }

  const handleDontAskAgain = (interaction: PendingPauseInteraction, scope: 'session' | 'global') => {
    if (interaction.kind !== 'tool_call_limit' || acting) return
    const interactionKey = getInteractionKey(interaction)
    lastActionRef.current = 'continue'
    setActing({ interactionKey, action: 'continue' })
    const count = interaction.maxToolCalls
    currentGenerationService
      .disableToolCallLimitPauseAndContinue(session.id, interaction.messageId, interaction.toolCallId, scope)
      .then(() => {
        toastActions.add(
          scope === 'global'
            ? t("Chats won't pause every {{count}} steps anymore. You can turn it back on in Settings.", { count })
            : t(
                "This chat won't pause every {{count}} steps anymore. You can turn it back on in Conversation Settings.",
                { count }
              )
        )
      })
      .catch((error) => {
        log.error('Failed to turn off the step pause:', error)
        toastActions.add(t('Failed to update the setting. Please try again.'))
      })
      .finally(() => {
        setActing((currentAction) => (currentAction?.interactionKey === interactionKey ? null : currentAction))
      })
  }

  // Clicks that miss the buttons are the user reaching for the input that this
  // bar replaced; pulse instead of silently swallowing them.
  const handleSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, [role="menuitem"]')) return
    pulsePendingActionBar()
  }

  const isActing = acting?.interactionKey === currentKey
  const isImageApproval = current.kind === 'approval' && getImageGenerationDetails(current.pauseReason) !== undefined
  const workdir = getWorkdir(current)

  return (
    <Box
      data-testid={TestId.toolCall.actionBar}
      onClickCapture={handleSurfaceClick}
      className={clsx(
        INPUT_SURFACE_CLASS_NAME,
        !isSmallScreen && INPUT_SURFACE_MIN_HEIGHT_CLASS_NAME,
        showPulse && (pulseToken % 2 === 1 ? 'chatbox-action-bar-pulse' : 'chatbox-action-bar-pulse-alt')
      )}
      style={INPUT_SURFACE_STYLE}
    >
      {resolveFlash && (
        <Box
          key={resolveFlash.key}
          className="chatbox-action-resolve-flash absolute flex items-center justify-center rounded-full"
          style={{
            top: 10,
            right: 12,
            width: 20,
            height: 20,
            color: resolveFlash.resolved ? 'var(--chatbox-tint-success)' : 'var(--chatbox-tint-error)',
            backgroundColor: resolveFlash.resolved
              ? 'color-mix(in srgb, var(--chatbox-tint-success), transparent 86%)'
              : 'color-mix(in srgb, var(--chatbox-tint-error), transparent 86%)',
            zIndex: 1,
          }}
        >
          {resolveFlash.resolved ? <IconCheck size={13} stroke={3} /> : <IconX size={13} stroke={3} />}
        </Box>
      )}

      {/* Keyed by the full interaction so a new pause reason animates on the same tool call. */}
      <Box key={currentKey} className="chatbox-action-item-enter flex flex-col px-2" style={{ gap: 7 }}>
        <PendingHeading
          interaction={current}
          progress={
            episode.total > 1 ? { current: Math.min(episode.done + 1, episode.total), total: episode.total } : null
          }
          progressKey={episode.done}
          onView={() => void revealPausedStep(session.id, current.messageId, current.toolCallId)}
        />
        {current.kind === 'approval' ? (
          <ApprovalBody pauseReason={current.pauseReason} />
        ) : (
          <MutedText>
            {t('Paused after {{count}} steps. Check whether the task is on track, then continue or stop to adjust.', {
              count: current.maxToolCalls,
            })}
          </MutedText>
        )}
      </Box>

      <Group justify={workdir ? 'space-between' : 'flex-end'} wrap="nowrap" gap="sm">
        {workdir && (
          <Text size="xs" c="chatbox-tertiary" truncate="end" className="min-w-0 pl-2" title={workdir}>
            {workdir}
          </Text>
        )}
        <Group gap={6} wrap="nowrap" className="shrink-0">
          <Button
            data-testid={TestId.toolCall.deny}
            variant="default"
            size="compact-sm"
            h={32}
            px={12}
            radius="md"
            loading={isActing && (acting?.action === 'deny' || acting?.action === 'stop')}
            disabled={isActing && isResolveAction(acting?.action ?? 'approve')}
            onClick={() => runAction(current, current.kind === 'approval' ? 'deny' : 'stop')}
          >
            {current.kind === 'approval' ? (isImageApproval ? t('Cancel') : t('Deny')) : t('Stop')}
          </Button>
          {current.kind === 'tool_call_limit' ? (
            <Button.Group>
              <Button
                data-testid={TestId.toolCall.continue}
                size="compact-sm"
                h={32}
                px={16}
                radius="xl"
                fw={500}
                color="chatbox-brand"
                loading={isActing && acting?.action === 'continue'}
                disabled={isActing && acting?.action !== 'continue'}
                onClick={() => runAction(current, 'continue')}
              >
                {t('Continue')}
              </Button>
              <Menu position="top-end" shadow="md">
                <Menu.Target>
                  <Button
                    data-testid={TestId.toolCall.dontAskAgain}
                    size="compact-sm"
                    h={32}
                    px={8}
                    radius="xl"
                    color="chatbox-brand"
                    disabled={Boolean(acting)}
                    aria-label={t('More continue options')}
                    style={{ borderInlineStart: '1px solid rgba(255, 255, 255, 0.35)' }}
                  >
                    <IconChevronDown size={12} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown maw="min(20rem, calc(100vw - 1.5rem))">
                  <Menu.Item
                    data-testid={TestId.toolCall.dontAskAgainSession}
                    style={{ whiteSpace: 'normal' }}
                    onClick={() => handleDontAskAgain(current, 'session')}
                  >
                    {t("Continue, and don't pause this chat again")}
                  </Menu.Item>
                  <Menu.Item
                    data-testid={TestId.toolCall.dontAskAgainGlobal}
                    style={{ whiteSpace: 'normal' }}
                    onClick={() => handleDontAskAgain(current, 'global')}
                  >
                    {t("Continue, and don't pause any chat again")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Button.Group>
          ) : (
            <Button
              data-testid={TestId.toolCall.approve}
              size="compact-sm"
              h={32}
              px={16}
              radius="xl"
              fw={500}
              leftSection={<IconCheck size={15} stroke={2.5} />}
              color="chatbox-brand"
              loading={isActing && acting?.action === 'approve'}
              disabled={isActing && acting?.action !== 'approve'}
              onClick={() => runAction(current, 'approve')}
            >
              {isImageApproval ? t('Approve and generate') : t('Approve')}
            </Button>
          )}
        </Group>
      </Group>
    </Box>
  )
}

const PendingActionBar: FC<PendingActionBarProps> = (props) => {
  // Checked here (cached per messages identity, shared with InputBox) so the
  // conversation-key walk below only runs while a decision is actually showing.
  if (listPendingPauseInteractions(props.session.messages).length === 0) return null
  // InputBox stays mounted while switching historical threads or message forks.
  // The first message distinguishes thread histories; active fork positions
  // distinguish branches that intentionally share that prefix.
  return <PendingActionBarContent key={getActiveConversationKey(props.session)} {...props} />
}

export default memo(PendingActionBar)
