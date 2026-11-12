export const CLIENT_NOTIFICATION_DISPLAYED_BATCHES_KEY = 'chatbox.client-notification.displayed-batches.v1'

export async function withWebNotificationDisplayLock(display: () => Promise<void>): Promise<void> {
  if (!navigator.locks) {
    // Cross-tab delivery requires an atomic same-origin lock; skip when the browser cannot provide it.
    console.warn('Client notifications require Web Locks in the browser')
    return
  }
  // ponytail: one visible notification per origin; use batch-specific locks only if concurrent dialogs become necessary.
  await navigator.locks.request('chatbox.client-notification.display', display)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function readDisplayedBatchIds(): string[] {
  try {
    const stored = window.localStorage.getItem(CLIENT_NOTIFICATION_DISPLAYED_BATCHES_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && UUID_PATTERN.test(value))
  } catch {
    return []
  }
}

export function markBatchDisplayed(batchId: string): void {
  try {
    const displayedBatchIds = readDisplayedBatchIds()
    if (displayedBatchIds.includes(batchId)) return
    window.localStorage.setItem(
      CLIENT_NOTIFICATION_DISPLAYED_BATCHES_KEY,
      JSON.stringify([...displayedBatchIds, batchId])
    )
  } catch {
    // Browsers can deny localStorage access; notification display must still complete.
  }
}
