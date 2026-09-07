import type { GenerationRuntimeState, GenerationRuntimeStore } from '@chatbox/core'
import { useSyncExternalStore } from 'react'

export function createGenerationHooks(runtime: GenerationRuntimeStore) {
  return {
    useGeneration(sessionId: string | null): GenerationRuntimeState | undefined {
      return useSyncExternalStore(
        (listener) => runtime.subscribe(listener),
        () => (sessionId ? runtime.get(sessionId) : undefined),
        () => undefined
      )
    },
    /** Re-renders the caller whenever any generation runtime starts, transitions, or ends. */
    useVersion(): number {
      return useSyncExternalStore(
        (listener) => runtime.subscribe(listener),
        () => runtime.getVersion(),
        () => 0
      )
    },
    /** True while the given message has an active generation runtime. */
    useIsActive(sessionId: string, messageId: string): boolean {
      return useSyncExternalStore(
        (listener) => runtime.subscribe(listener),
        () => runtime.get(sessionId, messageId) !== undefined,
        () => false
      )
    },
  }
}
