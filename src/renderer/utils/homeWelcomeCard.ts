export type WelcomeCardMode = 'none' | 'login-required' | 'no-license'

export function getHomeWelcomeCardMode(_params: {
  providerCount: number
  isLoggedIn: boolean
  hasLicense: boolean
}): WelcomeCardMode {
  if (_params.providerCount === 0 || !_params.isLoggedIn) {
    return 'login-required'
  }
  if (!_params.hasLicense) {
    return 'no-license'
  }
  return 'none'
}
