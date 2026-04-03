import { Badge, Button, Text } from '@mantine/core'
import {
  getChatBridgeHostRuntimeLabel,
  getChatBridgeRouteArtifactState,
  type ChatBridgeRouteDecision,
} from '@shared/chatbridge'
import type { MessageAppPart, MessageContentParts } from '@shared/types'
import { useMemo, useState } from 'react'
import { langsmith } from '@/adapters/langsmith'
import { applyChatBridgeRouteArtifactAction } from '@/packages/chatbridge/router/actions'
import { cn } from '@/lib/utils'

interface ChatBridgeRouteArtifactProps {
  part: MessageAppPart
  decision: ChatBridgeRouteDecision
  sessionId?: string
  messageId?: string
  onUpdateMessageContentParts?: (
    updater: (current: MessageContentParts) => Promise<MessageContentParts> | MessageContentParts
  ) => Promise<void>
}

function formatMatchedTerms(matchedTerms: string[]) {
  if (matchedTerms.length === 0) {
    return 'Reviewed app match'
  }

  return `Matched on ${matchedTerms.join(', ')}`
}

function getReasonLabel(decision: ChatBridgeRouteDecision) {
  switch (decision.reasonCode) {
    case 'ambiguous-match':
      return 'Ambiguous reviewed app match'
    case 'needs-confirmation':
      return 'Confirmation required'
    case 'runtime-unsupported':
      return 'Runtime blocked'
    case 'no-eligible-apps':
      return 'No eligible reviewed apps'
    case 'no-confident-match':
      return 'Keep helping in chat'
    case 'invalid-prompt':
      return 'Invalid request'
    default:
      return 'Route decision'
  }
}

export function ChatBridgeRouteArtifact({
  part,
  decision,
  sessionId,
  messageId,
  onUpdateMessageContentParts,
}: ChatBridgeRouteArtifactProps) {
  const routeState = getChatBridgeRouteArtifactState(part)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const matches = useMemo(() => decision.matches.slice(0, 3), [decision.matches])
  const actionsDisabled = !onUpdateMessageContentParts || Boolean(busyAction) || routeState?.status !== 'pending'
  const runtimeSummary = decision.runtimeBlock
    ? `Current runtime: ${getChatBridgeHostRuntimeLabel(decision.runtimeBlock.hostRuntime)}. Supported runtimes: ${decision.runtimeBlock.supportedHostRuntimes
        .map((runtime) => getChatBridgeHostRuntimeLabel(runtime))
        .join(', ')}.`
    : null

  const recordAction = async (
    action:
      | {
          kind: 'launch-app'
          appId: string
        }
      | {
          kind: 'chat-only'
        }
  ) => {
    if (!onUpdateMessageContentParts || actionsDisabled) {
      return
    }

    const actionKey = action.kind === 'launch-app' ? action.appId : action.kind
    setBusyAction(actionKey)

    let outcome:
      | Awaited<ReturnType<typeof applyChatBridgeRouteArtifactAction>>
      | undefined

    try {
      await onUpdateMessageContentParts(async (current) => {
        outcome = await applyChatBridgeRouteArtifactAction({
          contentParts: current,
          part,
          action,
          sessionId,
        })

        return outcome.nextContentParts
      })
    } finally {
      setBusyAction(null)
    }

    void langsmith
      .recordEvent({
        name: 'chatbridge.routing.clarify-selection',
        runType: 'tool',
        inputs: {
          prompt: decision.prompt,
          action: action.kind,
          requestedAppId: action.kind === 'launch-app' ? action.appId : null,
        },
        outputs: {
          outcome: outcome?.outcome ?? 'stale',
          selectedAppId: outcome?.selectedAppId ?? null,
          selectedAppName: outcome?.selectedAppName ?? null,
          toolName: outcome?.toolName ?? null,
          errorCode: outcome?.errorCode ?? null,
        },
        metadata: {
          operation: 'chatbridgeRouteClarifySelection',
          sessionId: sessionId ?? null,
          messageId: messageId ?? null,
        },
        tags: [
          'chatbox',
          'renderer',
          'chatbridge',
          'routing',
          'clarify-selection',
          `outcome:${outcome?.outcome ?? 'stale'}`,
        ],
      })
      .catch((error) => {
        console.debug('Failed to record ChatBridge clarify-selection trace event.', error)
      })
  }

  if (decision.kind === 'clarify' && routeState?.status === 'pending') {
    return (
      <div data-testid="chatbridge-route-artifact" className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Text size="sm" fw={700} className="text-chatbox-primary">
              {getReasonLabel(decision)}
            </Text>
            <Text size="sm" c="dimmed" className="mt-1 whitespace-pre-wrap">
              {decision.summary}
            </Text>
          </div>
          <Badge variant="light" color="blue">
            Host owned
          </Badge>
        </div>

        <div className="space-y-2">
          {matches.map((match) => {
            const isSuggested = match.appId === decision.selectedAppId
            const isBusy = busyAction === match.appId

            return (
              <div
                key={match.appId}
                className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-primary p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Text size="sm" fw={700} className="text-chatbox-primary">
                      {match.appName}
                    </Text>
                    <Text size="xs" c="dimmed" className="mt-1">
                      {formatMatchedTerms(match.matchedTerms)}
                    </Text>
                  </div>
                  {isSuggested ? (
                    <Badge variant="light" color="green">
                      Suggested
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {match.matchedContexts.map((context) => (
                    <span
                      key={`${match.appId}-${context}`}
                      className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 dark:bg-slate-900/50 dark:text-slate-300"
                    >
                      {context}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <Text size="xs" c="dimmed">
                    The host will launch {match.appName} in this thread if you confirm.
                  </Text>
                  <Button
                    size="xs"
                    onClick={() => void recordAction({ kind: 'launch-app', appId: match.appId })}
                    disabled={actionsDisabled}
                    loading={isBusy}
                  >
                    Launch {match.appName}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="rounded-[18px] border border-dashed border-chatbox-border-primary bg-chatbox-background-primary p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Text size="sm" fw={600} className="text-chatbox-primary">
                Keep this in chat
              </Text>
              <Text size="xs" c="dimmed" className="mt-1">
                No reviewed app launches. The assistant can keep helping in the normal thread.
              </Text>
            </div>
            <Button
              size="xs"
              variant="default"
              onClick={() => void recordAction({ kind: 'chat-only' })}
              disabled={actionsDisabled}
              loading={busyAction === 'chat-only'}
            >
              Continue in chat
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="chatbridge-route-artifact" className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Text size="sm" fw={700} className="text-chatbox-primary">
            {routeState?.title || getReasonLabel(decision)}
          </Text>
          <Text size="sm" c="dimmed" className="mt-1 whitespace-pre-wrap">
            {routeState?.description || part.description || decision.summary}
          </Text>
        </div>
        <Badge
          variant="light"
          color={routeState?.status === 'launch-failed' || decision.reasonCode === 'runtime-unsupported' ? 'red' : 'blue'}
        >
          {routeState?.statusLabel || part.statusText || getReasonLabel(decision)}
        </Badge>
      </div>

      <div className="space-y-2">
        {routeState?.selectedAppName ? (
          <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-primary p-3">
            <Text size="sm" fw={700} className="text-chatbox-primary">
              Selected app
            </Text>
            <Text size="sm" c="dimmed" className="mt-1">
              {routeState.selectedAppName}
            </Text>
          </div>
        ) : null}
        {runtimeSummary ? (
          <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-primary p-3">
            <Text size="sm" fw={700} className="text-chatbox-primary">
              Runtime support
            </Text>
            <Text size="sm" c="dimmed" className="mt-1 whitespace-pre-wrap">
              {runtimeSummary}
            </Text>
          </div>
        ) : null}
        {routeState?.errorMessage ? (
          <div
            className={cn(
              'rounded-[18px] border p-3',
              'border-rose-300 bg-rose-50/80 dark:border-rose-700 dark:bg-rose-950/20'
            )}
          >
            <Text size="sm" fw={700} className="text-chatbox-primary">
              Launch stayed bounded
            </Text>
            <Text size="sm" c="dimmed" className="mt-1 whitespace-pre-wrap">
              {routeState.errorMessage}
            </Text>
          </div>
        ) : null}
        {!routeState && matches.length > 0 ? (
          <div className="rounded-[18px] border border-chatbox-border-primary bg-chatbox-background-primary p-3">
            <Text size="sm" fw={700} className="text-chatbox-primary">
              Reviewed matches checked
            </Text>
            <Text size="sm" c="dimmed" className="mt-1">
              {matches.map((match) => match.appName).join(', ')}
            </Text>
          </div>
        ) : null}
      </div>
    </div>
  )
}
