import { createHashHistory, createRouter, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import platform from './platform'
import { routeTree } from './routeTree.gen'

// Create a new router instance
export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => {
    const navigate = useNavigate()

    useEffect(() => {
      navigate({ to: '/', replace: true }) // 重定向到首页
    }, [navigate])

    return null
  },
  history: platform.type === 'web' ? undefined : createHashHistory(),
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

type RouterNavigateOptions = Parameters<typeof router.navigate>[0]

/**
 * Navigates to a path assembled at runtime (session ids, mobile deep links, the
 * settings modal path). TanStack types `to` as the union of known route paths,
 * which a runtime-built string can never satisfy statically; the router still
 * resolves and validates the path at runtime.
 */
export function navigateToDynamicPath(options: {
  to: string
  replace?: boolean
  search?: Record<string, unknown>
  mask?: { to: string }
}): void {
  void router.navigate(options as RouterNavigateOptions)
}

/**
 * Reads the root-level `settings` search param that drives the settings modal.
 * No route declares it, so the value is read structurally rather than through
 * the router's typed search.
 */
export function getSettingsSearchParam(search: unknown): string | undefined {
  const value = (search as Record<string, unknown> | null | undefined)?.settings
  return typeof value === 'string' ? value : undefined
}
