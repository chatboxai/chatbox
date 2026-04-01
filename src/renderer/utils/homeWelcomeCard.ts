export type WelcomeCardMode = 'guide' | 'copilots' | null

export function getHomeWelcomeCardMode(_params: {
  providerCount: number
  isLoggedIn: boolean
  hasLicense: boolean
}): WelcomeCardMode {
  if (_params.providerCount === 0) return 'guide'
  return null
}
