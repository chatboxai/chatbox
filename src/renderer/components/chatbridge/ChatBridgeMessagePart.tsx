import type { MessageAppPart } from '@shared/types'
import { getChatBridgeSurfaceContent } from './apps/surface'
import { ChatBridgeShell } from './ChatBridgeShell'
import { getMessageAppPartViewModel } from './chatbridge'

interface ChatBridgeMessagePartProps {
  part: MessageAppPart
  onPrefillPrompt?: (prompt: string) => void
}

export function ChatBridgeMessagePart({ part, onPrefillPrompt }: ChatBridgeMessagePartProps) {
  const viewModel = getMessageAppPartViewModel(part)
  const surfaceContent = getChatBridgeSurfaceContent(part)
  const primaryAction = viewModel.primaryAction
    ? {
        ...viewModel.primaryAction,
        onClick: viewModel.primaryAction.prompt ? () => onPrefillPrompt?.(viewModel.primaryAction!.prompt!) : undefined,
        disabled: !viewModel.primaryAction.prompt,
      }
    : undefined
  const secondaryAction = viewModel.secondaryAction
    ? {
        ...viewModel.secondaryAction,
        onClick: viewModel.secondaryAction.prompt
          ? () => onPrefillPrompt?.(viewModel.secondaryAction!.prompt!)
          : undefined,
        disabled: !viewModel.secondaryAction.prompt,
      }
    : undefined

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
      goalLabel={viewModel.goalLabel}
      goalText={viewModel.goalText}
      recoveryLabel={viewModel.recoveryLabel}
      recoveryText={viewModel.recoveryText}
      recoveryFootnote={viewModel.recoveryFootnote}
      recoveryTone={viewModel.recoveryTone}
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    >
      {surfaceContent}
    </ChatBridgeShell>
  )
}
