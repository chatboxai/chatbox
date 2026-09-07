import type { SessionActionBlockReason } from '@chatbox/core/session/action-gates'
import type { TFunction } from 'i18next'

/** Map a shared gate block reason to the renderer's user-facing copy. */
export function getSessionLockNotice(reason: SessionActionBlockReason, t: TFunction): string {
  switch (reason) {
    case 'generating':
    case 'message-streaming':
      return t('Wait for the current replies to finish')
    case 'compaction':
      return t('Wait for compaction to finish')
    case 'awaiting-pause-decision':
      return t('Respond in the action bar at the bottom.')
    case 'read-only':
      return t('This session is read-only')
  }
}

/**
 * The single blocked-action notification: every surface that rejects a gated
 * action routes through here so duration and presentation cannot drift.
 * Async because toastActions pulls in uiStore (browser globals), which must
 * not load in node-environment tests that never hit a blocked path.
 */
export async function notifySessionLockBlocked(reason: SessionActionBlockReason, t: TFunction): Promise<void> {
  const toastActions = await import('@/stores/toastActions')
  toastActions.add(getSessionLockNotice(reason, t), 2500)
}
