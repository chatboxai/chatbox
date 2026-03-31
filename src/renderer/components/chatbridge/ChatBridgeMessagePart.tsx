import type { MessageAppPart } from '@shared/types'
import { isChatBridgeChessAppId } from '@shared/chatbridge'
import { ChatBridgeShell } from './ChatBridgeShell'
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
    >
      {runtime}
    </ChatBridgeShell>
  )
}
