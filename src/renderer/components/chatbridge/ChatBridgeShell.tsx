import { Button, Flex, Loader, Text } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconPlayerPlay, IconSparkles } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { cn } from '@/lib/utils'
import type {
  ChatBridgeShellAction,
  ChatBridgeShellState,
  ChatBridgeShellSupportItem,
  ChatBridgeShellSupportPanel,
} from './chatbridge'

interface ChatBridgeShellProps {
  state: ChatBridgeShellState
  title: string
  description: string
  surfaceTitle: string
  surfaceDescription: string
  statusLabel: string
  fallbackTitle?: string
  fallbackText?: string
  supportPanel?: ChatBridgeShellSupportPanel
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
    degraded: {
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
      accent: 'border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20',
      icon: IconAlertTriangle,
    },
    error: {
      badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
      accent: 'border-rose-300 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-950/20',
      icon: IconAlertTriangle,
    },
  }[state]
}

function getSupportToneClasses(tone: ChatBridgeShellSupportItem['tone']) {
  if (tone === 'safe') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
  }
  if (tone === 'warning') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
  }
  if (tone === 'blocked') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
  }

  return 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
}

function getSupportToneLabel(tone: ChatBridgeShellSupportItem['tone']) {
  if (tone === 'safe') {
    return 'Safe'
  }
  if (tone === 'warning') {
    return 'Watch'
  }
  if (tone === 'blocked') {
    return 'Blocked'
  }

  return 'Info'
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
    supportPanel,
    primaryAction,
    secondaryAction,
    children,
    className,
  } = props

  const styles = getStateStyles(state)
  const hasInlineFallback = state === 'error' && fallbackText
  const hasInlineCompletion = state === 'complete'
  const hasSupportPanel = state === 'degraded' && supportPanel

  const surfaceCard = (
    <div className="rounded-[24px] border border-chatbox-border-primary bg-chatbox-background-primary p-4">
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

      {state === 'active' && children ? (
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
            {state === 'degraded' &&
              'The host keeps the degraded ending explicit, bounded, and recoverable from the same message surface.'}
            {state === 'error' && 'The active runtime is unavailable, so the host shell is presenting the fallback path below.'}
          </Text>
        </div>
      )}
    </div>
  )

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

      {hasSupportPanel ? (
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          {surfaceCard}
          <div className="rounded-[24px] border border-amber-300 bg-amber-50/80 p-4 dark:border-amber-700 dark:bg-amber-950/20">
            {supportPanel.eyebrow ? (
              <Text size="xs" fw={700} className="uppercase tracking-[0.06em] text-amber-700 dark:text-amber-300">
                {supportPanel.eyebrow}
              </Text>
            ) : null}
            <Text size="sm" fw={700} className={cn('text-chatbox-primary', supportPanel.eyebrow ? 'mt-1' : '')}>
              {supportPanel.title}
            </Text>
            {supportPanel.description ? (
              <Text size="sm" c="dimmed" className="mt-2 whitespace-pre-wrap">
                {supportPanel.description}
              </Text>
            ) : null}
            {supportPanel.items?.length ? (
              <div className="mt-3 space-y-2">
                {supportPanel.items.map((item) => (
                  <div
                    key={`${item.label}-${item.description || ''}`}
                    className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-primary p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Text size="sm" fw={600} className="text-chatbox-primary">
                        {item.label}
                      </Text>
                      <span
                        className={cn(
                          'inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.04em]',
                          getSupportToneClasses(item.tone)
                        )}
                      >
                        {getSupportToneLabel(item.tone)}
                      </span>
                    </div>
                    {item.description ? (
                      <Text size="xs" c="dimmed" className="mt-1 whitespace-pre-wrap">
                        {item.description}
                      </Text>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3">{surfaceCard}</div>
      )}

      {hasInlineFallback && (
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
      )}

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
            <Button
              variant={secondaryAction.variant === 'secondary' ? 'default' : 'filled'}
              size="xs"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.label}
            </Button>
          )}
          {primaryAction && (
            <Button
              variant={primaryAction.variant === 'secondary' ? 'default' : 'filled'}
              size="xs"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
            >
              {primaryAction.label}
            </Button>
          )}
        </Flex>
      )}
    </div>
  )
}
