import { Button, Flex, Loader, Text } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconPlayerPlay, IconSparkles } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { cn } from '@/lib/utils'
import type { ChatBridgeShellAction, ChatBridgeShellState } from './chatbridge'

interface ChatBridgeShellProps {
  state: ChatBridgeShellState
  title: string
  description: string
  surfaceTitle: string
  surfaceDescription: string
  statusLabel: string
  fallbackTitle?: string
  fallbackText?: string
  goalLabel?: string
  goalText?: string
  recoveryLabel?: string
  recoveryText?: string
  recoveryFootnote?: string
  recoveryTone?: 'warning' | 'calm'
  primaryAction?: ChatBridgeShellAction
  secondaryAction?: ChatBridgeShellAction
  children?: ReactNode
  className?: string
}

function getStateStyles(state: ChatBridgeShellState) {
  return {
    loading: {
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
      accent: 'border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20',
      icon: null,
    },
    ready: {
      badge: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
      accent: 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/20',
      icon: IconSparkles,
    },
    active: {
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
      accent: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/20',
      icon: IconPlayerPlay,
    },
    complete: {
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
      accent: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/20',
      icon: IconCheck,
    },
    error: {
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
      accent: 'border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20',
      icon: IconAlertTriangle,
    },
  }[state]
}

export function ChatBridgeShell(props: ChatBridgeShellProps) {
  const {
    state,
    title,
    description,
    surfaceTitle,
    surfaceDescription,
    statusLabel,
    fallbackTitle,
    fallbackText,
    goalLabel,
    goalText,
    recoveryLabel,
    recoveryText,
    recoveryFootnote,
    recoveryTone,
    primaryAction,
    secondaryAction,
    children,
    className,
  } = props

  const styles = getStateStyles(state)
  const hasInlineFallback = state === 'error' && fallbackText
  const hasCustomSurfaceContent = Boolean(children) && state !== 'loading' && state !== 'error'
  const hasInlineCompletion = state === 'complete' && !hasCustomSurfaceContent
  const hasRecoveryCheckpoint = state === 'error' && recoveryText
  const recoveryCardClasses =
    recoveryTone === 'warning'
      ? 'border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/20'
      : 'border-chatbox-border-primary bg-chatbox-background-secondary'

  return (
    <div
      data-testid="chatbridge-shell"
      data-state={state}
      aria-live="polite"
      className={cn(
        'my-3 rounded-[24px] border border-chatbox-border-primary bg-chatbox-background-tertiary p-4 shadow-sm',
        className
      )}
    >
      {goalText && (
        <div className="mb-3 rounded-[20px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
            {goalLabel || 'Last user goal'}
          </Text>
          <Text size="sm" fw={700} className="mt-2 whitespace-pre-wrap text-chatbox-primary">
            {goalText}
          </Text>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text size="sm" fw={700} className="text-chatbox-primary">
            {title}
          </Text>
          <Text size="xs" c="dimmed" className="mt-1 whitespace-pre-wrap">
            {description}
          </Text>
        </div>
        <span
          className={cn(
            'inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[11px] font-semibold tracking-[0.01em]',
            styles.badge
          )}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 rounded-[24px] border border-chatbox-border-primary bg-chatbox-background-primary p-4">
        <div className="flex items-center gap-2">
          {state === 'loading' ? (
            <Loader size="xs" />
          ) : styles.icon ? (
            <ScalableIcon icon={styles.icon} size={16} className="text-chatbox-tertiary" />
          ) : null}
          <Text size="sm" fw={700} className="text-chatbox-primary">
            {surfaceTitle}
          </Text>
        </div>
        <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
          {surfaceDescription}
        </Text>

        {hasCustomSurfaceContent ? (
          <div className={cn('mt-4 overflow-hidden rounded-[20px] border p-0', styles.accent)}>{children}</div>
        ) : (
          <div className={cn('mt-4 rounded-[20px] border p-4', styles.accent)}>
            <Text size="sm" c="dimmed" className="whitespace-pre-wrap">
              {state === 'loading' && 'The host wrapper is still preparing the runtime surface.'}
              {state === 'ready' && 'The app is ready to open from this message when the user chooses to continue.'}
              {state === 'active' &&
                'The app is active inside the host-owned shell and remains part of the conversation.'}
              {state === 'complete' &&
                'The runtime finished. The host keeps the completion state inline without leaving a separate summary receipt.'}
              {state === 'error' && 'The active runtime is unavailable, so the host shell is presenting the fallback path below.'}
            </Text>
          </div>
        )}
      </div>

      {hasRecoveryCheckpoint ? (
        <div className={cn('mt-3 rounded-[24px] border p-4', recoveryCardClasses)}>
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-chatbox-tertiary">
            {recoveryLabel || fallbackTitle || 'Host-owned recovery'}
          </Text>
          <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
            {recoveryText}
          </Text>
          {recoveryFootnote && (
            <Text size="xs" c="dimmed" className="mt-3 whitespace-pre-wrap">
              {recoveryFootnote}
            </Text>
          )}
        </div>
      ) : hasInlineFallback ? (
        <div className="mt-3 rounded-[24px] border border-amber-300 bg-amber-50/80 p-4 dark:border-amber-700 dark:bg-amber-950/20">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-amber-700 dark:text-amber-300">
            {fallbackTitle || 'Fallback'}
          </Text>
          <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
            Recovery stays in the same place
          </Text>
          <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
            {fallbackText}
          </Text>
        </div>
      ) : null}

      {hasInlineCompletion && (
        <div className="mt-3 rounded-[24px] border border-emerald-300 bg-emerald-50/80 p-4 dark:border-emerald-700 dark:bg-emerald-950/20">
          <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-emerald-700 dark:text-emerald-300">
            Complete
          </Text>
          <Text size="sm" fw={700} className="mt-1 text-chatbox-primary">
            The app finished inside the host shell
          </Text>
          <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
            The completion state remains visible in the thread, but no separate summary receipt is left behind.
          </Text>
        </div>
      )}

      {(secondaryAction || primaryAction) && (
        <Flex justify="flex-end" gap="xs" mt="md">
          {secondaryAction && (
            <Button variant="default" size="xs" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled}>
              {secondaryAction.label}
            </Button>
          )}
          {primaryAction && (
            <Button size="xs" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
              {primaryAction.label}
            </Button>
          )}
        </Flex>
      )}
    </div>
  )
}
