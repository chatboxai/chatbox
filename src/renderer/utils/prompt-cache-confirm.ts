import NiceModal from '@ebay/nice-modal-react'
import i18n from '@/i18n'
import { uiStore } from '@/stores/uiStore'

export type PromptCacheBreakingAction = 'delete-historical-message' | 'switch-model' | 'delete-summary'

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

export async function confirmModelSwitchIfNeeded(shouldConfirm: boolean): Promise<boolean> {
  return !shouldConfirm || (await confirmPromptCacheBreakingAction('switch-model'))
}
