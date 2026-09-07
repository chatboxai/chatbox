import { focusManager, onlineManager } from '@tanstack/react-query'

export interface HostBooleanStateSource {
  getCurrent(): boolean | Promise<boolean>
  subscribe(listener: (value: boolean) => void): () => void
}

export interface ReactQueryHostLifecycle {
  focus?: HostBooleanStateSource
  online?: HostBooleanStateSource
}

/**
 * Connects host lifecycle state to TanStack Query without importing a browser,
 * Capacitor, Electron, or React Native implementation into shared bindings.
 */
export function bindReactQueryHostLifecycle(lifecycle: ReactQueryHostLifecycle): () => void {
  let active = true
  const cleanups: Array<() => void> = []
  const previousOnline = onlineManager.isOnline()

  if (lifecycle.focus) {
    const source = lifecycle.focus
    void Promise.resolve(source.getCurrent())
      .then((focused) => {
        if (active) focusManager.setFocused(focused)
      })
      .catch(() => undefined)
    cleanups.push(source.subscribe((focused) => focusManager.setFocused(focused)))
  }

  if (lifecycle.online) {
    const source = lifecycle.online
    void Promise.resolve(source.getCurrent())
      .then((online) => {
        if (active) onlineManager.setOnline(online)
      })
      .catch(() => undefined)
    cleanups.push(source.subscribe((online) => onlineManager.setOnline(online)))
  }

  return () => {
    active = false
    for (const cleanup of cleanups.reverse()) cleanup()
    // `undefined` releases the host override and restores FocusManager's
    // automatic document.visibilityState behavior. `isFocused()` only exposes
    // the resolved boolean, so it cannot be used to reconstruct that state.
    if (lifecycle.focus) focusManager.setFocused(undefined)
    if (lifecycle.online) onlineManager.setOnline(previousOnline)
  }
}
