import type { SessionMode } from '@chatbox/core/session/mode-policy'
import { shouldConfirmPromptCacheBreak } from '@chatbox/core/session/prompt-cache-policy'
import NiceModal from '@ebay/nice-modal-react'
import { type ContextSelectionOptions, selectContextMessages } from '@shared/context'
import type { Message } from '@shared/types'
import i18n from '@/i18n'
import { uiStore } from '@/stores/uiStore'

export type PromptCacheBreakingAction = 'delete-historical-message' | 'switch-model' | 'delete-summary'

export function selectPromptCachePolicyContext(
  messages: readonly Message[],
  options: ContextSelectionOptions = {}
): { messages: Message[]; hasStartedAssistantRequest: boolean } {
  let contextEnd = messages.length
  let hasInFlightAssistantRequest = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && message.generating && !message.isForkMarker) {
      // The generation pipeline sends only the prefix before its target.
      // Queued user turns after that target have not reached the provider yet.
      contextEnd = index
      hasInFlightAssistantRequest = true
      break
    }
  }

  const contextMessages = selectContextMessages(messages.slice(0, contextEnd), options)
  return {
    messages: contextMessages,
    hasStartedAssistantRequest:
      hasInFlightAssistantRequest || contextMessages.some((message) => message.role === 'assistant'),
  }
}

export function evaluatePromptCacheDeleteContext(
  messages: readonly Message[],
  messageId: string,
  options: ContextSelectionOptions = {}
): ReturnType<typeof selectPromptCachePolicyContext> & { deletionChangesContext: boolean } {
  const current = selectPromptCachePolicyContext(messages, options)
  const afterDelete = selectPromptCachePolicyContext(
    messages.filter((message) => message.id !== messageId),
    options
  )
  const deletionChangesContext =
    current.messages.length !== afterDelete.messages.length ||
    current.messages.some((message, index) => message.id !== afterDelete.messages[index]?.id)

  return { ...current, deletionChangesContext }
}

export function getPromptCacheBreakCopy(action: Exclude<PromptCacheBreakingAction, 'delete-summary'>): {
  title: string
  message: string
  confirmText: string
  dontShowAgainText: string
} {
  const dontShowAgainText = i18n.t("Don't show again")
  if (action === 'switch-model') {
    return {
      title: i18n.t('Switch models?'),
      message: i18n.t(
        'This conversation already has cached context. Switching models will invalidate that cache, so the next reply may cost more and take longer.'
      ),
      confirmText: i18n.t('Switch'),
      dontShowAgainText,
    }
  }

  return {
    title: i18n.t('Delete this message?'),
    message: i18n.t(
      'This conversation already has cached context. Deleting an earlier message will invalidate that cache, so the next reply may cost more and take longer.'
    ),
    confirmText: i18n.t('Delete'),
    dontShowAgainText,
  }
}

export function isPromptCacheBreakConfirmDismissed(action: PromptCacheBreakingAction): boolean {
  return uiStore.getState().promptCacheBreakConfirmDismissed?.[action] === true
}

export function dismissPromptCacheBreakConfirm(action: PromptCacheBreakingAction): void {
  uiStore.setState((state) => ({
    promptCacheBreakConfirmDismissed: {
      ...state.promptCacheBreakConfirmDismissed,
      [action]: true,
    },
  }))
}

function isConfirmedWithDontShowAgain(result: unknown): result is { confirmed: true; dontShowAgain: boolean } {
  return typeof result === 'object' && result !== null && 'confirmed' in result && result.confirmed === true
}

export function isPromptCacheConfirmAccepted(result: unknown): boolean {
  return result === true || isConfirmedWithDontShowAgain(result)
}

export async function confirmPromptCacheBreakingAction(
  action: Exclude<PromptCacheBreakingAction, 'delete-summary'>
): Promise<boolean> {
  if (isPromptCacheBreakConfirmDismissed(action)) {
    return true
  }

  const copy = getPromptCacheBreakCopy(action)
  const result = await NiceModal.show('confirm', {
    title: copy.title,
    message: copy.message,
    confirmText: copy.confirmText,
    dontShowAgainText: copy.dontShowAgainText,
    danger: action === 'delete-historical-message',
  })

  if (!isPromptCacheConfirmAccepted(result)) {
    return false
  }

  if (isConfirmedWithDontShowAgain(result) && result.dontShowAgain) {
    dismissPromptCacheBreakConfirm(action)
  }

  return true
}

export async function confirmModelSwitchIfNeeded(
  mode: SessionMode,
  messages: readonly Message[] | undefined,
  isNewSession: boolean,
  contextOptions: ContextSelectionOptions = {}
): Promise<boolean> {
  if (isNewSession || !messages || isPromptCacheBreakConfirmDismissed('switch-model')) {
    return true
  }
  const context = selectPromptCachePolicyContext(messages, contextOptions)
  if (
    !shouldConfirmPromptCacheBreak(mode, context.messages, {
      hasStartedAssistantRequest: context.hasStartedAssistantRequest,
    })
  ) {
    return true
  }
  return await confirmPromptCacheBreakingAction('switch-model')
}
