import type { MessageAppPart } from '@shared/types'
import { applyChatBridgeRecoveryAction, isChatBridgeChessAppId } from '@shared/chatbridge'
import { ChatBridgeShell } from './ChatBridgeShell'
import { getChatBridgeSurfaceContent } from './apps/surface'
import { getMessageAppPartViewModel } from './chatbridge'
import { ChessRuntime } from './apps/chess/ChessRuntime'

interface ChatBridgeMessagePartProps {
  part: MessageAppPart
  onUpdatePart?: (nextPart: MessageAppPart) => void
  sessionId?: string
  messageId?: string
}

export function ChatBridgeMessagePart({ part, onUpdatePart, sessionId, messageId }: ChatBridgeMessagePartProps) {
  const viewModel = getMessageAppPartViewModel(part)
  const runtime =
    part.lifecycle === 'active' && isChatBridgeChessAppId(part.appId) ? (
      <ChessRuntime part={part} onUpdatePart={onUpdatePart} sessionId={sessionId} messageId={messageId} />
    ) : undefined
  const inlineSurface = runtime ?? getChatBridgeSurfaceContent(part)
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
    >
      {inlineSurface}
    </ChatBridgeShell>
  )
}
