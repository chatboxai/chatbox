import NiceModal from '@ebay/nice-modal-react'
import { throwIfWorkAborted } from '@shared/mobile-work/abort'
import type { ConfirmModalProps } from '@/modals/ConfirmModal'

let confirmationQueue: Promise<unknown> = Promise.resolve()

/** Serialize work-mode consent dialogs so one action cannot replace another. */
export function confirmWorkAction(
  props: ConfirmModalProps,
  signal?: AbortSignal,
  alreadyAllowed?: () => boolean
): Promise<boolean> {
  const operation = confirmationQueue
    .catch(() => undefined)
    .then(async () => {
      throwIfWorkAborted(signal)
      if (alreadyAllowed?.()) return true
      const allowed = await new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (value: boolean) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', abort)
          resolve(value)
        }
        const abort = () => {
          void NiceModal.hide('confirm')
          finish(false)
        }
        signal?.addEventListener('abort', abort, { once: true })
        void NiceModal.show('confirm', props).then(
          (result) => finish(result === true),
          () => finish(false)
        )
      })
      throwIfWorkAborted(signal)
      return allowed
    })
  confirmationQueue = operation
  return operation
}
