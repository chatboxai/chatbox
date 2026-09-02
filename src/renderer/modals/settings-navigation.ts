import { getThemeDesign } from '@/hooks/useAppTheme'
import { navigateToDynamicPath, router } from '@/router'

export function navigateToSettings(path?: string) {
  if (window.matchMedia(`(max-width:${getThemeDesign('light', 'en').breakpoints?.values?.sm || 640}px)`).matches) {
    navigateToDynamicPath({
      to: `/settings${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`,
    })
  } else {
    navigateToDynamicPath({
      to: router.state.location.pathname,
      search: {
        settings: `/settings${path ? (path.startsWith('/') ? path : `/${path}`) : ''}`,
      },
      mask: {
        to: '/settings',
      },
    })
  }
}
