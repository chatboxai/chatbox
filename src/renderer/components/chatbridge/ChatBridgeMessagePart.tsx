import type { MessageAppPart } from '@shared/types'
import { ChatBridgeShell } from './ChatBridgeShell'
import { getMessageAppPartViewModel } from './chatbridge'

interface ChatBridgeMessagePartProps {
  part: MessageAppPart
}

export function ChatBridgeMessagePart({ part }: ChatBridgeMessagePartProps) {
  const viewModel = getMessageAppPartViewModel(part)

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
    />
  )
}
