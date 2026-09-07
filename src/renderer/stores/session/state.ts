import { rendererApplication } from '@/app/renderer-application'

/**
 * Compatibility bridge for callers added before generation runtime extraction.
 * The portable runtime store owns the actual per-Session drain set.
 */
export function registerUnsettledStreamDrain(sessionId: string, drain: Promise<void>): void {
  rendererApplication.generationRuntime.registerUnsettledStreamDrain(sessionId, drain)
}

/** Resolves once every currently registered unsettled stream for the Session has drained. */
export function waitForUnsettledStreamDrains(sessionId: string): Promise<void> | undefined {
  return rendererApplication.generationRuntime.waitForUnsettledStreamDrains(sessionId)
}
