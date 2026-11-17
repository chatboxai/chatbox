export type HomeWelcomeCardMode = 'none' | 'login' | 'no-license' | 'expired-license'

export function getHomeWelcomeCardMode(params: {
  providerCount: number
  isLoggedIn: boolean
  hasLicense: boolean
  hasExpiredLicense: boolean
  hideForStoreReview?: boolean
}): HomeWelcomeCardMode {
  const { providerCount, isLoggedIn, hasLicense, hasExpiredLicense, hideForStoreReview } = params

  if (hideForStoreReview) {
    return 'none'
  }

  if (providerCount > 0 || hasLicense) {
    return 'none'
  }

  if (isLoggedIn) {
    return hasExpiredLicense ? 'expired-license' : 'no-license'
  }

  return 'login'
}
