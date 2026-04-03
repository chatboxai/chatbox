import { Button, Text } from '@mantine/core'
import type { MessageAppPart, MessageContentParts } from '@shared/types'
import { applyChatBridgeRecoveryAction, getChatBridgeRouteDecision, isChatBridgeChessAppId } from '@shared/chatbridge'
import { isChatBridgeReviewedAppLaunchPart } from '@/packages/chatbridge/reviewed-app-launch'
import { cn } from '@/lib/utils'
import { ChatBridgeShell } from './ChatBridgeShell'
import { ChatBridgeRouteArtifact } from './ChatBridgeRouteArtifact'
import { getChatBridgeSurfaceContent } from './apps/surface'
import { getMessageAppPartViewModel } from './chatbridge'
import { ChessRuntime } from './apps/chess/ChessRuntime'

interface ChatBridgeMessagePartProps {
  part: MessageAppPart
  onUpdatePart?: (nextPart: MessageAppPart) => void
  onUpdateMessageContentParts?: (
    updater: (current: MessageContentParts) => Promise<MessageContentParts> | MessageContentParts
  ) => Promise<void>
  sessionId?: string
  messageId?: string
  presentation?: 'inline' | 'anchor' | 'tray'
  floatingTrayMinimized?: boolean
  onOpenFloatingShell?: () => void
}

function getAnchorBadgeClasses(state: ReturnType<typeof getMessageAppPartViewModel>['state']) {
  if (state === 'loading') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
  }
  if (state === 'ready') {
    return 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
  }
  if (state === 'active') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
  }
  if (state === 'complete') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
  }
  if (state === 'degraded') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
  }

  return 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
}

export function ChatBridgeMessagePart({
  part,
  onUpdatePart,
  onUpdateMessageContentParts,
  sessionId,
  messageId,
  presentation = 'inline',
  floatingTrayMinimized = false,
  onOpenFloatingShell,
}: ChatBridgeMessagePartProps) {
  const viewModel = getMessageAppPartViewModel(part)
  const isReviewedLaunchPart = isChatBridgeReviewedAppLaunchPart(part)
  const routeDecision = !isReviewedLaunchPart ? getChatBridgeRouteDecision(part) : null
  const runtime =
    part.lifecycle === 'active' && isChatBridgeChessAppId(part.appId) && !isReviewedLaunchPart ? (
      <ChessRuntime part={part} onUpdatePart={onUpdatePart} sessionId={sessionId} messageId={messageId} />
    ) : undefined
  const inlineSurface =
    runtime ??
    (routeDecision ? (
      <ChatBridgeRouteArtifact
        part={part}
        decision={routeDecision}
        sessionId={sessionId}
        messageId={messageId}
        onUpdateMessageContentParts={onUpdateMessageContentParts}
      />
    ) : (
      getChatBridgeSurfaceContent({ part, sessionId, messageId })
    ))
  const primaryAction = viewModel.recoveryActions?.find((action) => action.variant !== 'secondary')
  const secondaryAction = viewModel.recoveryActions?.find((action) => action.variant === 'secondary')

  function buildShellAction(action?: typeof primaryAction) {
    if (!action) {
      return undefined
    }

    if (typeof onUpdatePart !== 'function') {
      return {
        ...action,
        disabled: true,
      }
    }

    return {
      ...action,
      onClick: () => {
        if (!action.id || action.disabled) {
          return
        }

        onUpdatePart(applyChatBridgeRecoveryAction(part, action.id))
      },
    }
  }

  if (presentation === 'anchor') {
    return (
      <div
        data-testid="chatbridge-anchor"
        className="my-3 rounded-[22px] border border-chatbox-border-primary bg-chatbox-background-secondary p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Text size="sm" fw={700} className="text-chatbox-primary">
              {viewModel.title}
            </Text>
            <Text size="xs" c="dimmed" className="mt-1 whitespace-pre-wrap">
              {floatingTrayMinimized
                ? 'The live runtime is minimized in the app tray. Restore it when you want the full board or app surface back.'
                : 'The live runtime is pinned in the app tray below the conversation so chat can continue without losing the app view.'}
            </Text>
          </div>
          <span
            className={cn(
              'inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[11px] font-semibold tracking-[0.01em]',
              getAnchorBadgeClasses(viewModel.state)
            )}
          >
            {viewModel.statusLabel}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-primary px-3 py-2">
          <Text size="sm" className="text-chatbox-primary">
            {viewModel.surfaceDescription}
          </Text>
          {onOpenFloatingShell ? (
            <Button variant={floatingTrayMinimized ? 'light' : 'subtle'} size="compact-sm" onClick={onOpenFloatingShell}>
              {floatingTrayMinimized ? 'Restore app' : 'Focus app'}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <ChatBridgeShell
      state={viewModel.state}
      title={viewModel.title}
      description={viewModel.description}
      surfaceTitle={viewModel.surfaceTitle}
      surfaceDescription={viewModel.surfaceDescription}
      statusLabel={viewModel.statusLabel}
      fallbackTitle={viewModel.fallbackTitle}
      fallbackText={viewModel.fallbackText}
      supportPanel={viewModel.supportPanel}
      primaryAction={buildShellAction(primaryAction)}
      secondaryAction={buildShellAction(secondaryAction)}
      className={presentation === 'tray' ? 'my-0' : undefined}
    >
      {inlineSurface}
    </ChatBridgeShell>
  )
}
