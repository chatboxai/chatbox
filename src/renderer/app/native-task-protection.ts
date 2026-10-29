import type { ExclusiveOperationCoordinator } from '@chatbox/core/utils/exclusive-operation'

/** Register before maintenance participants so native protection is released last. */
export function registerNativeTaskProtection(
  operations: ExclusiveOperationCoordinator,
  host: { setTaskCloseProtection?(active: boolean): Promise<void> }
): () => void {
  if (!host.setTaskCloseProtection) return () => {}
  const setProtection = host.setTaskCloseProtection.bind(host)
  return operations.registerParticipant({
    pauseAndDrain: () => setProtection(true),
    resume: () => setProtection(false),
  })
}
