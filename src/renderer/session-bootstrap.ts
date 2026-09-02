import { registerSessionUiEffects } from '@/presentation/session/session-ui-effects'
import { rendererApplication } from '@/app/renderer-application'

let cleanup: (() => void) | null = null

/**
 * Renderer composition entry for Presentation-only session effects.
 *
 * Keeping this out of the application graph prevents Presentation effects
 * from pulling React components back into the application/data dependency path.
 */
export function initSessionPresentationBindings(): void {
  if (!cleanup) {
    cleanup = registerSessionUiEffects(rendererApplication.sessionEvents)
  }
}
